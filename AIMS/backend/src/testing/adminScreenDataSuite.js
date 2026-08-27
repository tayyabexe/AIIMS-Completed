/*
 * Data-authenticity suite for four admin screens:
 *   /fee-management   GET /api/admin/fees
 *   /examination      GET /api/admin/examination
 *   /parents          GET /api/admin/parents
 *   /faculty          GET /api/admin/teachers
 *
 * Three questions, asked separately, because they fail in different ways:
 *
 *   1. ROUTING      does the path the frontend calls reach the handler that
 *                   serves that screen, and come back with the envelope the
 *                   screen destructures?
 *   2. AUTHENTICITY is every figure the screen renders the value aims_db
 *                   actually holds? Each assertion re-derives the number with
 *                   an INDEPENDENT SQL statement written against the base
 *                   tables — not by calling the same service twice, which
 *                   would agree with itself however wrong it was.
 *   3. LIVENESS     is the field real data rather than a placeholder? A
 *                   hardcoded '—', a null rendered as text, an array that is
 *                   always empty and a colour constant all return 200 and all
 *                   look like data on screen. These check the shape the UI
 *                   binds to, and that filters actually move the numbers.
 *
 * Read-only: creates, updates and deletes nothing.
 *
 *   node src/testing/adminScreenDataSuite.js
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
    return { status: res.status, body };
};

const check = (name, passed, detail) => {
    results.push({ name, passed, detail });
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const eq = (name, actual, expected) =>
    check(name, String(actual) === String(expected), `api=${actual} db=${expected}`);

// Money is DECIMAL in MySQL and float in JSON; compare to the cent.
const near = (name, actual, expected, tolerance = 0.01) =>
    check(name, Math.abs(Number(actual) - Number(expected)) <= tolerance,
        `api=${actual} db=${expected}`);

const section = (title) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

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

/* ======================================================================
   /fee-management
   ====================================================================== */
