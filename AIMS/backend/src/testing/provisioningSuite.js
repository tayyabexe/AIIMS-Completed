/*
 * Verification suite for account provisioning.
 *
 * Admits real students and onboards a real teacher through the HTTP API, then
 * checks with direct SQL that every row was written and that the generated
 * credentials actually work for signing in.
 *
 * CLEANS UP AFTER ITSELF: every row it creates is deleted at the end, in
 * reverse dependency order. It never touches a row it did not create.
 *
 *   node src/testing/provisioningSuite.js
 */

require("dotenv").config();
const { sequelize } = require("../database/connection");

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const EMAIL = process.env.TEST_ADMIN_EMAIL || "admin2@aims.edu.pk";
const PASSWORD = process.env.TEST_ADMIN_PASSWORD || "Admin@1234";

const q = (sql, replacements) =>
    sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, replacements });

const exec = (sql, replacements) =>
    sequelize.query(sql, { replacements });

let token = null;
const results = [];
const created = { students: [], parents: [], teachers: [], employees: [], users: [] };

const check = (name, passed, detail) => {
    results.push({ name, passed, detail });
    console.log(`${passed ? "  PASS" : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const eq = (name, actual, expected) =>
    check(name, String(actual) === String(expected), `api=${actual} db=${expected}`);

const api = async (path, { method = "GET", body, bearer = token } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: res.status, body: await res.json() };
};

const login = async (email, password) => {
    const res = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
        bearer: null
    });
    return res;
};

// A CNIC that cannot collide with the seeded data.
const stamp = Date.now().toString().slice(-7);
const cnic = (n) => `99999-${stamp}-${n}`;

// -------------------------------------------------------------- the tests

let firstAdmission = null;
let parentEmail = null;

const testAdmitStudent = async () => {
    console.log("\n[admit] POST /api/admin/students/admit  — new student + new parent");

    parentEmail = `suite.parent.${stamp}@example.com`;

    const { status, body } = await api("/api/admin/students/admit", {
        method: "POST",
        body: {
            first_name: "Suite",
            last_name: `TestOne${stamp}`,
            cnic_bform: cnic(1),
            program_id: 1,
            batch_id: 1,
            gender: "Male",
            phone: "0300-0000001",
            parent: {
                first_name: "Suite",
                last_name: `Parent${stamp}`,
                email: parentEmail,
                phone: "0300-0000002",
                relationship: "Father"
            }
        }
    });

    eq("admission returns 201", status, 201);
    if (status !== 201) {
        console.log("     body:", JSON.stringify(body));
        return;
    }

    firstAdmission = body;
    created.students.push(body.student.studentId);
    created.users.push(body.student.userId);
    if (body.parent?.created) {
        created.parents.push(body.parent.parentId);
        created.users.push(body.parent.userId);
    }

    // ---- the student row and its login ----
    const [student] = await q(
        `SELECT s.student_id, s.registration_number, s.user_id, s.academic_status,
                u.email, u.role_id, u.must_change_password, u.credentials_issued_at
           FROM students s JOIN users u ON u.user_id = s.user_id
          WHERE s.student_id = :id`,
        { id: body.student.studentId }
    );

    check("student row exists in the database", !!student);
    eq("student email matches the response", student.email, body.student.email);
    eq("student got the Student role", student.role_id, 4);
    eq("student is Active", student.academic_status, "Active");
    eq("registration number matches the response",
        student.registration_number, body.student.registrationNumber);
    check("registration number follows the institute format",
        /^\d{4}-AIMS-REG-\d{4}$/.test(student.registration_number),
        student.registration_number);
    eq("student must change the issued password", student.must_change_password, 1);
    check("credentials_issued_at was stamped", !!student.credentials_issued_at);

    // ---- the parent row and its login ----
    check("parent was created", body.parent?.created === true);
    const [parent] = await q(
        `SELECT p.parent_id, p.user_id, u.email, u.role_id, u.must_change_password
           FROM parents p JOIN users u ON u.user_id = p.user_id
          WHERE p.parent_id = :id`,
        { id: body.parent.parentId }
    );
    check("parent row exists in the database", !!parent);
    eq("parent email is the one the admin entered", parent.email, parentEmail);
    eq("parent got the Parent role", parent.role_id, 5);
    eq("parent must change the issued password", parent.must_change_password, 1);

    // ---- the link between them ----
    const [link] = await q(
        `SELECT relationship FROM student_guardians
          WHERE student_id = :s AND parent_id = :p`,
        { s: body.student.studentId, p: body.parent.parentId }
    );
    check("student_guardians link was written", !!link);
    eq("relationship was stored", link?.relationship, "Father");

    // ---- the passwords actually work ----
    const studentLogin = await login(body.student.email, body.student.password);
    eq("student can sign in with the generated password", studentLogin.status, 200);
    eq("student login reports must_change_password",
        studentLogin.body.user?.must_change_password, true);

    const parentLoginRes = await login(parentEmail, body.parent.password);
    eq("parent can sign in with the generated password", parentLoginRes.status, 200);

    // ---- the password is never readable afterwards ----
    const [stored] = await q(
        "SELECT password_hash FROM users WHERE user_id = :id",
        { id: body.student.userId }
    );
    check("password is stored as a bcrypt hash, not plaintext",
        stored.password_hash.startsWith("$2") && stored.password_hash !== body.student.password,
        stored.password_hash.slice(0, 7));
};

const testSecondChildLinksSameParent = async () => {
    console.log("\n[admit] second child of the SAME parent — must link, not duplicate");

    const before = await q(
        "SELECT COUNT(*) AS n FROM parents p JOIN users u ON u.user_id = p.user_id WHERE u.email = :e",
        { e: parentEmail }
    );

    const { status, body } = await api("/api/admin/students/admit", {
        method: "POST",
        body: {
            first_name: "Suite",
            last_name: `TestTwo${stamp}`,
            cnic_bform: cnic(2),
            program_id: 1,
            batch_id: 1,
            parent: {
                first_name: "Suite",
                last_name: `Parent${stamp}`,
                email: parentEmail,
                relationship: "Father"
            }
        }
    });

    eq("second admission returns 201", status, 201);
    if (status !== 201) return;

    created.students.push(body.student.studentId);
    created.users.push(body.student.userId);

    const after = await q(
        "SELECT COUNT(*) AS n FROM parents p JOIN users u ON u.user_id = p.user_id WHERE u.email = :e",
        { e: parentEmail }
    );

    eq("no duplicate parent was created", after[0].n, before[0].n);
    check("response says the parent was linked, not created",
        body.parent?.created === false, `created=${body.parent?.created}`);
    check("no new parent password was issued",
        body.parent?.password === null, `password=${body.parent?.password}`);

    // The critical one: the parent's EXISTING password must still work.
    const stillWorks = await login(parentEmail, firstAdmission.parent.password);
    eq("the parent's original password still works", stillWorks.status, 200);

    // And they must now see BOTH children.
    const children = await q(
        `SELECT sg.student_id FROM student_guardians sg
          WHERE sg.parent_id = :p`,
        { p: firstAdmission.parent.parentId }
    );
    eq("parent is now linked to two children", children.length, 2);

    // Registration numbers must not repeat.
    check("second student got a different registration number",
        body.student.registrationNumber !== firstAdmission.student.registrationNumber,
        `${firstAdmission.student.registrationNumber} vs ${body.student.registrationNumber}`);
};

const testOnboardTeacher = async () => {
    console.log("\n[onboard] POST /api/admin/teachers/onboard");

    const { status, body } = await api("/api/admin/teachers/onboard", {
        method: "POST",
        body: {
            first_name: "Suite",
            last_name: `Teacher${stamp}`,
            department_id: 1,
            designation: "Assistant Professor",
            specialization: "Verification",
            basic_salary: 150000,
            assignments: [{ subject_id: 1, batch_id: 1, section_id: 1 }]
        }
    });

    eq("onboarding returns 201", status, 201);
    if (status !== 201) {
        console.log("     body:", JSON.stringify(body));
        return;
    }

    created.teachers.push(body.teacher.teacherId);
    created.employees.push(body.teacher.employeeId);
    created.users.push(body.teacher.userId);

    const [row] = await q(
        `SELECT t.teacher_id, t.specialization, e.employee_code, e.designation,
                e.department_id, u.email, u.role_id, u.must_change_password
           FROM teachers t
           JOIN employees e ON e.employee_id = t.employee_id
           JOIN users u ON u.user_id = e.user_id
          WHERE t.teacher_id = :id`,
        { id: body.teacher.teacherId }
    );

    check("all three rows (users, employees, teachers) were written", !!row);
    eq("teacher got the Teacher role", row.role_id, 3);
    eq("designation was stored", row.designation, "Assistant Professor");
    eq("specialization was stored", row.specialization, "Verification");
    check("employee code follows the EMP-#### format",
        /^EMP-\d{4}$/.test(row.employee_code), row.employee_code);
    eq("teacher must change the issued password", row.must_change_password, 1);

    const assignments = await q(
        "SELECT * FROM teacher_assignments WHERE teacher_id = :id",
        { id: body.teacher.teacherId }
    );
    eq("class assignment was written", assignments.length, 1);

    const subjects = await q(
        "SELECT * FROM teacher_subjects WHERE teacher_id = :id",
        { id: body.teacher.teacherId }
    );
    eq("teacher_subjects was written too", subjects.length, 1);

    const teacherLogin = await login(row.email, body.teacher.password);
    eq("teacher can sign in with the generated password", teacherLogin.status, 200);
};

const testReissue = async () => {
    console.log("\n[reissue] POST /api/admin/credentials/:userId/reissue");

    const userId = firstAdmission.student.userId;
    const oldPassword = firstAdmission.student.password;

    const { status, body } = await api(`/api/admin/credentials/${userId}/reissue`, {
        method: "POST"
    });

    eq("reissue returns 200", status, 200);
    check("a new password came back", !!body.credentials?.password);
    check("the new password is different from the old one",
        body.credentials.password !== oldPassword);

    const withNew = await login(body.credentials.email, body.credentials.password);
    eq("the new password works", withNew.status, 200);

    const withOld = await login(body.credentials.email, oldPassword);
    eq("the OLD password no longer works", withOld.status, 401);

    const missing = await api("/api/admin/credentials/99999999/reissue", { method: "POST" });
    eq("reissuing for an unknown account returns 404", missing.status, 404);
};

const testChangePasswordClearsFlag = async () => {
    console.log("\n[first sign-in] changing the password clears must_change_password");

    // Issue a fresh password we know, then use it to change to our own.
    const { body } = await api(`/api/admin/credentials/${firstAdmission.student.userId}/reissue`, {
        method: "POST"
    });

    const signedIn = await login(body.credentials.email, body.credentials.password);
    eq("signs in with the issued password", signedIn.status, 200);
    eq("flag is set before the change", signedIn.body.user.must_change_password, true);

    const chosen = "ChosenByMe@2026";
    const changed = await fetch(`${BASE}/api/auth/change-password`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${signedIn.body.token}`
        },
        body: JSON.stringify({
            currentPassword: body.credentials.password,
            newPassword: chosen
        })
    });
    eq("change-password succeeds", changed.status, 200);

    const after = await login(body.credentials.email, chosen);
    eq("signs in with the chosen password", after.status, 200);
    eq("flag is cleared after the change", after.body.user.must_change_password, false);
};

