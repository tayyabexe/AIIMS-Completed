/*
 * The people an admin manages that no screen could manage: staff accounts and
 * parents.
 *
 * WHY THIS MODULE EXISTS
 * ---------------------
 * Provisioning creates people. Nothing amended or removed them afterwards.
 *
 *   - Staff logins had no endpoint at all. The only way to add an administrator
 *     was to INSERT into `users` by hand, and the only way to remove one was to
 *     UPDATE it by hand. Eight of the nine Admin accounts in this database are
 *     called admin1@ … admin5@, testuser@, newadmin123@ and admin100@, which is
 *     what happens when accounts are created outside a screen that asks who the
 *     person is.
 *   - Parents had register / login / list / profile and nothing else. A guardian
 *     linked to the wrong child stayed linked to the wrong child: there was no
 *     update, no delete, and no way to move a link — `student_guardians` was
 *     written once by admission and never touched again.
 *
 * WHAT THE GUARDS ARE FOR
 * -----------------------
 * Three rules are enforced here rather than in the controller, because they are
 * properties of the data and not of the request:
 *
 *   1. An admin cannot delete or deactivate their own account. The failure mode
 *      is not theoretical — it is one click, and it locks the person who made it
 *      out of the only screen that could undo it.
 *   2. Only a Super Admin may read-modify-write a Super Admin row, create one,
 *      or promote anyone into the role. Otherwise the eight ordinary Admins can
 *      each grant themselves the role that has no ceiling.
 *   3. The institute may never be left with zero active Super Admins.
 *
 * DELETE MEANS SOFT-DELETE **AND** DEACTIVATE
 * -------------------------------------------
 * Both columns, always, for every person removed here. `is_deleted` is what the
 * lists filter on and `is_active` is what the login checks, and setting only the
 * first is exactly the hole this session was asked to close in teacherService: a
 * "deleted" person who can still sign in is not deleted, they are hidden.
 *
 * ON THE EMPLOYEE RECORD
 * ----------------------
 * `users` has no name column — an account is an email address and a role. A
 * staff member's name lives on `employees`, whose `department_id` is NOT NULL.
 * So a name can only be stored against a department, and an administrator does
 * not necessarily belong to one: that is precisely why the existing Admin rows
 * have no employee record and no name, while the HR, Accounts and Library
 * accounts have one each, filed under whichever academic department the seed
 * data happened to pick.
 *
 * The employee record is therefore created when a department is named and
 * skipped when it is not, rather than forcing the caller to invent a department
 * to hold a name. `hasEmployeeRecord` on every row says which kind of account it
 * is.
 *
 * A name no longer depends on that record. `users.full_name` holds the name for
 * any account, with or without a department, so only rows predating that column
 * fall back to the local part of the email. `nameOnFile` says which rows those
 * are — that, not `hasEmployeeRecord`, is what a screen should warn on.
 */

const { sequelize } = require("../database/connection");
const { ROLES } = require("../config/roles");
const provisioning = require("./provisioningService");

/*
 * Every role that is staff rather than a portal user.
 *
 * One list rather than a check per call site: HR, Accountant and Library Staff
 * had no management screen of any kind before this, and they are administered by
 * the same people, from the same table, under the same guards as an Admin. The
 * only role in here that is treated differently is Super Admin, and that
 * difference is spelled out at each of the three places it applies.
 */
const STAFF_ROLE_IDS = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.HR,
    ROLES.ACCOUNTANT,
    ROLES.LIBRARY
];

const RELATIONSHIPS = ["Father", "Mother", "Guardian"];

const select = (sql, replacements, transaction) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements,
        transaction
    });

const insert = (sql, replacements, transaction) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.INSERT,
        replacements,
        transaction
    });

const execute = (sql, replacements, transaction) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.UPDATE,
        replacements,
        transaction
    });

// ------------------------------------------------------------------ helpers

/**
 * An error the controller turns into a 4xx rather than a 500 — the same
 * contract academicStructureService uses, including `blockedBy`, so one
 * error-shaped response covers every admin CRUD screen.
 */
const fail = (status, message, extra = {}) => {
    const error = new Error(message);
    error.status = status;
    Object.assign(error, extra);
    return error;
};

const asId = (value) => {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const asText = (value, { max, label, required = false }) => {
    if (value === undefined || value === null) {
        if (required) throw fail(400, `${label} is required.`);
        return undefined;
    }

    const text = String(value).trim();

    if (!text) {
        if (required) throw fail(400, `${label} is required.`);
        return undefined;
    }
    if (text.length > max) {
        throw fail(400, `${label} cannot be longer than ${max} characters.`);
    }

    return text;
};

const asEmail = (value, { required = false } = {}) => {
    const text = asText(value, { max: 255, label: "Email", required });
    if (text === undefined) return undefined;

    // Deliberately loose. The address has to be deliverable to a real person and
    // unique in `users`; anything stricter here rejects addresses that work.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        throw fail(400, `"${text}" is not a valid email address.`);
    }

    return text.toLowerCase();
};