const feeManagement = async () => {
    section("/fee-management  ->  GET /api/admin/fees");

    const { status, body } = await api("/api/admin/fees?limit=5");
    check("routing: 200 from /api/admin/fees", status === 200, `status=${status}`);

    // The screen destructures all five of these; a missing one renders as the
    // component's empty default rather than as an error.
    for (const key of ["rows", "pagination", "totals", "distribution", "monthlyCollection", "options"]) {
        check(`routing: envelope carries \`${key}\``, body[key] !== undefined);
    }

    // ---- authenticity: totals re-derived from fee_vouchers ----
    const [t] = await q(`
        SELECT SUM(v.total_payable) billed, SUM(v.amount_paid) collected,
               SUM(v.remaining_balance) outstanding, COUNT(*) students_billed,
               SUM(v.status='Paid') paid, SUM(v.status='Partial') partial,
               SUM(v.status='Unpaid') unpaid, SUM(v.status='Overdue') overdue
          FROM (SELECT fv.student_id,
                       SUM(fv.total_payable) total_payable,
                       SUM(fv.amount_paid) amount_paid,
                       SUM(fv.remaining_balance) remaining_balance,
                       CASE MAX(CASE fv.status WHEN 'Overdue' THEN 5 WHEN 'Unpaid' THEN 4
                                               WHEN 'Partial' THEN 3 ELSE 2 END)
                            WHEN 5 THEN 'Overdue' WHEN 4 THEN 'Unpaid'
                            WHEN 3 THEN 'Partial' ELSE 'Paid' END status
                  FROM fee_vouchers fv
                  JOIN students s ON s.student_id = fv.student_id
                 WHERE fv.status <> 'Cancelled' AND s.is_deleted = 0
                 GROUP BY fv.student_id) v`);

    near("authenticity: totals.billed matches SUM(total_payable)", body.totals.billed, t.billed);
    near("authenticity: totals.collected matches SUM(amount_paid)", body.totals.collected, t.collected);
    near("authenticity: totals.outstanding matches SUM(remaining_balance)", body.totals.outstanding, t.outstanding);
    eq("authenticity: totals.studentsBilled matches COUNT(DISTINCT student)", body.totals.studentsBilled, t.students_billed);
    eq("authenticity: totals.paid matches DB", body.totals.paid, t.paid);
    eq("authenticity: totals.partial matches DB", body.totals.partial, t.partial);
    eq("authenticity: totals.unpaid matches DB", body.totals.unpaid, t.unpaid);
    eq("authenticity: totals.overdue matches DB", body.totals.overdue, t.overdue);

    // The four status chips are a partition of the billed students: if they do
    // not add up, a category is being dropped from the UI (Partial was).
    const chipSum = body.totals.paid + body.totals.partial + body.totals.unpaid + body.totals.overdue;
    eq("consistency: status chips sum to studentsBilled", chipSum, body.totals.studentsBilled);

    // ---- authenticity: one real row, field by field ----
    const row = body.rows[0];
    const [dbRow] = await q(`
        SELECT s.registration_number, CONCAT(s.first_name,' ',s.last_name) name,
               p.program_name, b.batch_name, sem.semester_number,
               SUM(fv.total_payable) billed, SUM(fv.amount_paid) paid,
               SUM(fv.remaining_balance) balance
          FROM students s
          LEFT JOIN programs p ON p.program_id = s.program_id
          LEFT JOIN batches b ON b.batch_id = s.batch_id
          LEFT JOIN semesters sem ON sem.semester_id = s.current_semester_id
          LEFT JOIN fee_vouchers fv ON fv.student_id = s.student_id AND fv.status <> 'Cancelled'
         WHERE s.student_id = :id
         GROUP BY s.student_id`, { id: row.id });

    eq(`authenticity: row.regNo (student ${row.id})`, row.regNo, dbRow.registration_number);
    eq("authenticity: row.name", row.name, dbRow.name.trim());
    eq("authenticity: row.program", row.program, dbRow.program_name);
    eq("authenticity: row.batch (rendered in the new Batch column)", row.batch, dbRow.batch_name);
    near("authenticity: row.feeAmount", row.feeAmount, dbRow.billed);
    near("authenticity: row.paidAmount", row.paidAmount, dbRow.paid);
    near("authenticity: row.remainingBalance (new Balance Due column)", row.remainingBalance, dbRow.balance);

    // ---- liveness: the statuses the UI styles against are the ones sent ----
    const VALID = ["Paid", "Partial", "Unpaid", "Overdue"];
    const seen = [...new Set(body.rows.map((r) => r.feeStatus).filter(Boolean))];
    check("liveness: every feeStatus is one the UI has a style for",
        seen.every((s) => VALID.includes(s)), `seen=[${seen}]`);
    check("liveness: 'Pending' is never emitted (the value the UI used to test)",
        !seen.includes("Pending"), `seen=[${seen}]`);

    // ---- liveness: the filters actually filter the AGGREGATES, not just rows ----
    const [prog] = await q(`SELECT program_id FROM programs WHERE is_deleted = 0 ORDER BY program_id LIMIT 1`);
    const filtered = await api(`/api/admin/fees?limit=1&program_id=${prog.program_id}`);
    check("liveness: program filter narrows the roster",
        filtered.body.pagination.total < body.pagination.total,
        `filtered=${filtered.body.pagination.total} all=${body.pagination.total}`);
    check("liveness: program filter narrows totals.billed too (was frozen institute-wide)",
        Number(filtered.body.totals.billed) < Number(body.totals.billed),
        `filtered=${filtered.body.totals.billed} all=${body.totals.billed}`);

    const [ft] = await q(`
        SELECT SUM(v.total_payable) billed, COUNT(*) students
          FROM (SELECT fv.student_id, SUM(fv.total_payable) total_payable
                  FROM fee_vouchers fv
                  JOIN students s ON s.student_id = fv.student_id
                 WHERE fv.status <> 'Cancelled' AND s.is_deleted = 0
                   AND s.program_id = :pid
                 GROUP BY fv.student_id) v`, { pid: prog.program_id });
    near("authenticity: filtered totals.billed matches SQL for that programme",
        filtered.body.totals.billed, ft.billed);

    // ---- liveness: monthly collection counts VERIFIED payments only ----
    const [mc] = await q(`
        SELECT COUNT(*) payments, SUM(amount_paid) collected
          FROM fee_payments WHERE status = 'Verified' AND payment_date IS NOT NULL`);
    const apiPayments = body.monthlyCollection.reduce((s, m) => s + m.payments, 0);
    const apiCollected = body.monthlyCollection.reduce((s, m) => s + m.collected, 0);
    eq("authenticity: monthlyCollection payment count matches verified rows", apiPayments, mc.payments);
    near("authenticity: monthlyCollection sums to verified money", apiCollected, mc.collected, 1);
    check("liveness: monthlyCollection rows carry a `payments` count (now shown in the tooltip)",
        body.monthlyCollection.every((m) => typeof m.payments === "number"));

    // ---- authenticity: the fee schedule is the real price list ----
    const dist = await q(`SELECT fee_category, SUM(amount) amount FROM fee_structures GROUP BY fee_category`);
    eq("authenticity: distribution category count matches fee_structures", body.distribution.length, dist.length);
    for (const d of body.distribution) {
        const match = dist.find((x) => (x.fee_category || "Uncategorised") === d.category);
        near(`authenticity: schedule amount for ${d.category}`, d.amount, match ? match.amount : NaN);
    }
};

/* ======================================================================
   /examination
   ====================================================================== */
