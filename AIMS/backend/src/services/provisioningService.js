/*
 * Account provisioning: creating the people who use this system, together with
 * the logins they need.
 *
 * THE PROBLEM THIS SOLVES
 * ----------------------
 * Admitting a student used to mean inserting a `students` row and nothing else.
 * The student had no `users` row, so they could not sign in; nobody created the
 * parent; and `student_guardians` was left empty, so the parent portal had no
 * child to show. Three separate screens then had to be visited to finish the
 * job, and if any of them was skipped the record stayed half-built. Two of the
 * 2,002 students in the database are still in exactly that state — a student
 * row with no user_id, unable to log in at all.
 *
 * Everything here happens in ONE database transaction. Either the student, the
 * parent, both logins and the guardian link all exist, or none of them do.
 *
 * PASSWORDS
 * ---------
 * Generated here, hashed with bcrypt before they touch the database, and
 * returned to the caller exactly once — in the response to the request that
 * created the account. They are never stored in plaintext, never written to a
 * log, and cannot be read back afterwards. If the admin loses them, the only
 * remedy is to issue new ones (`reissueCredentials`), which is the correct
 * behaviour: a password an administrator can look up is not a password.
 *
 * Every generated password sets `must_change_password`, so the account must
 * choose its own on first sign-in. That is what keeps "the admin saw it once"
 * from becoming "the admin knows this person's password forever".
 */

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { sequelize } = require("../database/connection");
const { ROLES } = require("../config/roles");

const BCRYPT_ROUNDS = 10;
const EMAIL_DOMAIN = process.env.INSTITUTE_EMAIL_DOMAIN || "aims.edu.pk";

const select = (sql, replacements, transaction) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements,
        transaction
    });

// ------------------------------------------------------------- generators

/*
 * A password a person can read off a screen and type once.
 *
 * Deliberately avoids look-alike characters (0/O, 1/l/I): these get read aloud
 * over a phone or copied off a printout, and "was that a one or an ell" is a
 * support call. 12 characters from a 58-character alphabet is ~70 bits, which
 * is far beyond what a password used once and then changed needs.
 *
 * crypto.randomInt is used rather than Math.random because this is a
 * credential — Math.random is predictable from previous outputs.
 */
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generatePassword = (length = 12) => {
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
    }
    // Guarantee the mix the password policy elsewhere in the app expects,
    // rather than hoping randomness supplies it.
    return `${out}@${crypto.randomInt(10)}`;
};