const testValidation = async () => {
    console.log("\n[validation]");

    const noName = await api("/api/admin/students/admit", {
        method: "POST",
        body: { last_name: "X", cnic_bform: cnic(9), program_id: 1, batch_id: 1 }
    });
    eq("admission without a first name is rejected", noName.status, 400);

    const halfParent = await api("/api/admin/students/admit", {
        method: "POST",
        body: {
            first_name: "A", last_name: "B", cnic_bform: cnic(8),
            program_id: 1, batch_id: 1,
            parent: { email: "only.an.email@example.com" }
        }
    });
    eq("a half-filled parent is rejected", halfParent.status, 400);

    // A parent email belonging to an admin must not be attachable to a child.
    const clash = await api("/api/admin/students/admit", {
        method: "POST",
        body: {
            first_name: "A", last_name: "B", cnic_bform: cnic(7),
            program_id: 1, batch_id: 1,
            parent: { first_name: "X", last_name: "Y", email: "admin2@aims.edu.pk" }
        }
    });
    eq("reusing a non-parent email is refused", clash.status, 409);

    const studentSession = await login("student1@aims.edu.pk", "Student@1234");
    if (studentSession.body?.token) {
        const forbidden = await api("/api/admin/students/admit", {
            method: "POST",
            body: { first_name: "A", last_name: "B", cnic_bform: cnic(6), program_id: 1, batch_id: 1 },
            bearer: studentSession.body.token
        });
        eq("a student cannot admit a student", forbidden.status, 403);
    }
};