const examination = async () => {
    section("/examination  ->  GET /api/admin/examination");

    const { status, body } = await api("/api/admin/examination?limit=5");
    check("routing: 200 from /api/admin/examination", status === 200, `status=${status}`);

    for (const key of ["rows", "pagination", "summary", "gradeDistribution", "byProgram", "recentExams", "gradingScale", "options"]) {
        check(`routing: envelope carries \`${key}\``, body[key] !== undefined);
    }

    // ---- authenticity: the headline, re-derived ----
    const [s] = await q(`
        SELECT COUNT(scored.pct) scored, ROUND(AVG(scored.pct),1) average_score,
               SUM(scored.pct >= 80) distinction,
               COUNT(newest.cgpa) with_cgpa, SUM(newest.cgpa >= 2.5) passed
          FROM students s
          LEFT JOIN (SELECT m.student_id,
                            SUM(m.obtained_marks)/NULLIF(SUM(e.total_marks),0)*100 pct
                       FROM marks m JOIN exams e ON e.exam_id = m.exam_id
                      WHERE e.total_marks > 0 GROUP BY m.student_id) scored
                 ON scored.student_id = s.student_id
          LEFT JOIN (SELECT r.student_id, r.cgpa FROM results r
                       JOIN (SELECT student_id, MAX(semester_id) semester_id
                               FROM results GROUP BY student_id) l
                         ON l.student_id = r.student_id AND l.semester_id = r.semester_id) newest
                 ON newest.student_id = s.student_id
         WHERE s.is_deleted = 0`);

    eq("authenticity: summary.scored matches students with graded sittings", body.summary.scored, s.scored);
    near("authenticity: summary.averageScore matches AVG(pct)", body.summary.averageScore, s.average_score, 0.05);
    eq("authenticity: summary.withCgpa matches students with a result", body.summary.withCgpa, s.with_cgpa);
    eq("authenticity: summary.passed matches CGPA >= 2.5", body.summary.passed, s.passed);
    eq("authenticity: summary.failed is withCgpa - passed", body.summary.failed, Number(s.with_cgpa) - Number(s.passed));
    eq("authenticity: summary.distinction matches pct >= 80", body.summary.distinction, s.distinction);

    // The Pass Rate tile prints passed/withCgpa; they must divide out.
    const impliedRate = Number(((body.summary.passed / body.summary.withCgpa) * 100).toFixed(1));
    eq("consistency: passRate equals passed/withCgpa (tile caption's denominator)",
        body.summary.passRate, impliedRate);

    // ---- authenticity: grade bands come from the `grades` table ----
    const ladder = await q(`SELECT grade_letter, min_percentage, max_percentage FROM grades ORDER BY min_percentage DESC`);
    eq("authenticity: gradingScale band count matches `grades` table", body.gradingScale.length, ladder.length);
    check("liveness: gradingScale is the institute's own ladder, not a hardcoded 12-band one",
        body.gradingScale.map((g) => g.grade_letter).join(",") === ladder.map((g) => g.grade_letter).join(","),
        `api=[${body.gradingScale.map((g) => g.grade_letter)}] db=[${ladder.map((g) => g.grade_letter)}]`);

    const distTotal = body.gradeDistribution.reduce((sum, g) => sum + g.students, 0);
    eq("consistency: gradeDistribution sums to summary.scored (the chart's real header)",
        distTotal, body.summary.scored);

    // ---- authenticity: byProgram.avgScore is a CGPA, on the 0-4 scale ----
    const withCgpa = body.byProgram.filter((p) => p.avgScore != null);
    check("liveness: byProgram.avgScore is a CGPA (0-4), not a percentage — the UI now labels it Avg. CGPA",
        withCgpa.every((p) => p.avgScore >= 0 && p.avgScore <= 4),
        `values=[${withCgpa.map((p) => p.avgScore)}]`);

    const [p0] = body.byProgram;
    const [dbProg] = await q(`
        SELECT COUNT(DISTINCT s.student_id) students, ROUND(AVG(newest.cgpa),2) avg_cgpa
          FROM students s JOIN programs p ON p.program_id = s.program_id
          LEFT JOIN (SELECT r.student_id, r.cgpa FROM results r
                       JOIN (SELECT student_id, MAX(semester_id) semester_id
                               FROM results GROUP BY student_id) l
                         ON l.student_id = r.student_id AND l.semester_id = r.semester_id) newest
                 ON newest.student_id = s.student_id
         WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND p.program_id = :pid`, { pid: p0.programId });
    eq(`authenticity: byProgram students for ${p0.program}`, p0.students, dbProg.students);
    near(`authenticity: byProgram avg CGPA for ${p0.program}`, p0.avgScore, dbProg.avg_cgpa, 0.01);

    // ---- liveness: recentExams, the block the screen never rendered ----
    check("liveness: recentExams is populated (was fetched and discarded)",
        Array.isArray(body.recentExams) && body.recentExams.length > 0,
        `count=${body.recentExams.length}`);
    const ex = body.recentExams[0];
    const [dbEx] = await q(`
        SELECT e.exam_name, e.exam_type, e.total_marks, sub.subject_code,
               (SELECT COUNT(*) FROM marks m WHERE m.exam_id = e.exam_id) marks_entered
          FROM exams e LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
         WHERE e.exam_id = :id`, { id: ex.examId });
    eq(`authenticity: recentExams[0].name (exam ${ex.examId})`, ex.name, dbEx.exam_name);
    eq("authenticity: recentExams[0].type", ex.type, dbEx.exam_type);
    eq("authenticity: recentExams[0].totalMarks", ex.totalMarks, dbEx.total_marks);
    eq("authenticity: recentExams[0].subjectCode", ex.subjectCode, dbEx.subject_code);
    eq("authenticity: recentExams[0].marksEntered", ex.marksEntered, dbEx.marks_entered);

    // ---- liveness: per-row fields the roster now renders ----
    const r = body.rows[0];
    for (const f of ["cgpa", "gpa", "resultStatus", "examScore", "examGrade", "examSittings"]) {
        check(`liveness: row carries \`${f}\` (all six are rendered now)`, f in r, `value=${r[f]}`);
    }
    const [dbStu] = await q(`
        SELECT r.cgpa, r.gpa, r.status
          FROM results r
          JOIN (SELECT student_id, MAX(semester_id) semester_id FROM results
                 WHERE student_id = :id GROUP BY student_id) l
            ON l.student_id = r.student_id AND l.semester_id = r.semester_id`, { id: r.id });
    if (dbStu) {
        near(`authenticity: row.cgpa (student ${r.id})`, r.cgpa, dbStu.cgpa, 0.01);
        near("authenticity: row.gpa", r.gpa, dbStu.gpa, 0.01);
        eq("authenticity: row.resultStatus", r.resultStatus, dbStu.status);
    }

    // ---- liveness: the programme filter the UI now exposes ----
    const [prog] = await q(`SELECT program_id FROM programs WHERE is_deleted = 0 ORDER BY program_id LIMIT 1`);
    const filtered = await api(`/api/admin/examination?limit=1&program_id=${prog.program_id}`);
    check("liveness: program_id filter is honoured (the new dropdown)",
        filtered.body.pagination.total < body.pagination.total,
        `filtered=${filtered.body.pagination.total} all=${body.pagination.total}`);
};