const asPhone = (value) => {
    if (value === undefined) return undefined;
    if (value === null || String(value).trim() === "") return null;
    return asText(value, { max: 20, label: "Phone" });
};

/** Whether a value the client sent means "on". */
const asFlag = (value) =>
    value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;

// Same rule as academicStructureService: these strings are read by an admin on
// a refused delete, and a bare "s" turns "batch" into "batchs".
const plural = (n, word) => {
    if (n === 1) return `${n} ${word}`;
    const suffix = /(?:s|x|z|ch|sh)$/i.test(word) ? "es" : "s";
    return `${n} ${word}${suffix}`;
};

/**
 * Refuses a delete while other rows still point at this one, naming all of them
 * at once. Same shape as academicStructureService.refuseIfReferenced — the
 * screens read `blockedBy` and render it verbatim.
 */
const refuseIfReferenced = async (label, blockers) => {
    const counts = await Promise.all(
        blockers.map(async (blocker) => {
            const [row] = await select(blocker.sql, blocker.replacements);
            return { n: Number(row?.n || 0), describe: blocker.describe };
        })
    );

    const blocking = counts.filter((c) => c.n > 0);

    if (blocking.length) {
        throw fail(
            409,
            `This ${label} is still in use: ${blocking.map((c) => c.describe(c.n)).join(", ")}. `
            + "Remove those first.",
            { blockedBy: blocking.map((c) => c.describe(c.n)) }
        );
    }
};

/**
 * The email address as a display name — the last resort, for an account with
 * neither an employee record nor a `users.full_name`.
 *
 * This IS a guess: nothing about the person is on file, so it is derived rather
 * than stored, and `nameOnFile: false` travels with it so a screen can offer to
 * fill the real one in.
 */
const nameFromEmail = (email) =>
    String(email || "").split("@")[0].replace(/[._-]+/g, " ").trim() || "Unnamed account";

// ==========================================================================
// STAFF ACCOUNTS  -  /api/admin/admins
// ==========================================================================

const ADMIN_COLUMNS = `
    u.user_id, u.email, u.role_id, u.phone, u.is_active, u.full_name,
    u.must_change_password, u.last_login, u.credentials_issued_at,
    u.created_at, u.updated_at,
    r.role_name,
    e.employee_id, e.employee_code, e.first_name, e.last_name,
    e.designation, e.department_id, e.employment_status, e.hire_date,
    d.department_name
`;

const ADMIN_FROM = `
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN employees   e ON e.user_id       = u.user_id AND e.is_deleted = 0
    LEFT JOIN departments d ON d.department_id = e.department_id
`;

const toAdmin = (r) => {

    /*
     * Employees row first, then the account's own `full_name`, then the email.
     *
     * That middle step is new and is the point: an admin created without a
     * department has no employees row, so `first_name` is NULL and this fell
     * straight through to nameFromEmail - which is how a real person's name,
     * typed into the create form and validated as required, was replaced on
     * screen by a mangling of their email address.
     *
     * nameFromEmail survives at the end for accounts that predate
     * `users.full_name`. It is a last resort now, not the normal path.
     */
    const fullName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim()
        || String(r.full_name || "").trim();

    return {
        /*
         * Whether the name shown below is a STORED name or a guess.
         *
         * This is what a screen should use to warn "no name on file" — not
         * `hasEmployeeRecord`. The two used to be the same question and are not
         * any more: since `users.full_name` exists, an account created without a
         * department has no employees row yet still has the name that was typed
         * into the create form. Keying the warning off the employees row meant
         * such an account displayed its real name and a "name not on file" badge
         * at the same time, which is a contradiction on its face.
         *
         * False here means `fullName` came out empty and `name` below is the
         * email local part — a guess, and the only accounts a screen should be
         * offering to fix.
         */
        nameOnFile: !!fullName,

        id: r.user_id,
        userId: r.user_id,
        email: r.email,
        name: fullName || nameFromEmail(r.email),
        firstName: r.first_name || null,
        lastName: r.last_name || null,
        roleId: r.role_id,
        role: r.role_name,
        isSuperAdmin: r.role_id === ROLES.SUPER_ADMIN,
        phone: r.phone || null,
        isActive: !!r.is_active,
        // The account has been issued a password it has not yet replaced, so
        // nobody has signed in as this person since it was created.
        mustChangePassword: !!r.must_change_password,
        lastLogin: r.last_login || null,
        credentialsIssuedAt: r.credentials_issued_at || null,
        createdAt: r.created_at || null,

        /*
         * Whether an `employees` row exists — i.e. whether this account has a
         * department, designation, employee code and employment status.
         *
         * NOT a test for whether a name is on file; use `nameOnFile` above for
         * that. This one governs the employment fields only.
         */
        hasEmployeeRecord: r.employee_id != null,
        employeeId: r.employee_id ?? null,
        employeeCode: r.employee_code || null,
        designation: r.designation || null,
        departmentId: r.department_id ?? null,
        department: r.department_name || null,
        employmentStatus: r.employment_status || null,
        hireDate: r.hire_date || null
    };
};

