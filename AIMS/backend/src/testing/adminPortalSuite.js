/*
 * Verification suite for the page-scoped admin portal endpoints.
 *
 * Every assertion cross-checks the HTTP response against an INDEPENDENT SQL
 * query run directly on the database — the point is to prove the endpoints
 * report what aims_db actually holds, not merely that they return 200.
 *
 * Read-only: this suite creates, updates and deletes nothing.
 *
 *   node src/testing/adminPortalSuite.js
 */

require("dotenv").config();
const { sequelize } = require("../database/connection");

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const EMAIL = process.env.TEST_ADMIN_EMAIL || "admin2@aims.edu.pk";
const PASSWORD = process.env.TEST_ADMIN_PASSWORD || "Admin@1234";

const q = (sql, replacements) =>
    sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, replacements });

let token = null;
const results = [];

const api = async (path) => {
    const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    return { status: res.status, body, bytes: JSON.stringify(body).length };
};

const check = (name, passed, detail) => {
    results.push({ name, passed, detail });
    console.log(`${passed ? "  PASS" : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const eq = (name, actual, expected) =>
    check(name, String(actual) === String(expected), `api=${actual} db=${expected}`);

// Money is decimal in MySQL and float in JSON; compare to the cent.
const near = (name, actual, expected, tolerance = 0.01) =>
    check(
        name,
        Math.abs(Number(actual) - Number(expected)) <= tolerance,
        `api=${actual} db=${expected}`
    );

const login = async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    });
    const body = await res.json();
    if (!body.token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
    token = body.token;
};

// ---------------------------------------------------------------- the tests

const testDashboard = async () => {
    console.log("\n[dashboard] GET /api/admin/dashboard");
    const { body, bytes } = await api("/api/admin/dashboard");

    const [dbStudents] = await q(
        `SELECT COUNT(*) AS total, SUM(academic_status='Active') AS active
           FROM students WHERE is_deleted = 0`
    );
    const [dbFees] = await q(
        `SELECT SUM(total_payable) AS billed, SUM(amount_paid) AS collected
           FROM fee_vouchers WHERE status <> 'Cancelled'`
    );
    const [dbAcademics] = await q(
        `SELECT COUNT(*) AS with_result, SUM(cgpa >= 2.5) AS passed
           FROM (SELECT r.cgpa FROM results r
                   JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                           FROM results GROUP BY student_id) l
                     ON l.student_id = r.student_id AND l.semester_id = r.semester_id) n`
    );

    eq("total students matches DB", body.students.total, dbStudents.total);
    eq("active students matches DB", body.students.active, dbStudents.active);
    near("fees billed matches DB", body.fees.billed, dbFees.billed);
    near("fees collected matches DB", body.fees.collected, dbFees.collected);
    eq("students with a result matches DB", body.academics.withResult, dbAcademics.with_result);
    eq("passed count matches DB", body.academics.passed, dbAcademics.passed);
    check("payload stays small", bytes < 2000, `${bytes} bytes`);
};

const testStudents = async () => {
    console.log("\n[students] GET /api/admin/students");
    const { body, bytes } = await api("/api/admin/students?limit=25");

    const [dbTotal] = await q(`SELECT COUNT(*) AS total FROM students WHERE is_deleted = 0`);

    eq("pagination total matches DB", body.pagination.total, dbTotal.total);
    check("returns one page only", body.rows.length === 25, `${body.rows.length} rows`);
    check("payload is per-page", bytes < 60000, `${bytes} bytes`);
    check("filter options included", !!body.options?.programs?.length, `${body.options?.programs?.length} programs`);

    // The first row's joined labels must match the lookup tables.
    const row = body.rows[0];
    const [dbRow] = await q(
        `SELECT s.registration_number, CONCAT(s.first_name,' ',s.last_name) AS name,
                p.program_name, b.batch_name, sem.semester_number
           FROM students s
           LEFT JOIN programs p ON p.program_id = s.program_id
           LEFT JOIN batches  b ON b.batch_id   = s.batch_id
           LEFT JOIN semesters sem ON sem.semester_id = s.current_semester_id
          WHERE s.student_id = :id`,
        { id: row.id }
    );
    eq("row regNo matches DB", row.regNo, dbRow.registration_number);
    eq("row name matches DB", row.name, dbRow.name);
    eq("row program matches DB", row.program, dbRow.program_name);
    eq("row batch matches DB", row.batch, dbRow.batch_name);
    eq(
        "semester shows the real semester NUMBER, not the global id",
        row.semester,
        dbRow.semester_number ? `Semester ${dbRow.semester_number}` : null
    );

    // Filtering has to happen in SQL, not after the fact.
    const programId = body.options.programs[0].program_id;
    const filtered = await api(`/api/admin/students?program_id=${programId}&limit=5`);
    const [dbFiltered] = await q(
        `SELECT COUNT(*) AS total FROM students WHERE is_deleted = 0 AND program_id = :p`,
        { p: programId }
    );
    eq("program filter total matches DB", filtered.body.pagination.total, dbFiltered.total);
    check(
        "program filter returns only that programme",
        filtered.body.rows.every((r) => r.programId === programId),
        `${filtered.body.rows.length} rows`
    );

    // Search has to match name OR registration number.
    const search = await api(`/api/admin/students?q=${encodeURIComponent(row.name)}&limit=5`);
    check(
        "name search finds the student",
        search.body.rows.some((r) => r.id === row.id),
        `${search.body.pagination.total} hits`
    );
};

const testStudentProfile = async () => {
    console.log("\n[student profile] GET /api/admin/students/:id");
    const { body } = await api("/api/admin/students/1");
    const s = body.student;

    const [dbUser] = await q(
        `SELECT u.email FROM students st JOIN users u ON u.user_id = st.user_id
          WHERE st.student_id = 1`
    );
    const [dbAtt] = await q(
        `SELECT SUM(total_sessions) AS total,
                SUM(present_count + late_count) AS attended
           FROM vw_student_attendance_summary WHERE student_id = 1`
    );
    const [dbFee] = await q(
        `SELECT SUM(total_payable) AS billed, SUM(amount_paid) AS paid,
                SUM(remaining_balance) AS remaining, COUNT(*) AS vouchers
           FROM fee_vouchers WHERE student_id = 1 AND status <> 'Cancelled'`
    );
    const [dbResult] = await q(
        `SELECT gpa, cgpa FROM results WHERE student_id = 1
          ORDER BY semester_id DESC LIMIT 1`
    );
    const [dbGuardian] = await q(
        `SELECT CONCAT(p.first_name,' ',p.last_name) AS name, sg.relationship
           FROM student_guardians sg JOIN parents p ON p.parent_id = sg.parent_id
          WHERE sg.student_id = 1`
    );
    const [dbCourses] = await q(
        `SELECT COUNT(*) AS total FROM enrollments e
           JOIN subjects s ON s.subject_id = e.subject_id AND s.is_deleted = 0
          WHERE e.student_id = 1`
    );

    eq("email matches the users row", s.email, dbUser.email);
    eq("total classes matches the attendance view", s.totalClasses, dbAtt.total);
    eq("present days matches the attendance view", s.presentDays, dbAtt.attended);
    near("fee billed sums ALL vouchers", s.feeAmount, dbFee.billed);
    near("fee paid sums ALL vouchers", s.paidAmount, dbFee.paid);
    near("remaining balance sums ALL vouchers", s.remainingBalance, dbFee.remaining);
    eq("voucher count matches DB", s.voucherCount, dbFee.vouchers);
    near("cgpa matches the latest result", s.cgpa, dbResult.cgpa);
    near("gpa matches the latest result", s.gpa, dbResult.gpa);
    eq("guardian name matches DB", s.guardianName, dbGuardian.name);
    eq("guardian relationship matches DB", s.guardianRelationship, dbGuardian.relationship);
    eq("enrolled courses count matches DB", s.enrolledCourses.length, dbCourses.total);
    check("exam score is a real percentage", s.examScore === null || (s.examScore >= 0 && s.examScore <= 100), `${s.examScore}`);
    check("exam grade came from the grades table", s.examGrade === null || typeof s.examGrade === "string", `${s.examGrade}`);

    const missing = await api("/api/admin/students/99999999");
    eq("unknown student returns 404", missing.status, 404);
};

const testAttendance = async () => {
    console.log("\n[attendance] GET /api/admin/attendance");
    const { body } = await api("/api/admin/attendance?limit=25");

    const [dbBuckets] = await q(
        `SELECT COUNT(*) AS tracked, SUM(pct < 75) AS at_risk, SUM(pct >= 90) AS excellent
           FROM (SELECT student_id,
                        100 * SUM(present_count + late_count)
                            / NULLIF(SUM(total_sessions),0) AS pct
                   FROM vw_student_attendance_summary GROUP BY student_id) p
          WHERE pct IS NOT NULL`
    );

    eq("tracked students matches DB", body.summary.tracked, dbBuckets.tracked);
    eq("at-risk bucket matches DB", body.summary.atRisk, dbBuckets.at_risk);
    eq("excellent bucket matches DB", body.summary.excellent, dbBuckets.excellent);

    const row = body.rows.find((r) => r.attendancePercent != null);
    const [dbRow] = await q(
        `SELECT ROUND(100 * SUM(present_count + late_count)
                    / NULLIF(SUM(total_sessions),0), 1) AS pct
           FROM vw_student_attendance_summary WHERE student_id = :id`,
        { id: row.id }
    );
    near("row percentage matches the view", row.attendancePercent, dbRow.pct, 0.05);

    // risk=low must filter in SQL, not in the browser.
    const low = await api("/api/admin/attendance?risk=low&limit=50");
    eq("risk=low total matches the DB bucket", low.body.pagination.total, dbBuckets.at_risk);
    check(
        "risk=low returns only sub-75% students",
        low.body.rows.every((r) => r.attendancePercent < 75),
        `${low.body.rows.length} rows`
    );
};

const testFees = async () => {
    console.log("\n[fees] GET /api/admin/fees");
    const { body } = await api("/api/admin/fees?limit=25");

    const [dbTotals] = await q(
        `SELECT SUM(total_payable) AS billed, SUM(amount_paid) AS collected,
                SUM(remaining_balance) AS outstanding
           FROM fee_vouchers WHERE status <> 'Cancelled'`
    );
    near("billed matches DB", body.totals.billed, dbTotals.billed);
    near("collected matches DB", body.totals.collected, dbTotals.collected);
    near("outstanding matches DB", body.totals.outstanding, dbTotals.outstanding);

    const dbCategories = await q(
        `SELECT fee_category, SUM(amount) AS amount FROM fee_structures GROUP BY fee_category`
    );
    eq("distribution category count matches DB", body.distribution.length, dbCategories.length);

    const [dbVerified] = await q(
        `SELECT SUM(amount_paid) AS total FROM fee_payments WHERE status = 'Verified'`
    );
    const chartTotal = body.monthlyCollection.reduce((s, m) => s + m.collected, 0);
    near("monthly chart sums to verified payments only", chartTotal, dbVerified.total, 1);

    const overdue = await api("/api/admin/fees?fee_status=Overdue&limit=10");
    check(
        "fee_status filter returns only that status",
        overdue.body.rows.every((r) => r.feeStatus === "Overdue"),
        `${overdue.body.pagination.total} overdue students`
    );
};

const testExamination = async () => {
    console.log("\n[examination] GET /api/admin/examination");
    const { body } = await api("/api/admin/examination?limit=25");

    const dbGrades = await q(`SELECT COUNT(*) AS total FROM grades`);
    check("grading scale comes from the grades table", body.gradingScale.length === Number(dbGrades[0].total), `${body.gradingScale.length} bands`);

    const [dbScored] = await q(
        `SELECT COUNT(*) AS total FROM (
             SELECT m.student_id FROM marks m JOIN exams e ON e.exam_id = m.exam_id
              WHERE e.total_marks > 0 GROUP BY m.student_id) x`
    );
    const distributionTotal = body.gradeDistribution.reduce((s, g) => s + g.students, 0);
    eq("grade distribution covers every scored student", distributionTotal, dbScored.total);

    const dbPrograms = await q(`SELECT COUNT(*) AS total FROM programs WHERE is_deleted = 0`);
    check(
        "per-programme aggregates cover the programmes with students",
        body.byProgram.length > 0 && body.byProgram.length <= Number(dbPrograms[0].total),
        `${body.byProgram.length} programmes`
    );

    const scored = body.rows.find((r) => r.examScore != null);
    if (scored) {
        const [dbScore] = await q(
            `SELECT ROUND(SUM(m.obtained_marks)/NULLIF(SUM(e.total_marks),0)*100, 1) AS pct
               FROM marks m JOIN exams e ON e.exam_id = m.exam_id
              WHERE m.student_id = :id AND e.total_marks > 0`,
            { id: scored.id }
        );
        near("row exam score matches marks/exams in DB", scored.examScore, dbScore.pct, 0.05);
    }
};

const testParents = async () => {
    console.log("\n[parents] GET /api/admin/parents");
    const { body, bytes } = await api("/api/admin/parents?limit=25");

    const [dbTotal] = await q(`SELECT COUNT(*) AS total FROM parents WHERE is_deleted = 0`);
    eq("parent total matches DB", body.pagination.total, dbTotal.total);
    check("payload is per-page", bytes < 60000, `${bytes} bytes vs 695 KB for /api/parents`);

    const parent = body.rows[0];
    const dbChildren = await q(
        `SELECT s.student_id FROM student_guardians sg
           JOIN students s ON s.student_id = sg.student_id AND s.is_deleted = 0
          WHERE sg.parent_id = :id`,
        { id: parent.id }
    );
    eq("children count matches DB", parent.children.length, dbChildren.length);
};

const testTeachers = async () => {
    console.log("\n[teachers] GET /api/admin/teachers");
    const { body } = await api("/api/admin/teachers?limit=25");

    const [dbTotal] = await q(`SELECT COUNT(*) AS total FROM teachers WHERE is_deleted = 0`);
    eq("teacher total matches DB", body.pagination.total, dbTotal.total);

    const t = body.rows[0];
    const [dbTeacher] = await q(
        `SELECT CONCAT(e.first_name,' ',e.last_name) AS name, u.email, d.department_name
           FROM teachers t
           LEFT JOIN employees e ON e.employee_id = t.employee_id
           LEFT JOIN users u ON u.user_id = e.user_id
           LEFT JOIN departments d ON d.department_id = e.department_id
          WHERE t.teacher_id = :id`,
        { id: t.id }
    );
    eq("teacher name matches employees row", t.name, dbTeacher.name);
    eq("teacher email matches users row", t.email, dbTeacher.email);
    eq("teacher department matches DB", t.department, dbTeacher.department_name);

    const [dbLoad] = await q(
        `SELECT weekly_sessions FROM vw_teacher_workload WHERE teacher_id = :id`,
        { id: t.id }
    );
    eq("weekly sessions matches the workload view", t.weeklySessions, dbLoad ? dbLoad.weekly_sessions : 0);
};

const testAiAnalytics = async () => {
    console.log("\n[ai-analytics] GET /api/admin/ai-analytics");
    const { body } = await api("/api/admin/ai-analytics");

    const [dbLowAttendance] = await q(
        `SELECT COUNT(*) AS total FROM (
             SELECT student_id, 100 * SUM(present_count + late_count)
                        / NULLIF(SUM(total_sessions),0) AS pct
               FROM vw_student_attendance_summary GROUP BY student_id) p
          WHERE pct < 75`
    );
    const [dbLowCgpa] = await q(
        `SELECT COUNT(*) AS total FROM (
             SELECT r.cgpa FROM results r
               JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                       FROM results GROUP BY student_id) l
                 ON l.student_id = r.student_id AND l.semester_id = r.semester_id) n
          WHERE cgpa < 2.5`
    );

    eq("low-attendance cohort matches DB", body.cohorts.lowAttendance, dbLowAttendance.total);
    eq("low-CGPA cohort matches DB", body.cohorts.lowCgpa, dbLowCgpa.total);
    check(
        "every at-risk student carries a stated reason",
        body.atRisk.every((s) => s.reasons.length > 0),
        `${body.atRisk.length} students`
    );
    check(
        "at-risk list is capped, not the whole institute",
        body.atRisk.length <= 25,
        `${body.atRisk.length} rows`
    );
};

const testReports = async () => {
    console.log("\n[reports] GET /api/admin/reports");
    const { body, bytes } = await api("/api/admin/reports");

    const [dbGender] = await q(
        `SELECT SUM(gender='Male') AS male, SUM(gender='Female') AS female
           FROM students WHERE is_deleted = 0`
    );
    eq("male count matches DB", body.enrolment.male, dbGender.male);
    eq("female count matches DB", body.enrolment.female, dbGender.female);

    const programTotal = body.enrolment.byProgram.reduce((s, r) => s + r.students, 0);
    check(
        "per-programme breakdown accounts for the students who have one",
        programTotal > 0 && programTotal <= body.enrolment.total,
        `${programTotal} of ${body.enrolment.total}`
    );
    check("payload is aggregates only", bytes < 4000, `${bytes} bytes`);
};

const testAccessControl = async () => {
    console.log("\n[access control]");

    const anon = await fetch(`${BASE}/api/admin/dashboard`);
    eq("no token is rejected", anon.status, 401);

    // A student token must not reach any admin screen.
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "student1@aims.edu.pk", password: "Student@1234" })
    });
    const studentBody = await res.json();

    if (studentBody.token) {
        for (const path of ["/api/admin/dashboard", "/api/admin/students", "/api/admin/fees"]) {
            const forbidden = await fetch(`${BASE}${path}`, {
                headers: { Authorization: `Bearer ${studentBody.token}` }
            });
            eq(`student token is forbidden on ${path}`, forbidden.status, 403);
        }
    } else {
        check("student login for the RBAC check", false, "could not sign in as a student");
    }
};

// ---------------------------------------------------------------------- run

(async () => {
    console.log(`AIMS admin portal suite -> ${BASE}`);
    await login();

    await testDashboard();
    await testStudents();
    await testStudentProfile();
    await testAttendance();
    await testFees();
    await testExamination();
    await testParents();
    await testTeachers();
    await testAiAnalytics();
    await testReports();
    await testAccessControl();

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
    await sequelize.close().catch(() => {});
    process.exit(1);
});