/* ======================================================================
   /parents
   ====================================================================== */
const parents = async () => {
    section("/parents  ->  GET /api/admin/parents");

    const { status, body } = await api("/api/admin/parents?limit=5");
    check("routing: 200 from /api/admin/parents", status === 200, `status=${status}`);
    for (const key of ["rows", "pagination", "summary"]) {
        check(`routing: envelope carries \`${key}\``, body[key] !== undefined);
    }

    const [total] = await q(`SELECT COUNT(*) n FROM parents WHERE is_deleted = 0`);
    eq("authenticity: pagination.total matches live parents", body.pagination.total, total.n);

    // ---- authenticity: the four stat tiles, re-derived ----
    const [sum] = await q(`
        SELECT COUNT(*) parents, SUM(c.children > 1) multiple, SUM(c.children = 1) single,
               SUM(c.children = 0) none_, COALESCE(SUM(c.children),0) linked
          FROM parents p
          JOIN (SELECT p2.parent_id,
                       (SELECT COUNT(*) FROM student_guardians sg
                          JOIN students st ON st.student_id = sg.student_id AND st.is_deleted = 0
                         WHERE sg.parent_id = p2.parent_id) children
                  FROM parents p2) c ON c.parent_id = p.parent_id
         WHERE p.is_deleted = 0`);
    eq("authenticity: summary.parents (tile 1)", body.summary.parents, sum.parents);
    eq("authenticity: summary.multipleChildren (tile 2)", body.summary.multipleChildren, sum.multiple);
    eq("authenticity: summary.singleChild (tile 3)", body.summary.singleChild, sum.single);
    eq("authenticity: summary.linkedChildren (tile 4)", body.summary.linkedChildren, sum.linked);
    eq("authenticity: summary.noChildren", body.summary.noChildren, sum.none_);
    check("consistency: tiles 2+3+noChildren partition the parent count",
        Number(sum.multiple) + Number(sum.single) + Number(sum.none_) === Number(sum.parents),
        `${sum.multiple}+${sum.single}+${sum.none_} vs ${sum.parents}`);

    /*
     * A guardian who actually HAS a child.
     *
     * This used to take rows[0] and wrap the children assertions in
     * `if (kids.length)`. When parent 1's only link was removed through the UI,
     * those eight checks stopped running and the suite still reported "all
     * passed" — a silent loss of coverage, which is the failure mode a test
     * suite must not have. It now asks the database for a parent with a live
     * ward and fails loudly if the institute has none.
     */
    const [withChild] = await q(
        `SELECT sg.parent_id FROM student_guardians sg
           JOIN students s ON s.student_id = sg.student_id AND s.is_deleted = 0
           JOIN parents p ON p.parent_id = sg.parent_id AND p.is_deleted = 0
          LIMIT 1`
    );
    check("fixture: a guardian with a live ward exists to test against", !!withChild);
    if (!withChild) return;

    const located = await api(`/api/admin/parents?limit=1&q=${withChild.parent_id}`);
    const row = (located.body.rows || []).find((p) => p.id === withChild.parent_id)
        || (await api(`/api/admin/parents?limit=200`)).body.rows.find((p) => p.id === withChild.parent_id)
        || body.rows[0];
    const [dbP] = await q(`
        SELECT p.first_name, p.last_name, p.phone, p.occupation, u.email
          FROM parents p LEFT JOIN users u ON u.user_id = p.user_id
         WHERE p.parent_id = :id`, { id: row.id });
    eq(`authenticity: row.name (parent ${row.id})`, row.name, `${dbP.first_name} ${dbP.last_name}`.trim());
    eq("authenticity: row.email", row.email, dbP.email);
    eq("authenticity: row.phone", row.phone, dbP.phone);
    eq("authenticity: row.occupation (now rendered on the card)", row.occupation, dbP.occupation);
    eq("liveness: row.firstName is sent, so the edit form need not split the name",
        row.firstName, dbP.first_name);
    eq("liveness: row.lastName is sent", row.lastName, dbP.last_name);

    // ---- authenticity: the children panel ----
    const kids = await q(`
        SELECT s.student_id, s.registration_number, CONCAT(s.first_name,' ',s.last_name) name,
               s.academic_status, pr.program_name, sg.relationship
          FROM student_guardians sg
          JOIN students s ON s.student_id = sg.student_id AND s.is_deleted = 0
          LEFT JOIN programs pr ON pr.program_id = s.program_id
         WHERE sg.parent_id = :id`, { id: row.id });
    eq("authenticity: child count matches student_guardians", row.children.length, kids.length);
    check("coverage: the guardian under test has at least one child", kids.length > 0, `children=${kids.length}`);
    if (kids.length) {
        const c = row.children[0];
        const dbC = kids.find((k) => k.student_id === c.id);
        eq("authenticity: child.regNo", c.regNo, dbC.registration_number);
        eq("authenticity: child.name", c.name, dbC.name.trim());
        eq("authenticity: child.program", c.program, dbC.program_name);
        eq("authenticity: child.status", c.status, dbC.academic_status);
        eq("authenticity: child.relationship", c.relationship, dbC.relationship);
        // The UI used to read these two and neither has ever been sent, so
        // every child avatar collapsed onto one hardcoded colour.
        check("liveness: child.avatarBg is NOT sent — avatars must be derived client-side",
            c.avatarBg === undefined);
        check("liveness: child.initials is NOT sent — initials must be derived client-side",
            c.initials === undefined);
    }

    // ---- liveness: search reaches the child, not just the parent ----
    if (kids.length) {
        const childName = kids[0].name.trim();
        const found = await api(`/api/admin/parents?limit=5&q=${encodeURIComponent(childName)}`);
        check("liveness: searching a CHILD's name finds the guardian",
            found.body.rows.some((p) => p.id === row.id),
            `q="${childName}" hits=${found.body.pagination.total}`);
        const reg = kids[0].registration_number;
        const byReg = await api(`/api/admin/parents?limit=5&q=${encodeURIComponent(reg)}`);
        check("liveness: searching a registration number finds the guardian",
            byReg.body.rows.some((p) => p.id === row.id), `q="${reg}"`);
    }
};