const slug = (value) =>
    String(value || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")   // strip accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 20);

/*
 * An institute email address, in the same shape the staff accounts already use
 * (adnan.farooq@aims.edu.pk).
 *
 * A number is appended only when the plain form is taken, so the common case
 * stays readable. The uniqueness check runs inside the caller's transaction, so
 * two admissions happening at the same moment cannot both claim one address —
 * and the UNIQUE index on users.email is the final backstop if they somehow do.
 */
const generateEmail = async (firstName, lastName, transaction) => {
    const base = [slug(firstName), slug(lastName)].filter(Boolean).join(".") || "user";

    for (let suffix = 0; suffix < 500; suffix += 1) {
        const candidate = `${base}${suffix === 0 ? "" : suffix}@${EMAIL_DOMAIN}`;
        const taken = await select(
            "SELECT user_id FROM users WHERE email = :email LIMIT 1",
            { email: candidate },
            transaction
        );
        if (!taken.length) return candidate;
    }

    // 500 people sharing a name is not a real case; failing loudly beats
    // returning something that will collide.
    throw new Error(`Could not allocate an email address for ${base}`);
};

/*
 * The registration number.
 *
 * The database currently holds three different formats — 2,000 rows of
 * `2023-AIMS-REG-0001`, plus a one-off `2024-CS-001` and a one-off
 * `FA22-BSE-100` that were clearly typed by hand. Generating them removes the
 * chance of a fourth.
 *
 * The dominant format wins: {intake year}-AIMS-REG-{4-digit sequence}. The year
 * comes from the batch the student is joining, not from today's date, so a
 * student admitted late into the 2022 batch is numbered with their cohort.
 *
 * The sequence is the highest existing number for that year plus one, read
 * inside the transaction with a row lock so two simultaneous admissions cannot
 * be handed the same number.
 */
const generateRegistrationNumber = async (batchId, transaction) => {
    const [batch] = await select(
        "SELECT start_year FROM batches WHERE batch_id = :batchId",
        { batchId },
        transaction
    );

    const year = batch?.start_year || new Date().getFullYear();
    const prefix = `${year}-AIMS-REG-`;

    const [highest] = await select(
        `SELECT MAX(CAST(SUBSTRING(registration_number, :len) AS UNSIGNED)) AS top
           FROM students
          WHERE registration_number LIKE :pattern
          FOR UPDATE`,
        { len: prefix.length + 1, pattern: `${prefix}%` },
        transaction
    );

    const next = Number(highest?.top || 0) + 1;
    return `${prefix}${String(next).padStart(4, "0")}`;
};

/*
 * A registration number supplied by the caller.
 *
 * Bulk import reads one out of a CSV: an institute migrating its records, or
 * admitting a cohort whose numbers were assigned on paper, already knows what
 * each student's number is, and having the system overwrite it would break
 * every document already issued against it.
 *
 * Validated inside the same transaction and under the same lock as the
 * generated path, so a supplied number cannot collide with a generated one
 * raced against it. Two rules, both of which the database would otherwise
 * enforce far less legibly:
 *
 *   - it must not already exist (registration_number is unique);
 *   - it must be non-trivial — a blank or whitespace-only cell in a spreadsheet
 *     is the single most common way this arrives, and it must not become a
 *     student's identifier.
 */
const useSuppliedRegistrationNumber = async (supplied, transaction) => {
    const value = String(supplied).trim();

    if (value.length < 3) {
        const error = new Error(
            `"${value}" is not a usable registration number — it must be at least 3 characters.`
        );
        error.status = 400;
        throw error;
    }

    const [clash] = await select(
        `SELECT student_id, is_deleted FROM students
          WHERE registration_number = :value
          FOR UPDATE`,
        { value },
        transaction
    );

    if (clash) {
        const error = new Error(
            `Registration number ${value} already belongs to student #${clash.student_id}`
            + `${clash.is_deleted ? " (a removed student — restore them instead of re-admitting)" : ""}.`
        );
        error.status = 409;
        throw error;
    }

    return value;
};

/*
 * Creates a users row and returns { userId, email, password }.
 *
 * `fullName` is written onto the account as well as onto the role record it
 * belongs to. That duplication is deliberate and is the whole point of
 * `users.full_name`: an account must be able to say who it belongs to without
 * a caller first knowing which of students/employees/parents to join against.
 *
 * Provisioning is the moment both facts are in hand, so writing them together
 * costs nothing. Leaving it to the backfill migration would mean every account
 * created after that migration ran had a NULL name again.
 */
const createLogin = async ({ email, roleId, phone, fullName }, transaction) => {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    /*
     * `email_verified` is written 1, and the column is on its way out.
     *
     * It used to be written 0 here, which flagged EVERY provisioned account —
     * every student admitted, every teacher onboarded, every staff login — as
     * "Email unverified" in User Management, permanently. There was never a
     * verification email to clear it: no mailer exists in this system (see the
     * note above the password-reset handler in authController), no token table,
     * no verify endpoint, and no code path anywhere that set the column back to
     * 1. Nothing read it either — login does not check it and no route guards
     * on it. So it was a warning that could only ever be wrong.
     *
     * The address is not unverified in any meaningful sense: the admin office
     * types it, hands the generated password to the person, and that person
     * signs in with it. `last_login` already records whether that happened.
     */
    const [userId] = await sequelize.query(
        `INSERT INTO users
            (email, password_hash, role_id, phone, full_name, is_active, email_verified,
             failed_login_attempts, is_deleted, must_change_password,
             credentials_issued_at, created_at, updated_at)
         VALUES
            (:email, :passwordHash, :roleId, :phone, :fullName, 1, 1, 0, 0, 1, NOW(), NOW(), NOW())`,
        {
            replacements: {
                email,
                passwordHash,
                roleId,
                phone: phone || null,
                fullName: String(fullName || "").trim() || null
            },
            transaction
        }
    );

    return { userId, email, password };
};

/* "  Ayeza ", "Khan" -> "Ayeza Khan"; a missing half is dropped, not padded. */
const displayName = (first, last) =>
    [first, last].map((p) => String(p || "").trim()).filter(Boolean).join(" ");

// ====================================================================
// ADMIT A STUDENT
// ====================================================================
/*
 * Creates, in one transaction:
 *   - the student's login            (users, role Student)
 *   - the student record             (students, with a generated reg. number)
 *   - the parent's login             (users, role Parent) — only if new
 *   - the parent record              (parents)
 *   - the link between them          (student_guardians)
 *
 * THE PARENT IS MATCHED BY EMAIL, NOT CREATED BLINDLY.
 *
 * This is the important rule. A parent with two children at the institute is
 * ordinary. If admitting the second child created a second parent account, or
 * regenerated the password on the first, that parent would find their existing
 * login broken and would see only one of their two children. So: if the email
 * already belongs to a parent, that parent is LINKED to the new student and
 * their password is left alone. The response says which happened, so the admin
 * knows whether there are parent credentials to hand over or not.
 */
const admitStudent = async (payload, actorUserId) => {
    const {
        first_name, last_name, cnic_bform, program_id, batch_id, section_id,
        current_semester_id, gender, phone, dob, address, nationality, blood_group,
        registration_number, parent
    } = payload;

    return sequelize.transaction(async (transaction) => {

        /*
         * The caller may bring their own registration number; otherwise one is
         * generated in the institute's format. Bulk import supplies it from the
         * CSV so numbers already printed on documents are preserved; the single
         * admission form leaves it out and takes the next in sequence.
         */
        const registrationNumber = registration_number
            ? await useSuppliedRegistrationNumber(registration_number, transaction)
            : await generateRegistrationNumber(batch_id, transaction);
        const studentEmail = await generateEmail(first_name, last_name, transaction);

        const studentLogin = await createLogin(
            {
                email: studentEmail,
                roleId: ROLES.STUDENT,
                phone,
                fullName: displayName(first_name, last_name)
            },
            transaction
        );

        const [studentId] = await sequelize.query(
            `INSERT INTO students
                (user_id, registration_number, first_name, last_name, cnic_bform,
                 phone, dob, program_id, batch_id, section_id, current_semester_id,
                 gender, address, nationality, blood_group,
                 academic_status, is_deleted, created_at, updated_at)
             VALUES
                (:userId, :registrationNumber, :firstName, :lastName, :cnic,
                 :phone, :dob, :programId, :batchId, :sectionId, :semesterId,
                 :gender, :address, :nationality, :bloodGroup,
                 'Active', 0, NOW(), NOW())`,
            {
                replacements: {
                    userId: studentLogin.userId,
                    registrationNumber,
                    firstName: first_name,
                    lastName: last_name,
                    cnic: cnic_bform,
                    phone: phone || null,
                    dob: dob || null,
                    programId: program_id,
                    batchId: batch_id,
                    sectionId: section_id || null,
                    semesterId: current_semester_id || null,
                    gender: gender || null,
                    address: address || null,
                    nationality: nationality || null,
                    bloodGroup: blood_group || null
                },
                transaction
            }
        );

        // ---- parent: link if known, create if not ----
        let parentResult = null;

        if (parent && parent.email) {
            const existing = await select(
                `SELECT p.parent_id, p.user_id, u.email,
                        CONCAT(p.first_name, ' ', p.last_name) AS name
                   FROM users u
                   JOIN parents p ON p.user_id = u.user_id
                  WHERE u.email = :email AND p.is_deleted = 0
                  LIMIT 1`,
                { email: parent.email },
                transaction
            );

            if (existing.length) {
                // Known parent. Link only — no new account, no new password.
                parentResult = {
                    parentId: existing[0].parent_id,
                    userId: existing[0].user_id,
                    name: existing[0].name,
                    email: existing[0].email,
                    created: false,
                    password: null
                };

            } else {
                // A parent email must not already belong to a non-parent
                // account, or we would be attaching a child to a teacher's or
                // an admin's login.
                const clash = await select(
                    "SELECT user_id, role_id FROM users WHERE email = :email LIMIT 1",
                    { email: parent.email },
                    transaction
                );

                if (clash.length) {
                    const error = new Error(
                        `${parent.email} already belongs to a non-parent account.`
                    );
                    error.status = 409;
                    throw error;
                }

                const parentLogin = await createLogin(
                    {
                        email: parent.email,
                        roleId: ROLES.PARENT,
                        phone: parent.phone,
                        fullName: displayName(parent.first_name, parent.last_name)
                    },
                    transaction
                );

                const [parentId] = await sequelize.query(
                    `INSERT INTO parents
                        (user_id, first_name, last_name, phone, occupation, is_deleted)
                     VALUES
                        (:userId, :firstName, :lastName, :phone, :occupation, 0)`,
                    {
                        replacements: {
                            userId: parentLogin.userId,
                            firstName: parent.first_name,
                            lastName: parent.last_name,
                            phone: parent.phone || null,
                            // The parent fills this in themselves later, from
                            // their own profile screen.
                            occupation: parent.occupation || null
                        },
                        transaction
                    }
                );

                parentResult = {
                    parentId,
                    userId: parentLogin.userId,
                    name: [parent.first_name, parent.last_name].filter(Boolean).join(" "),
                    email: parentLogin.email,
                    created: true,
                    password: parentLogin.password
                };
            }

            await sequelize.query(
                `INSERT IGNORE INTO student_guardians (student_id, parent_id, relationship)
                 VALUES (:studentId, :parentId, :relationship)`,
                {
                    replacements: {
                        studentId,
                        parentId: parentResult.parentId,
                        relationship: parent.relationship || "Guardian"
                    },
                    transaction
                }
            );
        }

        /*
         * The one and only time these passwords exist in readable form.
         * The caller shows them to the admin and then they are gone.
         */
        return {
            student: {
                studentId,
                userId: studentLogin.userId,
                registrationNumber,
                name: [first_name, last_name].filter(Boolean).join(" "),
                email: studentLogin.email,
                password: studentLogin.password
            },
            parent: parentResult
        };
    });
};

// ====================================================================
// ONBOARD A TEACHER
// ====================================================================
/*
 * Creates the login, the employee record and the teacher record, and optionally
 * assigns classes — all in one transaction.
 *
 * A teacher is three rows in this schema: `users` (the login), `employees` (the
 * HR record: name, department, designation, salary) and `teachers` (the
 * academic record: specialization). The admin screen asks once and this writes
 * all three, rather than leaving an employee with no teacher row or a teacher
 * whose employee record was never made.
 *
 * Class assignments go to `teacher_assignments` (teacher + subject + batch +
 * section, dated) and `teacher_subjects` (teacher + subject + batch). Both are
 * written because the rest of the system reads both: the workload view and the
 * faculty portal use teacher_subjects, while teacher_assignments carries the
 * section and the date.
 */
const onboardTeacher = async (payload) => {
    const {
        first_name, last_name, email, phone, department_id, designation,
        specialization, basic_salary, hire_date, employee_code,
        assignments = []
    } = payload;

    return sequelize.transaction(async (transaction) => {

        const teacherEmail = email || await generateEmail(first_name, last_name, transaction);

        const clash = await select(
            "SELECT user_id FROM users WHERE email = :email LIMIT 1",
            { email: teacherEmail },
            transaction
        );

        if (clash.length) {
            const error = new Error(`${teacherEmail} is already in use.`);
            error.status = 409;
            throw error;
        }

        const login = await createLogin(
            {
                email: teacherEmail,
                roleId: ROLES.TEACHER,
                phone,
                fullName: displayName(first_name, last_name)
            },
            transaction
        );

        // Employee codes follow EMP-0001 in the existing rows; generated the
        // same way as registration numbers so the sequence cannot collide.
        let code = employee_code;
        if (!code) {
            const [highest] = await select(
                `SELECT MAX(CAST(SUBSTRING(employee_code, 5) AS UNSIGNED)) AS top
                   FROM employees WHERE employee_code LIKE 'EMP-%' FOR UPDATE`,
                {},
                transaction
            );
            code = `EMP-${String(Number(highest?.top || 0) + 1).padStart(4, "0")}`;
        }

        const [employeeId] = await sequelize.query(
            `INSERT INTO employees
                (user_id, employee_code, first_name, last_name, department_id,
                 designation, basic_salary, hire_date, employment_status, is_deleted)
             VALUES
                (:userId, :code, :firstName, :lastName, :departmentId,
                 :designation, :salary, :hireDate, 'Active', 0)`,
            {
                replacements: {
                    userId: login.userId,
                    code,
                    firstName: first_name,
                    lastName: last_name,
                    departmentId: department_id || null,
                    designation: designation || "Lecturer",
                    salary: basic_salary || 0,
                    hireDate: hire_date || new Date().toISOString().slice(0, 10)
                },
                transaction
            }
        );

        const [teacherId] = await sequelize.query(
            `INSERT INTO teachers (employee_id, specialization, is_deleted)
             VALUES (:employeeId, :specialization, 0)`,
            {
                replacements: {
                    employeeId,
                    specialization: specialization || null
                },
                transaction
            }
        );

        // ---- class assignments ----
        for (const a of assignments) {
            if (!a.subject_id || !a.batch_id) continue;

            await sequelize.query(
                `INSERT INTO teacher_assignments
                    (teacher_id, subject_id, batch_id, section_id, assigned_date)
                 VALUES (:teacherId, :subjectId, :batchId, :sectionId, CURDATE())`,
                {
                    replacements: {
                        teacherId,
                        subjectId: a.subject_id,
                        batchId: a.batch_id,
                        sectionId: a.section_id || null
                    },
                    transaction
                }
            );

            await sequelize.query(
                /*
                 * The qualification carries no batch: recording that somebody
                 * may teach a subject is a statement about them, not about a
                 * cohort. INSERT IGNORE matters more than it used to - the key
                 * is now (teacher, subject), so provisioning the same teacher
                 * for the same subject against a second batch is a no-op here
                 * rather than a second row.
                 */
                `INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id)
                 VALUES (:teacherId, :subjectId)`,
                {
                    replacements: {
                        teacherId,
                        subjectId: a.subject_id
                    },
                    transaction
                }
            );
        }

        return {
            teacher: {
                teacherId,
                employeeId,
                userId: login.userId,
                employeeCode: code,
                name: [first_name, last_name].filter(Boolean).join(" "),
                email: login.email,
                password: login.password,
                assignmentCount: assignments.length
            }
        };
    });
};

// ====================================================================
// REISSUE CREDENTIALS
// ====================================================================
/*
 * Issues a NEW password for an existing account and returns it once.
 *
 * This is the answer to "the admin closed the popup before writing it down".
 * There is deliberately no way to retrieve the old one: the database holds a
 * bcrypt hash, and a system that can show an administrator a user's existing
 * password is a system where no password is private.
 *
 * The new password carries must_change_password, exactly as the first one did.
 */
const reissueCredentials = async (userId) => {
    const [account] = await select(
        `SELECT u.user_id, u.email, u.role_id, r.role_name
           FROM users u
           LEFT JOIN roles r ON r.role_id = u.role_id
          WHERE u.user_id = :userId AND u.is_deleted = 0`,
        { userId }
    );

    if (!account) return null;

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await sequelize.query(
        `UPDATE users
            SET password_hash = :passwordHash,
                must_change_password = 1,
                credentials_issued_at = NOW(),
                failed_login_attempts = 0,
                updated_at = NOW()
          WHERE user_id = :userId`,
        { replacements: { passwordHash, userId } }
    );

    return {
        userId: account.user_id,
        email: account.email,
        role: account.role_name,
        password
    };
};

module.exports = {
    admitStudent,
    onboardTeacher,
    reissueCredentials,
    /*
     * Shared with peopleAdminService, which creates admin and parent accounts.
     *
     * They are exported rather than duplicated because the three rules they
     * encode — the password alphabet excludes the characters that are misread
     * when a password is read aloud or copied off a screen, the account is
     * flagged must_change_password, and the institute email is allocated in one
     * consistent format — have to hold for every account this system issues. A
     * second implementation is a second set of rules that will drift.
     */
    createLogin,
    generateEmail,
    // exported for the test suite
    generatePassword,
    generateRegistrationNumber
};