const listAdmins = async (queryParams = {}) => {
    const clauses = ["u.is_deleted = 0", "u.role_id IN (:roleIds)"];
    const replacements = { roleIds: STAFF_ROLE_IDS };

    const roleId = asId(queryParams.role_id);
    if (roleId) {
        if (!STAFF_ROLE_IDS.includes(roleId)) {
            throw fail(400, "That role is not a staff role.");
        }
        clauses.push("u.role_id = :roleId");
        replacements.roleId = roleId;
    }

    // Absent means both; the screen's default is "everyone", because an account
    // that has been switched off is the one most often being looked for.
    if (queryParams.is_active === "1" || queryParams.is_active === "0") {
        clauses.push("u.is_active = :isActive");
        replacements.isActive = Number(queryParams.is_active);
    }

    if (queryParams.q) {
        clauses.push(
            `(u.email LIKE :q
              OR u.phone LIKE :q
              OR r.role_name LIKE :q
              OR e.employee_code LIKE :q
              OR e.designation LIKE :q
              OR d.department_name LIKE :q
              OR CONCAT(e.first_name, ' ', e.last_name) LIKE :q)`
        );
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM}
          WHERE ${clauses.join(" AND ")}
          ORDER BY u.role_id, e.first_name, u.email`,
        replacements
    );

    return rows.map(toAdmin);
};

const getAdmin = async (userId) => {
    const [row] = await select(
        `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM}
          WHERE u.user_id = :userId AND u.is_deleted = 0 AND u.role_id IN (:roleIds)
          LIMIT 1`,
        { userId, roleIds: STAFF_ROLE_IDS }
    );

    return row ? toAdmin(row) : null;
};

/** The row as it is now, for the guards below — including deleted ones. */
const findAccount = async (userId, transaction) => {
    const [row] = await select(
        `SELECT u.user_id, u.email, u.role_id, u.is_active, u.is_deleted,
                u.full_name,
                e.employee_id, e.first_name, e.last_name
           FROM users u
           LEFT JOIN employees e ON e.user_id = u.user_id AND e.is_deleted = 0
          WHERE u.user_id = :userId
          LIMIT 1`,
        { userId },
        transaction
    );

    return row || null;
};

/**
 * Rule 2 from the header, in one place so no write can forget it.
 *
 * Applies to the row being touched AND to the role being assigned: promoting
 * someone else to Super Admin is the same act as editing a Super Admin, done
 * from the other end.
 */
const refuseSuperAdminEscalation = (actor, { targetRoleId, nextRoleId }) => {
    if (actor?.role_id === ROLES.SUPER_ADMIN) return;

    if (targetRoleId === ROLES.SUPER_ADMIN) {
        throw fail(403, "Only a Super Admin can change a Super Admin account.");
    }
    if (nextRoleId === ROLES.SUPER_ADMIN) {
        throw fail(403, "Only a Super Admin can grant the Super Admin role.");
    }
};

/** Rule 1: never let the signed-in admin remove their own way back in. */
const refuseSelfHarm = (actor, userId, what) => {
    if (Number(actor?.user_id) === Number(userId)) {
        throw fail(409, `You cannot ${what} your own account.`);
    }
};

/**
 * Rule 3. Checked by counting the others rather than by trusting the caller not
 * to be the last one — a Super Admin demoted by role change and a Super Admin
 * deleted are the same outcome for the institute.
 */
const refuseLastSuperAdmin = async (userId, transaction) => {
    const [{ n }] = await select(
        `SELECT COUNT(*) AS n FROM users
          WHERE role_id = :roleId AND is_deleted = 0 AND is_active = 1
            AND user_id <> :userId`,
        { roleId: ROLES.SUPER_ADMIN, userId },
        transaction
    );

    if (Number(n) === 0) {
        throw fail(409,
            "This is the only active Super Admin. Grant the role to someone else "
            + "before removing it from this account.");
    }
};

/** employee_code is NOT NULL and UNIQUE; generated in the EMP-0001 format. */
const nextEmployeeCode = async (transaction) => {
    const [row] = await select(
        `SELECT MAX(CAST(SUBSTRING(employee_code, 5) AS UNSIGNED)) AS top
           FROM employees WHERE employee_code LIKE 'EMP-%' FOR UPDATE`,
        {},
        transaction
    );

    return `EMP-${String(Number(row?.top || 0) + 1).padStart(4, "0")}`;
};

/*
 * Creating a staff account.
 *
 * The login is created by provisioningService.createLogin and the address by
 * generateEmail — not reimplemented here — so an administrator's password obeys
 * the same alphabet, the same must_change_password flag and the same one-time
 * disclosure as a student's. A second implementation is a second set of rules
 * that will drift; see the export comment on those two functions.
 */
const createAdmin = async (body, actor) => {
    const roleId = asId(body.role_id);
    if (!roleId || !STAFF_ROLE_IDS.includes(roleId)) {
        throw fail(400, "role_id must be one of the staff roles.");
    }

    refuseSuperAdminEscalation(actor, { nextRoleId: roleId });

    const firstName = asText(body.first_name, { max: 100, label: "First name", required: true });
    const lastName = asText(body.last_name, { max: 100, label: "Last name", required: true });
    const phone = asPhone(body.phone) ?? null;
    const designation = asText(body.designation, { max: 100, label: "Designation" });

    /*
     * A department turns this into a person with a name on file; without one
     * there is nowhere to put the name, because employees.department_id is NOT
     * NULL. See the header. It is optional rather than required so nobody has to
     * file the registrar under Electrical Engineering to give them a login.
     */
    const departmentId = body.department_id === undefined || body.department_id === null
        || body.department_id === ""
        ? null
        : asId(body.department_id);

    if (body.department_id && !departmentId) {
        throw fail(400, "department_id must be a numeric department id.");
    }

    if (departmentId) {
        const [department] = await select(
            "SELECT department_id FROM departments WHERE department_id = :id AND is_deleted = 0",
            { id: departmentId }
        );
        if (!department) throw fail(400, `Department ${departmentId} does not exist.`);
    }

    const requestedEmail = asEmail(body.email);

    const created = await sequelize.transaction(async (transaction) => {
        const email = requestedEmail
            || await provisioning.generateEmail(firstName, lastName, transaction);

        // The UNIQUE index on users.email is the backstop, but it raises an
        // error the admin cannot act on. Checking inside the transaction turns
        // it into a message that names the address.
        const [clash] = await select(
            "SELECT user_id, is_deleted FROM users WHERE email = :email LIMIT 1",
            { email },
            transaction
        );

        if (clash) {
            throw fail(409, clash.is_deleted
                ? `${email} belonged to a deleted account and cannot be reused.`
                : `${email} is already in use.`);
        }

        /*
         * `fullName` goes onto the account itself, not only onto the employees
         * row below.
         *
         * This is the case that made `users.full_name` necessary. The employees
         * insert is CONDITIONAL on a department being supplied, and a
         * department is optional here on purpose - nobody should have to file
         * the registrar under Electrical Engineering just to give them a login.
         * So an admin created without one had their name collected, validated,
         * and then dropped on the floor: no students row, no employees row,
         * nowhere for "Ayesha Siddiqui" to live.
         *
         * The portal then displayed whatever it could derive from the email
         * address, which is how administrators came to be greeted as "Admin2"
         * by their own dashboard and by the AI assistant.
         */
        const login = await provisioning.createLogin(
            {
                email,
                roleId,
                phone,
                fullName: [firstName, lastName].filter(Boolean).join(" ")
            },
            transaction
        );

        if (departmentId) {
            await insert(
                `INSERT INTO employees
                    (user_id, employee_code, first_name, last_name, department_id,
                     designation, basic_salary, hire_date, employment_status, is_deleted)
                 VALUES
                    (:userId, :code, :firstName, :lastName, :departmentId,
                     :designation, :salary, :hireDate, 'Active', 0)`,
                {
                    userId: login.userId,
                    code: asText(body.employee_code, { max: 20, label: "Employee code" })
                        || await nextEmployeeCode(transaction),
                    firstName,
                    lastName,
                    departmentId,
                    designation: designation || null,
                    // NOT NULL columns this screen has no business asking about.
                    salary: body.basic_salary ?? 0,
                    hireDate: body.hire_date || new Date().toISOString().slice(0, 10)
                },
                transaction
            );
        }

        return login;
    });

    const row = await getAdmin(created.userId);

    /*
     * The one and only time this password exists in readable form. It is
     * returned beside the row rather than stored on it, so the controller can
     * hand it to the admin once and the audit log — which strips anything
     * password-shaped — cannot record it.
     */
    return { ...row, password: created.password };
};

const updateAdmin = async (userId, body, actor) => {
    const account = await findAccount(userId);

    if (!account || account.is_deleted) throw fail(404, "That account does not exist.");
    if (!STAFF_ROLE_IDS.includes(account.role_id)) {
        throw fail(400, "That account is not a staff account and is not managed here.");
    }

    const nextRoleId = body.role_id === undefined ? undefined : asId(body.role_id);
    if (body.role_id !== undefined && (!nextRoleId || !STAFF_ROLE_IDS.includes(nextRoleId))) {
        throw fail(400, "role_id must be one of the staff roles.");
    }

    refuseSuperAdminEscalation(actor, {
        targetRoleId: account.role_id,
        nextRoleId
    });

    /*
     * Rule 1 covers more than delete. Switching off your own account, or
     * demoting yourself out of the role that reaches this screen, locks you out
     * exactly as thoroughly — and the row that could undo it is the one you just
     * changed. Editing your own name or phone number is fine and stays allowed.
     */
    const deactivatingSelf = body.is_active !== undefined && !asFlag(body.is_active);
    const demotingSelf = nextRoleId !== undefined && nextRoleId !== account.role_id;

    if (deactivatingSelf) refuseSelfHarm(actor, userId, "deactivate");
    if (demotingSelf) refuseSelfHarm(actor, userId, "change the role on");

    // Rule 3, for the two ways a Super Admin can stop being one.
    if (account.role_id === ROLES.SUPER_ADMIN && (deactivatingSelf || demotingSelf)) {
        await refuseLastSuperAdmin(userId);
    }

    const userSets = [];
    const userValues = { userId };

    const email = asEmail(body.email);
    if (email !== undefined) {
        const [clash] = await select(
            "SELECT user_id FROM users WHERE email = :email AND user_id <> :userId LIMIT 1",
            { email, userId }
        );
        if (clash) throw fail(409, `${email} is already in use.`);

        userSets.push("email = :email");
        userValues.email = email;
    }

    const phone = asPhone(body.phone);
    if (phone !== undefined) {
        userSets.push("phone = :phone");
        userValues.phone = phone;
    }

    if (body.is_active !== undefined) {
        userSets.push("is_active = :isActive");
        userValues.isActive = asFlag(body.is_active);
    }

    if (nextRoleId !== undefined) {
        userSets.push("role_id = :roleId");
        userValues.roleId = nextRoleId;
    }

    // Fields belonging to `employees` are written there, not onto `users`, or
    // editing a name silently does nothing — the same bug teacherService.update
    // already had to fix.
    const employeeValues = {};

    const firstName = asText(body.first_name, { max: 100, label: "First name" });
    if (firstName !== undefined) employeeValues.first_name = firstName;

    const lastName = asText(body.last_name, { max: 100, label: "Last name" });
    if (lastName !== undefined) employeeValues.last_name = lastName;

    /*
     * A name change also updates `users.full_name`.
     *
     * The comment above is right that a name belongs on `employees` — but this
     * screen manages accounts that may have no employees row at all, because
     * the department that row requires is optional. For those, `users` is the
     * ONLY place the name exists, and writing it solely to `employees` would
     * silently do nothing: exactly the bug the comment above warns about,
     * one table further along.
     *
     * Written whenever either half changes, using the incoming value where one
     * was supplied and the account's existing value where it was not, so
     * correcting only a surname does not blank the given name.
     */
    if (firstName !== undefined || lastName !== undefined) {

        const merged = [
            firstName !== undefined ? firstName : account.first_name,
            lastName !== undefined ? lastName : account.last_name
        ].filter(Boolean).join(" ").trim();

        if (merged) {
            userSets.push("full_name = :fullName");
            userValues.fullName = merged;
        }
    }

    const designation = asText(body.designation, { max: 100, label: "Designation" });
    if (designation !== undefined) employeeValues.designation = designation;

    if (body.department_id !== undefined) {
        const departmentId = asId(body.department_id);
        if (!departmentId) throw fail(400, "department_id must be a numeric department id.");

        const [department] = await select(
            "SELECT department_id FROM departments WHERE department_id = :id AND is_deleted = 0",
            { id: departmentId }
        );
        if (!department) throw fail(400, `Department ${departmentId} does not exist.`);

        employeeValues.department_id = departmentId;
    }

    if (body.employment_status !== undefined) {
        const status = asText(body.employment_status, { max: 20, label: "Employment status" });
        if (!["Active", "On Leave", "Terminated", "Retired"].includes(status)) {
            throw fail(400, "employment_status must be Active, On Leave, Terminated or Retired.");
        }
        employeeValues.employment_status = status;
    }

    const employeeKeys = Object.keys(employeeValues);

    if (!userSets.length && !employeeKeys.length) throw fail(400, "Nothing to update.");

    await sequelize.transaction(async (transaction) => {
        if (userSets.length) {
            await execute(
                `UPDATE users SET ${userSets.join(", ")}, updated_at = NOW()
                  WHERE user_id = :userId`,
                userValues,
                transaction
            );
        }

        if (!employeeKeys.length) return;

        if (account.employee_id) {
            await execute(
                `UPDATE employees SET ${employeeKeys.map((k) => `${k} = :${k}`).join(", ")}
                  WHERE employee_id = :employeeId`,
                { ...employeeValues, employeeId: account.employee_id },
                transaction
            );
            return;
        }

        /*
         * No employee record yet — one of the nameless accounts described in the
         * header. A name can be given to it, but only together with the
         * department the row cannot be written without, so the request has to
         * carry both rather than half-creating a record.
         */
        if (!employeeValues.department_id) {
            throw fail(400,
                "This account has no staff record yet, so a name cannot be stored "
                + "against it. Send department_id together with the name to create one.");
        }

        if (!employeeValues.first_name || !employeeValues.last_name) {
            throw fail(400,
                "Creating the staff record for this account needs both first_name "
                + "and last_name.");
        }

        await insert(
            `INSERT INTO employees
                (user_id, employee_code, first_name, last_name, department_id,
                 designation, basic_salary, hire_date, employment_status, is_deleted)
             VALUES
                (:userId, :code, :firstName, :lastName, :departmentId,
                 :designation, 0, CURDATE(), :status, 0)`,
            {
                userId,
                code: await nextEmployeeCode(transaction),
                firstName: employeeValues.first_name,
                lastName: employeeValues.last_name,
                departmentId: employeeValues.department_id,
                designation: employeeValues.designation || null,
                status: employeeValues.employment_status || "Active"
            },
            transaction
        );
    });

    return getAdmin(userId);
};

const deleteAdmin = async (userId, actor) => {
    const account = await findAccount(userId);

    if (!account || account.is_deleted) throw fail(404, "That account does not exist.");
    if (!STAFF_ROLE_IDS.includes(account.role_id)) {
        throw fail(400, "That account is not a staff account and is not managed here.");
    }

    refuseSelfHarm(actor, userId, "delete");
    refuseSuperAdminEscalation(actor, { targetRoleId: account.role_id });

    if (account.role_id === ROLES.SUPER_ADMIN) await refuseLastSuperAdmin(userId);

    await sequelize.transaction(async (transaction) => {
        // Both columns. See the header: is_deleted hides the row, is_active is
        // what the login actually checks.
        await execute(
            `UPDATE users SET is_deleted = 1, is_active = 0, updated_at = NOW()
              WHERE user_id = :userId`,
            { userId },
            transaction
        );

        if (account.employee_id) {
            await execute(
                "UPDATE employees SET is_deleted = 1 WHERE employee_id = :employeeId",
                { employeeId: account.employee_id },
                transaction
            );
        }
    });

    return { id: userId, userId, deleted: true };
};

// ==========================================================================
// PARENTS  -  /api/admin/parents
// ==========================================================================
/*
 * A parent is two rows — `users` for the login and `parents` for the person —
 * plus a `student_guardians` row per child. Admission writes all of them; until
 * now nothing could change any of them.
 */

const PARENT_COLUMNS = `
    p.parent_id, p.user_id, p.first_name, p.last_name, p.phone, p.occupation,
    u.email, u.is_active, u.must_change_password, u.last_login,
    u.credentials_issued_at, u.created_at