/* ======================================================================
   /faculty
   ====================================================================== */
const faculty = async () => {
    section("/faculty  ->  GET /api/admin/teachers");

    const { status, body } = await api("/api/admin/teachers?limit=5");
    check("routing: 200 from /api/admin/teachers", status === 200, `status=${status}`);
    for (const key of ["rows", "pagination", "departments", "subjects", "batches", "sections"]) {
        check(`routing: envelope carries \`${key}\``, body[key] !== undefined);
    }

    const t = body.rows[0];
    const [dbT] = await q(`
        SELECT e.employee_code, e.designation, e.hire_date, e.employment_status,
               d.department_name, tt.specialization,
               CONCAT(e.first_name,' ',e.last_name) name, u.email
          FROM teachers tt
          JOIN employees e ON e.employee_id = tt.employee_id
          LEFT JOIN departments d ON d.department_id = e.department_id
          LEFT JOIN users u ON u.user_id = e.user_id
         WHERE tt.teacher_id = :id`, { id: t.teacherId });

    eq(`authenticity: row.name (teacher ${t.teacherId})`, t.name, dbT.name.trim());
    eq("authenticity: row.employeeCode (now shown as a chip)", t.employeeCode, dbT.employee_code);
    eq("authenticity: row.designation", t.designation, dbT.designation);
    eq("authenticity: row.department", t.department, dbT.department_name);
    eq("authenticity: row.specialization (replaces the hardcoded Qualification card)",
        t.specialization, dbT.specialization);
    eq("authenticity: row.employmentStatus", t.employmentStatus, dbT.employment_status);
    eq("authenticity: row.email", t.email, dbT.email);

    // ---- liveness: fields the old mapping invented or dropped ----
    check("liveness: sectionCount is a real number (UI used a hardcoded [] and showed 0)",
        typeof t.sectionCount === "number", `sectionCount=${t.sectionCount}`);
    check("liveness: weeklyContactHours is sent (replaces the 'Students: null' tile)",
        typeof t.weeklyContactHours === "number", `hours=${t.weeklyContactHours}`);
    check("liveness: weeklySessions is sent", typeof t.weeklySessions === "number");
    check("liveness: hireDate is sent (new Joined card)", t.hireDate !== undefined, `hireDate=${t.hireDate}`);
    check("liveness: the API sends NO student/mentee count — the UI must not claim one",
        t.students === undefined && t.studentCount === undefined);

    // subjects[] must carry credit hours, which the old mapping flattened away
    check("liveness: subjects[] carries creditHours (now shown as a `N cr` chip)",
        t.subjects.length === 0 || t.subjects.every((s) => s.creditHours != null),
        `subjects=${t.subjects.length}`);
    eq("consistency: subjectCount matches subjects[].length", t.subjectCount, t.subjects.length);

    // ---- authenticity: the weekly load is the real timetable ----
    const [load] = await q(`
        SELECT COUNT(*) sessions, COUNT(DISTINCT tt.section_id) sections,
               COUNT(DISTINCT tt.subject_id) subjects
          FROM timetables tt WHERE tt.teacher_id = :id`, { id: t.teacherId });
    eq("authenticity: weeklySessions matches the timetable", t.weeklySessions, load.sessions);
    eq("authenticity: sectionCount matches DISTINCT sections on the timetable", t.sectionCount, load.sections);
    eq("authenticity: subjectCount matches DISTINCT subjects on the timetable", t.subjectCount, load.subjects);

    // ---- liveness: profile picture, which the card was discarding ----
    const withPhoto = body.rows.filter((r) => r.profilePicture);
    check("liveness: profilePicture is sent (the card now renders it)",
        "profilePicture" in t, `rows with a photo: ${withPhoto.length}/${body.rows.length}`);
};