// ------------------------------------------------------------------ cleanup

const cleanup = async () => {
    console.log("\n[cleanup] removing every row this suite created");

    for (const id of created.students) {
        await exec("DELETE FROM student_guardians WHERE student_id = :id", { id });
        await exec("DELETE FROM students WHERE student_id = :id", { id });
    }
    for (const id of created.teachers) {
        await exec("DELETE FROM teacher_assignments WHERE teacher_id = :id", { id });
        await exec("DELETE FROM teacher_subjects WHERE teacher_id = :id", { id });
        await exec("DELETE FROM teachers WHERE teacher_id = :id", { id });
    }
    for (const id of created.employees) {
        await exec("DELETE FROM employees WHERE employee_id = :id", { id });
    }
    for (const id of created.parents) {
        await exec("DELETE FROM parents WHERE parent_id = :id", { id });
    }
    for (const id of created.users) {
        await exec("DELETE FROM users WHERE user_id = :id", { id });
    }

    // Prove it: nothing this suite made is still there.
    const leftoverStudents = created.students.length
        ? await q("SELECT student_id FROM students WHERE student_id IN (:ids)", { ids: created.students })
        : [];
    const leftoverUsers = created.users.length
        ? await q("SELECT user_id FROM users WHERE user_id IN (:ids)", { ids: created.users })
        : [];

    check("all test students removed", leftoverStudents.length === 0);
    check("all test users removed", leftoverUsers.length === 0);
};

// ---------------------------------------------------------------------- run

(async () => {
    console.log(`AIMS provisioning suite -> ${BASE}`);

    const admin = await login(EMAIL, PASSWORD);
    if (!admin.body.token) throw new Error(`Admin login failed: ${JSON.stringify(admin.body)}`);
    token = admin.body.token;

    try {
        await testAdmitStudent();
        await testSecondChildLinksSameParent();
        await testOnboardTeacher();
        await testReissue();
        await testChangePasswordClearsFlag();
        await testValidation();
    } finally {
        await cleanup();
    }

    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${passed}/${results.length} checks passed`);

    const failed = results.filter((r) => !r.passed);
    if (failed.length) {
        console.log("\nFailures:");
        for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    }

    await sequelize.close();
    process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(1);
});