`;

const childrenOf = async (parentIds) => {
    if (!parentIds.length) return new Map();

    const rows = await select(
        `SELECT sg.parent_id, sg.relationship,
                s.student_id, s.registration_number, s.academic_status,
                CONCAT(s.first_name, ' ', s.last_name) AS name,
                pr.program_name
           FROM student_guardians sg
           JOIN students  s  ON s.student_id  = sg.student_id AND s.is_deleted = 0
           LEFT JOIN programs pr ON pr.program_id = s.program_id
          WHERE sg.parent_id IN (:parentIds)
          ORDER BY s.first_name, s.last_name`,
        { parentIds }
    );

    const byParent = new Map();

    for (const r of rows) {
        const list = byParent.get(r.parent_id) || [];
        list.push({
            studentId: r.student_id,
            name: String(r.name || "").trim(),
            registrationNumber: r.registration_number,
            relationship: r.relationship,
            program: r.program_name || null,
            academicStatus: r.academic_status || null
        });
        byParent.set(r.parent_id, list);
    }

    return byParent;
};

const toParent = (r, children) => ({
    id: r.parent_id,
    parentId: r.parent_id,
    userId: r.user_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email || null,
    phone: r.phone || null,
    occupation: r.occupation || null,
    isActive: !!r.is_active,
    mustChangePassword: !!r.must_change_password,
    lastLogin: r.last_login || null,
    credentialsIssuedAt: r.credentials_issued_at || null,
    createdAt: r.created_at || null,
    children,
    childCount: children.length
});

const getParent = async (parentId) => {
    const [row] = await select(
        `SELECT ${PARENT_COLUMNS}
           FROM parents p
           LEFT JOIN users u ON u.user_id = p.user_id
          WHERE p.parent_id = :parentId AND p.is_deleted = 0
          LIMIT 1`,
        { parentId }
    );

    if (!row) return null;

    const children = await childrenOf([parentId]);

    return toParent(row, children.get(parentId) || []);
};

/**
 * Creates the login, the parent record and any guardian links, in one
 * transaction — the same guarantee provisioningService.admitStudent gives, for
 * the case where the parent arrives before the child does.
 */
const createParent = async (body) => {
    const firstName = asText(body.first_name, { max: 100, label: "First name", required: true });
    const lastName = asText(body.last_name, { max: 100, label: "Last name", required: true });
    const phone = asPhone(body.phone) ?? null;
    const occupation = asText(body.occupation, { max: 100, label: "Occupation" }) || null;
    const requestedEmail = asEmail(body.email);

    // Children may be named at creation. Validated before the transaction opens
    // so a bad student id fails the request rather than rolling back an account
    // that has already had a password generated for it.
    const links = readChildLinks(body.children);

    const created = await sequelize.transaction(async (transaction) => {
        const email = requestedEmail
            || await provisioning.generateEmail(firstName, lastName, transaction);

        const [clash] = await select(
            "SELECT user_id, role_id, is_deleted FROM users WHERE email = :email LIMIT 1",
            { email },
            transaction
        );

        if (clash) {
            /*
             * The message distinguishes the two cases because the remedies are
             * opposite: an existing PARENT account should be linked to the new
             * child, not duplicated — that is the rule admitStudent enforces and
             * the reason a parent with two children keeps one working login.
             */
            throw fail(409, clash.role_id === ROLES.PARENT
                ? `${email} already belongs to a parent. Link the child to that `
                  + "account instead of creating a second one."
                : `${email} is already in use by another account.`);
        }

        const login = await provisioning.createLogin(
            { email, roleId: ROLES.PARENT, phone },
            transaction
        );

        const [parentId] = await insert(
            `INSERT INTO parents
                (user_id, first_name, last_name, phone, occupation, is_deleted)
             VALUES (:userId, :firstName, :lastName, :phone, :occupation, 0)`,
            {
                userId: login.userId,
                firstName,
                lastName,
                phone,
                occupation
            },
            transaction
        );

        for (const link of links) {
            await mustBeALinkableStudent(link.student_id, transaction);

            await insert(
                `INSERT IGNORE INTO student_guardians (student_id, parent_id, relationship)
                 VALUES (:studentId, :parentId, :relationship)`,
                {
                    studentId: link.student_id,
                    parentId,
                    relationship: link.relationship
                },
                transaction
            );
        }

        return { parentId, password: login.password };
    });

    const row = await getParent(created.parentId);

    return { ...row, password: created.password };
};

const updateParent = async (parentId, body) => {
    const [parent] = await select(
        `SELECT p.parent_id, p.user_id FROM parents p
          WHERE p.parent_id = :parentId AND p.is_deleted = 0`,
        { parentId }
    );

    if (!parent) throw fail(404, "That parent does not exist.");

    const parentValues = {};

    const firstName = asText(body.first_name, { max: 100, label: "First name" });
    if (firstName !== undefined) parentValues.first_name = firstName;

    const lastName = asText(body.last_name, { max: 100, label: "Last name" });
    if (lastName !== undefined) parentValues.last_name = lastName;

    if (body.occupation !== undefined) {
        parentValues.occupation = body.occupation === null || body.occupation === ""
            ? null
            : asText(body.occupation, { max: 100, label: "Occupation" });
    }

    const phone = asPhone(body.phone);
    if (phone !== undefined) parentValues.phone = phone;

    const userSets = [];
    const userValues = { userId: parent.user_id };

    const email = asEmail(body.email);
    if (email !== undefined) {
        const [clash] = await select(
            "SELECT user_id FROM users WHERE email = :email AND user_id <> :userId LIMIT 1",
            { email, userId: parent.user_id }
        );
        if (clash) throw fail(409, `${email} is already in use.`);

        userSets.push("email = :email");
        userValues.email = email;
    }

    // The phone is stored on both rows in this schema and the two are shown in
    // different places, so an edit writes both rather than leaving them to
    // disagree about how to reach the same person.
    if (phone !== undefined) {
        userSets.push("phone = :phone");
        userValues.phone = phone;
    }

    if (body.is_active !== undefined) {
        userSets.push("is_active = :isActive");
        userValues.isActive = asFlag(body.is_active);
    }

    const parentKeys = Object.keys(parentValues);

    if (!parentKeys.length && !userSets.length) throw fail(400, "Nothing to update.");

    await sequelize.transaction(async (transaction) => {
        if (parentKeys.length) {
            await execute(
                `UPDATE parents SET ${parentKeys.map((k) => `${k} = :${k}`).join(", ")}
                  WHERE parent_id = :parentId`,
                { ...parentValues, parentId },
                transaction
            );
        }

        if (userSets.length) {
            await execute(
                `UPDATE users SET ${userSets.join(", ")}, updated_at = NOW()
                  WHERE user_id = :userId`,
                userValues,
                transaction
            );
        }
    });

    return getParent(parentId);
};

/*
 * Removing a parent.
 *
 * Refuses while children are still linked, and names them. A parent is the only
 * contact on record for a student, so deleting one silently would leave those
 * students with no guardian and nothing on the screen to say it had happened —
 * the unlink endpoint below exists precisely so the admin can do it
 * deliberately, one child at a time.
 */
const deleteParent = async (parentId) => {
    const [parent] = await select(
        `SELECT p.parent_id, p.user_id,
                CONCAT(p.first_name, ' ', p.last_name) AS name
           FROM parents p
          WHERE p.parent_id = :parentId AND p.is_deleted = 0`,
        { parentId }
    );

    if (!parent) throw fail(404, "That parent does not exist.");

    const children = (await childrenOf([parentId])).get(parentId) || [];

    if (children.length) {
        const names = children.map((c) => `${c.name} (${c.registrationNumber})`);

        throw fail(409,
            `${parent.name} is still the guardian of ${plural(children.length, "student")}: `
            + `${names.join(", ")}. Unlink them first.`,
            { blockedBy: names });
    }

    await sequelize.transaction(async (transaction) => {
        await execute(
            "UPDATE parents SET is_deleted = 1 WHERE parent_id = :parentId",
            { parentId },
            transaction
        );

        await execute(
            `UPDATE users SET is_deleted = 1, is_active = 0, updated_at = NOW()
              WHERE user_id = :userId`,
            { userId: parent.user_id },
            transaction
        );
    });

    return { id: parentId, parentId, deleted: true };
};

// ----------------------------------------------------------- guardian links

const readChildLinks = (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw fail(400, "children must be a list.");

    return value.map((entry) => {
        const studentId = asId(entry?.student_id ?? entry);
        if (!studentId) throw fail(400, "Each child needs a numeric student_id.");

        const relationship = entry?.relationship || "Guardian";
        if (!RELATIONSHIPS.includes(relationship)) {
            throw fail(400, `relationship must be one of: ${RELATIONSHIPS.join(", ")}.`);
        }

        return { student_id: studentId, relationship };
    });
};

const mustBeALinkableStudent = async (studentId, transaction) => {
    const [student] = await select(
        `SELECT student_id, registration_number,
                CONCAT(first_name, ' ', last_name) AS name
           FROM students
          WHERE student_id = :studentId AND is_deleted = 0`,
        { studentId },
        transaction
    );

    if (!student) throw fail(400, `Student ${studentId} does not exist.`);

    return student;
};

/**
 * Links a child to a parent.
 *
 * A student may have more than one guardian and a guardian more than one
 * student — the table's primary key is the pair — so this adds a row rather than
 * replacing anything. Re-linking the same pair is refused instead of silently
 * doing nothing, because the admin who sent it believes they changed something.
 */
const linkChild = async (parentId, body) => {
    const [parent] = await select(
        "SELECT parent_id FROM parents WHERE parent_id = :parentId AND is_deleted = 0",
        { parentId }
    );

    if (!parent) throw fail(404, "That parent does not exist.");

    const [link] = readChildLinks([{
        student_id: body.student_id,
        relationship: body.relationship
    }]);

    const student = await mustBeALinkableStudent(link.student_id);

    const [existing] = await select(
        `SELECT relationship FROM student_guardians
          WHERE parent_id = :parentId AND student_id = :studentId`,
        { parentId, studentId: link.student_id }
    );

    if (existing) {
        throw fail(409,
            `${student.name} is already linked to this parent as ${existing.relationship}.`);
    }

    await insert(
        `INSERT INTO student_guardians (student_id, parent_id, relationship)
         VALUES (:studentId, :parentId, :relationship)`,
        { studentId: link.student_id, parentId, relationship: link.relationship },
        undefined
    );

    return getParent(parentId);
};

/**
 * Removes one guardian link.
 *
 * A real DELETE, not a flag: `student_guardians` has no is_deleted column, and a
 * link that is wrong is not history worth keeping — the audit entry records that
 * it was removed and by whom, which is the part that matters.
 */
const unlinkChild = async (parentId, studentId) => {
    const [link] = await select(
        `SELECT sg.relationship,
                CONCAT(s.first_name, ' ', s.last_name) AS name
           FROM student_guardians sg
           JOIN students s ON s.student_id = sg.student_id
          WHERE sg.parent_id = :parentId AND sg.student_id = :studentId`,
        { parentId, studentId }
    );

    if (!link) throw fail(404, "That child is not linked to this parent.");

    await execute(
        `DELETE FROM student_guardians
          WHERE parent_id = :parentId AND student_id = :studentId`,
        { parentId, studentId }
    );

    return getParent(parentId);
};

module.exports = {
    STAFF_ROLE_IDS,
    listAdmins, getAdmin, createAdmin, updateAdmin, deleteAdmin,
    getParent, createParent, updateParent, deleteParent,
    linkChild, unlinkChild
};