/* ======================================================================
   /announcements
   ====================================================================== */
const announcements = async () => {
    section("/announcements  ->  GET /api/announcements");

    const { status, body } = await api("/api/announcements?limit=5&page=1");
    check("routing: 200 from /api/announcements", status === 200, `status=${status}`);
    for (const key of ["data", "total", "options"]) {
        check(`routing: envelope carries \`${key}\``, body[key] !== undefined);
    }

    const [{ n }] = await q(`SELECT COUNT(*) n FROM announcements`);
    eq("authenticity: total matches the announcements table", body.total, n);
    check("liveness: the page is limited (the board used to fetch everything)",
        body.data.length <= 5, `returned=${body.data.length}`);

    // ---- pagination genuinely pages ----
    const p2 = await api("/api/announcements?limit=5&page=2");
    const overlap = body.data.filter((a) => p2.body.data.some((b) => b.announcement_id === a.announcement_id));
    check("liveness: page 2 returns different rows to page 1", overlap.length === 0,
        `overlap=${overlap.length}`);

    // ---- the filter options are real ----
    const audiences = await q(
        `SELECT COALESCE(target_role,'Targeted') v, COUNT(*) c FROM announcements GROUP BY v`
    );
    eq("authenticity: option list covers every audience present", body.options.audiences.length, audiences.length);
    for (const a of body.options.audiences) {
        const db = audiences.find((x) => x.v === a.value);
        eq(`authenticity: audience count for ${a.value}`, a.count, db ? db.c : NaN);
    }
    check("liveness: every author option resolves to a label, never blank",
        body.options.authors.every((a) => a.label && a.label.trim()),
        `authors=${body.options.authors.length}`);

    // ---- each filter actually filters ----
    const first = body.options.audiences[0];
    const byRole = await api(`/api/announcements?target_role=${encodeURIComponent(first.value)}`);
    eq(`liveness: target_role=${first.value} narrows to its count`, byRole.body.total, first.count);

    const [sample] = await q(`SELECT title FROM announcements LIMIT 1`);
    const word = sample.title.split(/\s+/).find((w) => w.length > 5) || sample.title.slice(0, 6);
    const search = await api(`/api/announcements?q=${encodeURIComponent(word)}`);
    const [{ hits }] = await q(
        `SELECT COUNT(*) hits FROM announcements WHERE title LIKE :q OR content LIKE :q`,
        { q: `%${word}%` }
    );
    eq(`liveness: q="${word}" matches title OR body`, search.body.total, hits);

    const author = body.options.authors[0];
    const byAuthor = await api(`/api/announcements?posted_by=${author.value}`);
    eq("liveness: posted_by narrows to that author's count", byAuthor.body.total, author.count);

    const oldest = await api("/api/announcements?sort=oldest&limit=1");
    const newest = await api("/api/announcements?sort=newest&limit=1");
    check("liveness: sort=oldest and sort=newest return opposite ends",
        oldest.body.data[0].announcement_id !== newest.body.data[0].announcement_id
        || body.total === 1);

    const [range] = await q(
        `SELECT MIN(DATE(created_at)) lo, MAX(DATE(created_at)) hi FROM announcements`
    );
    const windowed = await api(`/api/announcements?from=${range.lo}&to=${range.hi}`);
    eq("liveness: a from/to window spanning everything returns everything",
        windowed.body.total, n);
};

/* ======================================================================
   /user-management
   ====================================================================== */
const userManagement = async () => {
    section("/user-management  ->  GET /api/users");

    const { status, body } = await api("/api/users?limit=10");
    check("routing: 200 from /api/users", status === 200, `status=${status}`);
    for (const key of ["data", "total", "summary", "roleCounts"]) {
        check(`routing: envelope carries \`${key}\``, body[key] !== undefined);
    }

    // ---- the account-health headline, re-derived ----
    const [h] = await q(
        `SELECT COUNT(*) accounts,
                SUM(last_login IS NULL) never_logged_in,
                SUM(failed_login_attempts > 0) locked,
                SUM(must_change_password = 1) must_change,
                SUM(is_active = 0) inactive,
                SUM(user_id NOT IN (
                    SELECT user_id FROM students  WHERE user_id IS NOT NULL AND is_deleted = 0
                     UNION SELECT user_id FROM parents   WHERE user_id IS NOT NULL AND is_deleted = 0
                     UNION SELECT user_id FROM employees WHERE user_id IS NOT NULL AND is_deleted = 0)) orphans
           FROM users WHERE is_deleted = 0`
    );
    eq("authenticity: summary.accounts", body.summary.accounts, h.accounts);
    eq("authenticity: summary.neverLoggedIn", body.summary.neverLoggedIn, h.never_logged_in);
    eq("authenticity: summary.locked", body.summary.locked, h.locked);
    eq("authenticity: summary.mustChangePassword", body.summary.mustChangePassword, h.must_change);
    eq("authenticity: summary.orphans (logins with no person record)", body.summary.orphans, h.orphans);

    // ---- role counts ----
    const roles = await q(
        `SELECT r.role_id, COUNT(u.user_id) n FROM roles r
           LEFT JOIN users u ON u.role_id = r.role_id AND u.is_deleted = 0
          GROUP BY r.role_id ORDER BY r.role_id`
    );
    eq("authenticity: roleCounts covers every role", body.roleCounts.length, roles.length);
    for (const rc of body.roleCounts) {
        const db = roles.find((x) => x.role_id === rc.roleId);
        eq(`authenticity: account count for ${rc.roleName}`, rc.accounts, db.n);
    }

    // ---- every security column the redesigned table renders ----
    const u = body.data[0];
    for (const f of ["is_active", "last_login", "failed_login_attempts",
        "must_change_password", "last_password_change", "created_at", "full_name", "profile_type"]) {
        check(`liveness: row carries \`${f}\``, f in u);
    }

    // ---- the status cohorts filter server-side ----
    for (const [status_, expected] of [
        ["never_logged_in", h.never_logged_in],
        ["locked", h.locked],
        ["must_change_password", h.must_change]
    ]) {
        const res = await api(`/api/users?limit=1&status=${status_}`);
        eq(`liveness: status=${status_} narrows to its real count`, res.body.total, expected);
    }

    const orphans = await api("/api/users?limit=200&orphans=only");
    eq("liveness: orphans=only returns exactly the unlinked logins", orphans.body.total, h.orphans);
    check("liveness: every orphan really has no person record",
        orphans.body.data.every((r) => !r.profile_type),
        `checked=${orphans.body.data.length}`);

    // ---- is_active parsing, which used to read "1" as false ----
    const active1 = await api("/api/users?limit=1&is_active=1");
    const activeTrue = await api("/api/users?limit=1&is_active=true");
    eq("liveness: is_active=1 and is_active=true agree (numeric form was read as FALSE)",
        active1.body.total, activeTrue.body.total);

    // ---- sorting is remote and puts nulls last ----
    const sorted = await api("/api/users?limit=5&sort=last_login&dir=desc");
    check("liveness: sort=last_login&dir=desc puts a real sign-in first, not a null",
        sorted.body.data[0].last_login !== null,
        `first=${sorted.body.data[0].last_login}`);
};

/* ======================================================================
   Reports and the student export the PDFs are built from
   ====================================================================== */
const reports = async () => {
    section("/reports  ->  GET /api/admin/reports + /api/admin/students/export");

    const { status, body } = await api("/api/admin/reports");
    check("routing: 200 from /api/admin/reports", status === 200, `status=${status}`);

    const [att] = await q(
        `SELECT ROUND(AVG(pct), 1) avg_pct, SUM(pct < 75) below
           FROM (SELECT student_id,
                        100 * SUM(present_count + late_count) / NULLIF(SUM(total_sessions), 0) pct
                   FROM vw_student_attendance_summary GROUP BY student_id) a
          WHERE pct IS NOT NULL`
    );
    near("authenticity: reports.attendance.average", body.attendance.average, att.avg_pct, 0.2);
    eq("authenticity: reports.attendance.belowThreshold", body.attendance.belowThreshold, att.below);

    /*
     * The export is what every student-backed PDF is built from, and it used to
     * carry identity columns ONLY. The Attendance report read `s.attendance` on
     * rows without that key and scored every student 0%; the Fee report
     * totalled `s.paidAmount` and reported Rs 0 collected.
     */
    const exp = await api("/api/admin/students/export");
    const rows = exp.body.rows;
    check("routing: 200 from the export", exp.status === 200, `status=${exp.status}`);

    for (const f of ["attendance", "feeStatus", "feeAmount", "paidAmount",
        "remainingBalance", "cgpa", "gpa", "examScore"]) {
        const present = rows.some((r) => r[f] !== undefined);
        check(`liveness: export carries \`${f}\` (the PDFs report on it)`, present);
    }

    const withAttendance = rows.filter((r) => r.attendance != null).length;
    const [{ n: dbAtt }] = await q(
        `SELECT COUNT(DISTINCT student_id) n FROM vw_student_attendance_summary`
    );
    eq("authenticity: export attendance coverage matches the database", withAttendance, dbAtt);

    // The number the Attendance PDF's at-risk table prints.
    const belowInExport = rows.filter((r) => r.attendance != null && r.attendance < 75).length;
    eq("authenticity: students below 75% in the export match the aggregate",
        belowInExport, att.below);
    check("liveness: NOT every student is below 75% (the old report listed all of them)",
        belowInExport < rows.length, `${belowInExport} of ${rows.length}`);

    const collected = rows.reduce((s, r) => s + (r.paidAmount || 0), 0);
    const [fee] = await q(
        `SELECT SUM(amount_paid) collected FROM fee_vouchers fv
           JOIN students s ON s.student_id = fv.student_id
          WHERE fv.status <> 'Cancelled' AND s.is_deleted = 0`
    );
    near("authenticity: the Fee PDF's collected total matches the ledger", collected, fee.collected, 1);
    check("liveness: the Fee PDF no longer totals Rs 0", collected > 0, `Rs ${collected.toFixed(2)}`);

    // The fee statuses the PDF buckets by must be the ones the API emits.
    const statuses = [...new Set(rows.map((r) => r.feeStatus).filter(Boolean))];
    check("liveness: export fee statuses are the four the PDF now buckets by",
        statuses.every((s) => ["Paid", "Partial", "Unpaid", "Overdue"].includes(s)),
        `seen=[${statuses}]`);
    check("liveness: 'Pending' is never emitted (the bucket the PDF used to filter on)",
        !statuses.includes("Pending"));
};

/* ====================================================================== */
const run = async () => {
    console.log(`\nAdmin screen data-authenticity suite\nTarget: ${BASE}\nAs: ${EMAIL}`);
    await login();
    await feeManagement();
    await examination();
    await parents();
    await faculty();
    await announcements();
    await userManagement();
    await reports();

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${passed}/${results.length} checks passed`);
    if (failed.length) {
        console.log(`\nFAILED:`);
        for (const f of failed) console.log(`  - ${f.name}  (${f.detail})`);
    }
    require("fs").writeFileSync(
        `${__dirname}/admin-screen-results.json`,
        JSON.stringify({ ranAt: new Date().toISOString(), passed, total: results.length, results }, null, 2)
    );
    await sequelize.close();
    process.exit(failed.length ? 1 : 0);
};

run().catch(async (err) => {
    console.error(err);
    await sequelize.close();
    process.exit(1);
});
