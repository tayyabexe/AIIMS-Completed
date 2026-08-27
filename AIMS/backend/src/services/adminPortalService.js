/*
 * Page-scoped data for the admin portal.
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin portal used to call ten general-purpose list endpoints in one
 * parallel batch the moment an admin signed in, and every screen then read from
 * that one in-memory blob. Measured against the live database that was:
 *
 *   /api/students                    916 KB   1540 ms
 *   /api/parents                     695 KB   1434 ms
 *   /api/summaries/fee-status        676 KB    919 ms
 *   /api/summaries/attendance        297 KB    643 ms
 *   /api/student-results             281 KB    562 ms
 *   /api/marks/summary               175 KB    438 ms
 *   + programs / batches / sections / grades
 *   ------------------------------------------
 *   3.04 MB before the first pixel of any screen.
 *
 * Opening Settings paid for all 2,013 students. Opening the Students list paid
 * for every fee voucher and every parent. This module replaces that with one
 * endpoint per screen, each returning only that screen's own columns, filtered
 * and paginated in SQL.
 *
 * Every query here is SELECT-only. Identifiers (sort columns, filter columns)
 * come from fixed whitelists and never from request input; every value is bound
 * as a replacement.
 */

const { sequelize } = require("../database/connection");
const { effectiveSemesterId } = require("./currentSemester");
const audit = require("./auditService");

const select = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

// ------------------------------------------------------------------ helpers

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Page/limit normalisation shared by every list endpoint.
 * The cap exists so a caller cannot ask for the whole table again by hand.
 */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

const paging = (queryParams) => {
    const rawLimit = Number.parseInt(queryParams.limit, 10);
    const rawPage = Number.parseInt(queryParams.page, 10);

    const limit = Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

    return { limit, page, offset: (page - 1) * limit };
};

const envelope = (rows, total, { limit, page }) => ({
    rows,
    pagination: {
        page,
        limit,
        total,
        pages: limit > 0 ? Math.ceil(total / limit) : 1
    }
});

/*
 * The student filters every list screen shares.
 *
 * `q` matches a name or registration number. The rest are exact id/enum
 * matches. Anything not in this function is ignored, so an unexpected query
 * parameter cannot reach the SQL.
 */
const studentFilters = (q = {}) => {
    /*
     * Deleted students are hidden by default and there is no filter that mixes
     * them in with live ones — a roster, a count and an export must never
     * quietly include people who have been removed.
     *
     * `deleted=only` is the exception, and the reason it exists: a soft-deleted
     * student can now be restored, and a screen cannot offer to restore
     * somebody it has no way of listing. It is deliberately "only" rather than
     * "include", so the deleted are a place you go to on purpose.
     */
    const clauses = [
        q.deleted === "only" || q.deleted === "1"
            ? "s.is_deleted = 1"
            : "s.is_deleted = 0"
    ];
    const replacements = {};

    if (q.q) {
        clauses.push(
            `(CONCAT(s.first_name, ' ', s.last_name) LIKE :q
              OR s.registration_number LIKE :q)`
        );
        replacements.q = `%${q.q}%`;
    }

    for (const [param, column] of [
        ["program_id", "s.program_id"],
        ["batch_id", "s.batch_id"],
        ["section_id", "s.section_id"],
        // Effective semester, not the raw column — see currentSemester.js.
        ["semester_id", effectiveSemesterId("s")]
    ]) {
        const value = Number.parseInt(q[param], 10);
        if (Number.isInteger(value)) {
            clauses.push(`${column} = :${param}`);
            replacements[param] = value;
        }
    }

    /*
     * Department, which a student row does not carry.
     *
     * The link is students -> programs -> departments, so this is written as a
     * subquery rather than a join: `studentPage` runs its COUNT against the
     * bare `students` table, and a join added for one optional filter would
     * have to be added to both statements and kept in step. Four departments
     * over six programmes means the inner list is six ids at most.
     *
     * This is what makes "how many students are in this department" answerable
     * — there was no way to ask it before.
     */
    const departmentId = Number.parseInt(q.department_id, 10);
    if (Number.isInteger(departmentId)) {
        clauses.push(
            `s.program_id IN (SELECT program_id FROM programs
                               WHERE department_id = :department_id AND is_deleted = 0)`
        );
        replacements.department_id = departmentId;
    }

    /*
     * "Unplaced" — students with no section at all.
     *
     * 0 rows today, but the admission form does not require a section and
     * nothing else in the portal can list the students it leaves behind: they
     * are absent from every section-shaped screen there is, including the
     * registers their teachers mark.
     */
    if (q.unsectioned === "1" || q.unsectioned === "true") {
        clauses.push("s.section_id IS NULL");
    }

    const STATUSES = [
        "Pending Verification", "Active", "Suspended",
        "Withdrawn", "Graduated", "Alumni"
    ];
    if (q.status && STATUSES.includes(q.status)) {
        clauses.push("s.academic_status = :status");
        replacements.status = q.status;
    }

    /*
     * Cursor stepping, for the profile screen's prev/next buttons.
     *
     * `after` / `before` ask for the rows either side of a given student
     * rather than for a page number, so stepping from student 1,847 to 1,848
     * costs one row instead of the page arithmetic needed to find which page
     * they are on. The caller pairs these with limit=1.
     */
    const after = Number.parseInt(q.after, 10);
    if (Number.isInteger(after)) {
        clauses.push("s.student_id > :after");
        replacements.after = after;
    }

    const before = Number.parseInt(q.before, 10);
    if (Number.isInteger(before)) {
        clauses.push("s.student_id < :before");
        replacements.before = before;
    }

    return {
        sql: clauses.join(" AND "),
        replacements,
        // `before` wants the NEAREST lower id, which is the last row in
        // ascending order — so that direction has to be sorted descending.
        order: Number.isInteger(before) ? "s.student_id DESC" : null
    };
};

/*
 * The lookup lists a filter bar needs. Four small tables, ~3 KB in total, so
 * they ride along with the page that draws the filter bar rather than being a
 * separate round trip.
 */
const filterOptions = async () => {
    const [programs, batches, sections] = await Promise.all([
        select(
            `SELECT program_id, program_name, department_id
               FROM programs WHERE is_deleted = 0 ORDER BY program_name`
        ),
        select(
            `SELECT batch_id, batch_name, program_id
               FROM batches WHERE is_deleted = 0 ORDER BY batch_name`
        ),
        select(
            `SELECT section_id, section_name, batch_id
               FROM sections WHERE is_deleted = 0 ORDER BY section_name`
        )
    ]);

    return { programs, batches, sections };
};

/*
 * The institute's grading ladder, read from the `grades` table so no screen has
 * to invent its own percentage -> letter mapping. Five rows; cached for the
 * process lifetime because it is reference data that does not change during a
 * session.
 */
let gradeLadder = null;

const grades = async () => {
    if (!gradeLadder) {
        gradeLadder = await select(
            `SELECT grade_letter, min_percentage, max_percentage, grade_point
               FROM grades ORDER BY min_percentage DESC`
        );
    }
    return gradeLadder;
};

/*
 * The band a percentage earns: the highest one whose minimum it meets.
 *
 * Deliberately NOT `pct >= min AND pct <= max`. The `grades` table stores its
 * ceilings as 49.99 / 59.99 / 69.99 / 84.99, so a between-test leaves four dead
 * zones — and eight students really do land in them, because an exam average is
 * a computed ratio rather than a rounded mark. Student 33 sits at 69.996%,
 * which is above C's ceiling and below B's floor, and was awarded no grade at
 * all. Reading the ladder downwards from the top closes every gap and needs no
 * change to the reference data.
 *
 * `ladder` is ordered min_percentage DESC by the query that loads it.
 */
const letterFor = (ladder, percentage) => {
    if (percentage === null || percentage === undefined) return null;
    const pct = Number(percentage);
    const hit = ladder.find((g) => pct >= Number(g.min_percentage));
    return hit ? hit.grade_letter : null;
};

/*
 * Enrichment queries, each restricted to the ids on the current page.
 *
 * This is the whole point of the module: the attendance rollup below runs over
 * the 25 students being displayed, not over all 60,216 attendance rows.
 */

const attendanceFor = async (ids) => {
    if (!ids.length) return new Map();

    const rows = await select(
        `SELECT student_id,
                SUM(total_sessions)                       AS total_sessions,
                SUM(present_count) + SUM(late_count)      AS attended,
                SUM(absent_count)                         AS absent_count,
                ROUND(100 * SUM(present_count + late_count)
                          / NULLIF(SUM(total_sessions), 0), 1) AS percentage
           FROM vw_student_attendance_summary
          WHERE student_id IN (:ids)
          GROUP BY student_id`,
        { ids }
    );

    return new Map(rows.map((r) => [r.student_id, r]));
};

/*
 * One settled fee position per student, summed over all of their vouchers.
 *
 * The old screens read a single voucher row per student and reported that as
 * the student's whole fee position, which under-reported anyone billed for more
 * than one semester. `status` here is the worst status the student holds, since
 * that is what a fee screen is meant to surface.
 */
const feesFor = async (ids) => {
    if (!ids.length) return new Map();

    const rows = await select(
        `SELECT student_id,
                SUM(total_payable)                        AS total_payable,
                SUM(amount_paid)                          AS amount_paid,
                SUM(remaining_balance)                    AS remaining_balance,
                MIN(CASE WHEN status IN ('Unpaid','Partial','Overdue')
                         THEN due_date END)               AS due_date,
                MAX(CASE status WHEN 'Overdue'   THEN 5
                                WHEN 'Unpaid'    THEN 4
                                WHEN 'Partial'   THEN 3
                                WHEN 'Paid'      THEN 2
                                ELSE 1 END)               AS status_rank,
                COUNT(*)                                  AS voucher_count
           FROM fee_vouchers
          WHERE student_id IN (:ids)
            AND status <> 'Cancelled'
          GROUP BY student_id`,
        { ids }
    );

    const RANK_TO_STATUS = { 5: "Overdue", 4: "Unpaid", 3: "Partial", 2: "Paid", 1: "Cancelled" };

    return new Map(rows.map((r) => [
        r.student_id,
        { ...r, status: RANK_TO_STATUS[Number(r.status_rank)] || null }
    ]));
};

// The most recently published result per student, for CGPA/GPA.
const resultsFor = async (ids) => {
    if (!ids.length) return new Map();

    const rows = await select(
        `SELECT r.student_id, r.gpa, r.cgpa, r.status, r.semester_id
           FROM results r
           JOIN (
                 SELECT student_id, MAX(semester_id) AS semester_id
                   FROM results
                  WHERE student_id IN (:ids)
                  GROUP BY student_id
                ) latest
             ON latest.student_id = r.student_id
            AND latest.semester_id = r.semester_id
          WHERE r.student_id IN (:ids)`,
        { ids }
    );

    return new Map(rows.map((r) => [r.student_id, r]));
};

// Total obtained over total available, across every exam the student has sat.
const marksFor = async (ids) => {
    if (!ids.length) return new Map();

    const rows = await select(
        `SELECT m.student_id,
                SUM(m.obtained_marks)  AS obtained,
                SUM(e.total_marks)     AS total,
                COUNT(*)               AS sittings,
                ROUND(SUM(m.obtained_marks)
                      / NULLIF(SUM(e.total_marks), 0) * 100, 1) AS percentage
           FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
          WHERE m.student_id IN (:ids)
            AND e.total_marks > 0
          GROUP BY m.student_id`,
        { ids }
    );

    return new Map(rows.map((r) => [r.student_id, r]));
};

// The guardian on record for each student, from `student_guardians`.
const guardiansFor = async (ids) => {
    if (!ids.length) return new Map();

    const rows = await select(
        `SELECT sg.student_id, sg.relationship,
                p.parent_id, p.phone, p.occupation,
                CONCAT(p.first_name, ' ', p.last_name) AS name
           FROM student_guardians sg
           JOIN parents p ON p.parent_id = sg.parent_id
          WHERE sg.student_id IN (:ids)
            AND p.is_deleted = 0`,
        { ids }
    );

    return new Map(rows.map((r) => [r.student_id, r]));
};

/*
 * The base student projection every list screen starts from.
 *
 * `semester_number` is joined from `semesters`. The screens used to render
 * "Semester {current_semester_id}", but semester_id is a global key running
 * 1..40 across five programmes — so a fourth-semester student was displayed as
 * "Semester 23". The real number lives on the row this joins.
 */
const STUDENT_BASE_SELECT = `
    SELECT s.student_id,
           s.user_id,
           s.registration_number,
           s.first_name,
           s.last_name,
           s.gender,
           s.phone,
           -- Carried so the Students screen can open its edit form from the row
           -- it already has, rather than fetching the full profile first.
           s.dob,
           s.is_deleted,
           s.academic_status,
           s.program_id,
           s.batch_id,
           s.section_id,
           -- The semester the student is actually in, which is not always the
           -- one the column holds: nothing on the enrollment path maintains
           -- current_semester_id, so a correctly-registered student whose
           -- column is NULL used to list as "No semester". See
           -- services/currentSemester.js.
           ${effectiveSemesterId("s")} AS current_semester_id,
           p.program_name,
           b.batch_name,
           sec.section_name,
           sem.semester_number
      FROM students s
      LEFT JOIN programs  p   ON p.program_id  = s.program_id
      LEFT JOIN batches   b   ON b.batch_id    = s.batch_id
      LEFT JOIN sections  sec ON sec.section_id = s.section_id
      LEFT JOIN semesters sem ON sem.semester_id = ${effectiveSemesterId("s")}
`;

const baseStudentShape = (r) => ({
    id: r.student_id,
    studentId: r.student_id,
    userId: r.user_id,
    regNo: r.registration_number,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
    firstName: r.first_name,
    lastName: r.last_name,
    gender: (r.gender || "").toLowerCase() || null,
    phone: r.phone || null,
    // ISO date only — the edit form binds it straight to <input type="date">.
    dob: r.dob ? String(r.dob).slice(0, 10) : null,
    deleted: !!r.is_deleted,
    status: r.academic_status || null,
    program: r.program_name || null,
    programId: r.program_id,
    batch: r.batch_name || null,
    batchId: r.batch_id,
    section: r.section_name || null,
    sectionId: r.section_id,
    semester: r.semester_number ? `Semester ${r.semester_number}` : null,
    semesterNumber: r.semester_number ?? null,
    semesterId: r.current_semester_id
});

/**
 * Runs the shared "count + page of students" pair for a list screen.
 * Returns the raw rows plus the paging envelope so each caller can decide
 * which enrichment queries that particular screen needs.
 */
/*
 * Column sorting for any screen built on the student list, whitelisted.
 *
 * These tables are paged in SQL, so sorting them in the browser would only ever
 * reorder the 25 rows already on screen — "sort by name" would silently mean
 * "sort these 25 by name", which looks like it worked and is wrong. The key is
 * matched against this map and never interpolated from request input.
 *
 * NULLs sort last in both directions: a student with no batch recorded is not
 * the alphabetically first batch.
 */
const STUDENT_SORTABLE = {
    id: "s.student_id",
    regNo: "s.registration_number",
    name: "CONCAT(s.first_name, ' ', s.last_name)",
    program: "p.program_name",
    batch: "b.batch_name",
    semester: "sem.semester_number",
    section: "sec.section_name",
    status: "s.academic_status"
};

const studentOrder = (queryParams, fallback) => {
    const column = STUDENT_SORTABLE[queryParams.sort];
    if (!column) return fallback;
    const dir = String(queryParams.dir).toLowerCase() === "desc" ? "DESC" : "ASC";
    return `${column} IS NULL, ${column} ${dir}, s.student_id ASC`;
};

const studentPage = async (queryParams, orderBy = "s.student_id") => {
    const where = studentFilters(queryParams);
    const page = paging(queryParams);

    const [{ total }] = await select(
        `SELECT COUNT(*) AS total FROM students s WHERE ${where.sql}`,
        where.replacements
    );

    const rows = await select(
        `${STUDENT_BASE_SELECT}
          WHERE ${where.sql}
          ORDER BY ${where.order || studentOrder(queryParams, orderBy)}
          LIMIT :limit OFFSET :offset`,
        { ...where.replacements, limit: page.limit, offset: page.offset }
    );

    return { rows, total: Number(total), page };
};

// ==========================================================================
// 1. DASHBOARD  -  GET /api/admin/dashboard
// ==========================================================================
/*
 * The four stat tiles and nothing else. Every figure is one SQL aggregate over
 * the whole institute, so this stays a few hundred bytes no matter how many
 * students exist — where the old dashboard downloaded all 2,013 of them and
 * counted in JavaScript.
 */
const getDashboard = async () => {
    const [
        [studentCounts],
        [feeTotals],
        [attendanceTotals],
        [resultTotals],
        programCount
    ] = await Promise.all([
        select(
            `SELECT COUNT(*)                                              AS total,
                    SUM(academic_status = 'Active')                       AS active,
                    SUM(academic_status = 'Pending Verification')         AS pending,
                    SUM(academic_status IN ('Suspended','Withdrawn'))     AS inactive
               FROM students WHERE is_deleted = 0`
        ),
        select(
            `SELECT SUM(total_payable)                                    AS billed,
                    SUM(amount_paid)                                      AS collected,
                    SUM(remaining_balance)                                AS outstanding,
                    COUNT(DISTINCT CASE WHEN status = 'Paid'
                                        THEN student_id END)              AS students_paid,
                    COUNT(DISTINCT CASE WHEN status = 'Overdue'
                                        THEN student_id END)              AS students_overdue
               FROM fee_vouchers WHERE status <> 'Cancelled'`
        ),
        select(
            `SELECT ROUND(100 * SUM(present_count + late_count)
                              / NULLIF(SUM(total_sessions), 0), 1)        AS average,
                    COUNT(DISTINCT student_id)                            AS students_with_records
               FROM vw_student_attendance_summary`
        ),
        // Pass and distinction are counted over students who actually have a
        // published result. Treating "no result yet" as a fail is what made the
        // old dashboard report a 0% pass rate for the whole institute.
        select(
            `SELECT COUNT(*)                       AS with_result,
                    SUM(cgpa >= 2.5)               AS passed,
                    SUM(cgpa >= 3.5)               AS distinction,
                    ROUND(AVG(cgpa), 2)            AS average_cgpa
               FROM (
                     SELECT r.student_id, r.cgpa
                       FROM results r
                       JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                               FROM results GROUP BY student_id) latest
                         ON latest.student_id = r.student_id
                        AND latest.semester_id = r.semester_id
                    ) newest`
        ),
        select(`SELECT COUNT(*) AS total FROM programs WHERE is_deleted = 0`)
    ]);

    const withResult = Number(resultTotals.with_result || 0);
    const belowThreshold = await select(
        `SELECT COUNT(*) AS total FROM (
             SELECT student_id,
                    100 * SUM(present_count + late_count)
                        / NULLIF(SUM(total_sessions), 0) AS pct
               FROM vw_student_attendance_summary
              GROUP BY student_id
             HAVING pct < 75
         ) low`
    );

    return {
        students: {
            total: Number(studentCounts.total || 0),
            active: Number(studentCounts.active || 0),
            pending: Number(studentCounts.pending || 0),
            inactive: Number(studentCounts.inactive || 0),
            programs: Number(programCount[0].total || 0)
        },
        fees: {
            billed: num(feeTotals.billed),
            collected: num(feeTotals.collected),
            outstanding: num(feeTotals.outstanding),
            studentsPaid: Number(feeTotals.students_paid || 0),
            studentsOverdue: Number(feeTotals.students_overdue || 0)
        },
        attendance: {
            average: num(attendanceTotals.average),
            studentsWithRecords: Number(attendanceTotals.students_with_records || 0),
            below75: Number(belowThreshold[0].total || 0)
        },
        academics: {
            withResult,
            passed: Number(resultTotals.passed || 0),
            distinction: Number(resultTotals.distinction || 0),
            averageCgpa: num(resultTotals.average_cgpa),
            passRate: withResult > 0
                ? Number(((Number(resultTotals.passed || 0) / withResult) * 100).toFixed(1))
                : null
        }
    };
};

// ==========================================================================
// 2. STUDENTS LIST  -  GET /api/admin/students
// ==========================================================================
/*
 * The Students screen renders regNo, name, program, batch and status. It has
 * never shown a fee figure or an attendance percentage, so this endpoint does
 * not load any — it is the base projection and the filter lists, nothing else.
 */
const getStudentsPage = async (queryParams) => {
    const { rows, total, page } = await studentPage(queryParams);
    const options = await filterOptions();

    return {
        ...envelope(rows.map(baseStudentShape), total, page),
        options
    };
};

// ==========================================================================
// 2b. STUDENTS EXPORT  -  GET /api/admin/students/export
// ==========================================================================
/*
 * Every student matching the current filters, for the CSV / PDF / ID-card
 * exports — not just the page on screen.
 *
 * This is the one place in the admin portal that deliberately returns bulk
 * data, and it does so only when someone clicks Export. That is the difference
 * that matters: the old design paid this cost on every sign-in, for everyone,
 * whether or not they ever opened the Students screen.
 *
 * It reuses the same filter builder as the list, so an export always contains
 * exactly the rows the screen was showing — narrowed by programme, batch,
 * status or search text — rather than the whole table regardless.
 */
const EXPORT_HARD_LIMIT = 10000;

const exportStudents = async (queryParams) => {
    const where = studentFilters(queryParams);

    const rows = await select(
        `${STUDENT_BASE_SELECT}
          WHERE ${where.sql}
          ORDER BY s.student_id
          LIMIT :limit`,
        { ...where.replacements, limit: EXPORT_HARD_LIMIT }
    );

    // The export sheet carries the contact column the on-screen table omits,
    // because a printed list is used to reach people.
    const withEmail = rows.length
        ? await select(
            `SELECT user_id, email FROM users WHERE user_id IN (:ids)`,
            { ids: rows.map((r) => r.user_id).filter(Boolean) }
        )
        : [];

    const emailByUser = new Map(withEmail.map((u) => [u.user_id, u.email]));

    /*
     * Attendance, fee position and academic standing — the columns the REPORTS
     * are about.
     *
     * This endpoint returned identity fields only, and it is what every PDF on
     * the Reports screen is built from. So the Attendance Report read
     * `s.attendance` on rows that had no such key, scored every student 0%, and
     * printed "Overall Attendance: 0.0%" above a table listing all 2,003
     * students as below the 75% threshold. The Fee Report totalled `s.paidAmount`
     * and reported Rs 0 collected. The Examination and AI reports failed the
     * same way. Four of the six reports were confidently reporting zeroes.
     *
     * The four helpers below are the same ones the on-screen Attendance, Fee and
     * Examination pages use, so a report and the screen it corresponds to cannot
     * disagree.
     */
    const ids = rows.map((r) => r.student_id);
    const [attendance, fees, results, marks] = await Promise.all([
        attendanceFor(ids),
        feesFor(ids),
        resultsFor(ids),
        marksFor(ids)
    ]);

    return {
        rows: rows.map((r) => {
            const att = attendance.get(r.student_id);
            const fee = fees.get(r.student_id);
            const res = results.get(r.student_id);
            const mark = marks.get(r.student_id);

            return {
                ...baseStudentShape(r),
                email: emailByUser.get(r.user_id) || null,

                // Attendance. Null means "no register has ever been marked for
                // this student" — which is NOT 0% attendance, and the report
                // must not average it in as though it were.
                attendance: num(att?.percentage),
                // `attended` folds late marks in with present, matching the
                // percentage above; `total_sessions` is the denominator.
                attendanceAttended: att ? Number(att.attended) : 0,
                attendanceSessions: att ? Number(att.total_sessions) : 0,

                // Fee position, summed over every live voucher.
                feeStatus: fee?.status || null,
                feeAmount: num(fee?.total_payable),
                paidAmount: num(fee?.amount_paid),
                remainingBalance: num(fee?.remaining_balance),
                feeDueDate: fee?.due_date || null,

                // Academic standing.
                cgpa: num(res?.cgpa),
                gpa: num(res?.gpa),
                resultStatus: res?.status || null,
                examScore: num(mark?.percentage),
                examSittings: mark ? Number(mark.sittings) : 0
            };
        }),
        count: rows.length,
        truncated: rows.length === EXPORT_HARD_LIMIT
    };
};

// ==========================================================================
// 3. STUDENT PROFILE  -  GET /api/admin/students/:id
// ==========================================================================
/*
 * Everything one student's profile shows, for exactly one student: identity,
 * contact, guardian, fee position, attendance and academic standing.
 *
 * Opening a profile used to be free only because the portal had already paid
 * 3 MB to load every student at sign-in. Loading one student costs one student.
 */
const getStudentProfile = async (studentId) => {
    const rows = await select(
        `${STUDENT_BASE_SELECT} WHERE s.student_id = :id AND s.is_deleted = 0`,
        { id: studentId }
    );

    if (!rows.length) return null;

    const row = rows[0];
    const ids = [row.student_id];

    const [
        att, fee, result, mark, guardian, ladder, [account], documents, enrolled
    ] = await Promise.all([
        attendanceFor(ids),
        feesFor(ids),
        resultsFor(ids),
        marksFor(ids),
        guardiansFor(ids),
        grades(),
        row.user_id
            ? select(
                `SELECT email, profile_picture, is_active, last_login
                   FROM users WHERE user_id = :userId`,
                { userId: row.user_id }
            )
            : Promise.resolve([{}]),
        select(
            `SELECT document_id, document_type, file_path, uploaded_at
               FROM student_documents WHERE student_id = :id
              ORDER BY uploaded_at DESC LIMIT 20`,
            { id: studentId }
        ).catch(() => []),
        /*
         * The courses this student is actually registered for, each with the
         * marks they have earned in it.
         *
         * Reads `enrollments` rather than the section timetable: a section's
         * timetable includes subjects a given student is not taking, and a
         * course list built from attendance rows silently drops any course
         * nobody has marked a register for yet.
         *
         * The per-subject score is joined here because the profile's course
         * table has columns for it. That table was previously fed by a field
         * the loader hardcoded to [], so it rendered empty for every student
         * in the institute.
         */
        select(
            `SELECT e.enrollment_id, e.status, e.semester_id,
                    sub.subject_id, sub.subject_code, sub.subject_name, sub.credit_hours,
                    m.obtained, m.total, m.sittings,
                    ROUND(m.obtained / NULLIF(m.total, 0) * 100, 1) AS percentage
               FROM enrollments e
               JOIN subjects sub ON sub.subject_id = e.subject_id
               LEFT JOIN (
                     SELECT ex.subject_id,
                            SUM(mk.obtained_marks) AS obtained,
                            SUM(ex.total_marks)    AS total,
                            COUNT(*)               AS sittings
                       FROM marks mk
                       JOIN exams ex ON ex.exam_id = mk.exam_id
                      WHERE mk.student_id = :id AND ex.total_marks > 0
                      GROUP BY ex.subject_id
               ) m ON m.subject_id = sub.subject_id
              WHERE e.student_id = :id AND sub.is_deleted = 0
              ORDER BY e.semester_id DESC, sub.subject_code`,
            { id: studentId }
        )
    ]);

    const a = att.get(row.student_id);
    const f = fee.get(row.student_id);
    const r = result.get(row.student_id);
    const m = mark.get(row.student_id);
    const g = guardian.get(row.student_id);

    // The three student columns the list screens do not select.
    const [extra] = await select(
        `SELECT dob, cnic_bform, address, nationality, blood_group, created_at
           FROM students WHERE student_id = :id`,
        { id: studentId }
    );

    return {
        ...baseStudentShape(row),

        email: account?.email || null,
        profilePicture: account?.profile_picture || null,
        accountActive: account ? !!account.is_active : null,
        lastLogin: account?.last_login || null,

        dob: extra?.dob || null,
        cnic: extra?.cnic_bform || null,
        address: extra?.address || null,
        nationality: extra?.nationality || null,
        bloodGroup: extra?.blood_group || null,
        enrolledAt: extra?.created_at || null,

        attendance: a?.percentage != null ? `${num(a.percentage)}%` : null,
        attendancePercent: num(a?.percentage),
        presentDays: a ? Number(a.attended) : null,
        absentDays: a ? Number(a.absent_count) : null,
        totalClasses: a ? Number(a.total_sessions) : null,

        feeStatus: f?.status || null,
        feeAmount: num(f?.total_payable),
        paidAmount: num(f?.amount_paid),
        remainingBalance: num(f?.remaining_balance),
        dueDate: f?.due_date || null,
        voucherCount: f ? Number(f.voucher_count) : 0,

        cgpa: num(r?.cgpa),
        gpa: num(r?.gpa),
        resultStatus: r?.status || null,

        examScore: num(m?.percentage),
        examGrade: letterFor(ladder, m?.percentage),
        examSittings: m ? Number(m.sittings) : 0,

        guardianName: g?.name || null,
        guardianPhone: g?.phone || null,
        guardianRelationship: g?.relationship || null,
        guardianOccupation: g?.occupation || null,
        parentId: g?.parent_id ?? null,

        documents,
        enrolledCourses: enrolled.map((e) => ({
            enrollmentId: e.enrollment_id,
            subjectId: e.subject_id,
            code: e.subject_code,
            name: e.subject_name,
            creditHours: e.credit_hours,
            semesterId: e.semester_id,
            status: e.status,
            // null, not 0, when the student has not been marked in this
            // subject yet — the screen renders that as a dash.
            score: num(e.percentage),
            obtained: num(e.obtained),
            totalMarks: num(e.total),
            sittings: e.sittings ? Number(e.sittings) : 0,
            grade: letterFor(ladder, e.percentage)
        }))
    };
};

// ==========================================================================
// 4. ATTENDANCE  -  GET /api/admin/attendance
// ==========================================================================
/*
 * One attendance figure per student for the current page, plus institute-wide
 * bucket counts so the summary cards do not depend on the page being shown.
 *
 * `?risk=low` narrows the list to students under the 75% threshold, which the
 * screen previously did by filtering all 2,013 students in the browser.
 */
const getAttendancePage = async (queryParams) => {
    const where = studentFilters(queryParams);
    const page = paging(queryParams);

    /*
     * ONE MONTH, OR ALL OF THEM.
     *
     * The screen has always had a "Select Month" dropdown. It set a piece of
     * React state that outlined a bar in the chart and was sent nowhere — the
     * KPI tiles and the roster below it never changed, so a control that looks
     * like a filter silently filtered nothing. `period` is that control, wired.
     *
     * Format is YYYY-MM and it is validated as such before it reaches SQL; it
     * is bound as a replacement either way.
     */
    const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(queryParams.period || ""))
        ? String(queryParams.period)
        : null;

    /*
     * Per-student attendance, computed from `attendance` rather than read from
     * vw_student_attendance_summary.
     *
     * The view is exactly `attendance` minus Holidays, grouped by student and
     * subject — verified against the live database, 60,081 non-holiday rows and
     * 2,000 students either way. But it has already discarded `att_date`, so
     * nothing built on it can answer "in March". Aggregating the base table
     * instead keeps every existing figure identical and makes the month filter
     * possible at all.
     *
     * Holidays stay excluded: a holiday is not a session anyone could attend.
     */
    /*
     * EVERY STATUS IS RETURNED, NOT JUST THE TWO THE OLD TABLE SHOWED.
     *
     * `attended` is Present + Late, which is the right basis for the 75% rule —
     * a student who turned up late was there. But the screen then printed that
     * combined figure under a column headed "Present Days", so 3,987 Late marks
     * silently became Present, and 1,517 Leave marks appeared nowhere at all.
     * The arithmetic on screen could not be checked as a result: Sessions was
     * 60,078 while Present + Absent came to 54,574, and nothing accounted for
     * the missing 5,504.
     *
     * Present, Late, Absent and Leave are now each returned in their own right,
     * so the row adds up and the rule keeps using the right numerator.
     */
    const perStudent = `
        SELECT student_id,
               COUNT(*)                                   AS total_sessions,
               SUM(status IN ('Present','Late'))           AS attended,
               SUM(status = 'Present')                     AS present_count,
               SUM(status = 'Late')                        AS late_count,
               SUM(status = 'Absent')                      AS absent_count,
               SUM(status = 'Leave')                       AS leave_count,
               ROUND(100 * SUM(status IN ('Present','Late'))
                         / NULLIF(COUNT(*), 0), 1)         AS percentage
          FROM attendance
         WHERE status <> 'Holiday'
           ${period ? "AND DATE_FORMAT(att_date, '%Y-%m') = :period" : ""}
         GROUP BY student_id
    `;

    const periodBinding = period ? { period } : {};

    /*
     * The risk filter, including the cohort that had no filter at all.
     *
     * `untracked` is students with NO attendance record — 3 of them today, and
     * they were the reason the roster showed blank cells beside a green
     * "Regular (>=75%)" badge: parseFloat(null) is NaN, and NaN < 75 is false,
     * so a student nobody had ever marked was being reported as meeting the
     * requirement. They are now a cohort you can ask for by name.
     */
    const riskClause = queryParams.risk === "low"
        ? "HAVING percentage IS NOT NULL AND percentage < 75"
        : queryParams.risk === "good"
            ? "HAVING percentage >= 90"
            : queryParams.risk === "untracked"
                ? "HAVING percentage IS NULL"
                : "";

    const joined = `
        FROM students s
        LEFT JOIN programs p ON p.program_id = s.program_id
        LEFT JOIN batches  b ON b.batch_id   = s.batch_id
        LEFT JOIN ( ${perStudent} ) a ON a.student_id = s.student_id
        WHERE ${where.sql}
    `;

    /*
     * Column sorting, whitelisted.
     *
     * The roster is paged in SQL, so sorting it in the browser would only ever
     * reorder the ten rows already on screen — "sort by lowest attendance" has
     * to reach the database or it is a lie about the other 1,993 students. The
     * key is matched against this map and never interpolated from raw input;
     * an unknown key falls back to student_id.
     *
     * NULLs are pinned last in both directions on purpose: an untracked student
     * is not the lowest attendance in the institute, they are an absence of
     * data, and floating them to the top of an ascending sort would put them
     * where the worst offenders belong.
     */
    const SORTABLE = {
        regNo: "s.registration_number",
        name: "CONCAT(s.first_name, ' ', s.last_name)",
        program: "p.program_name",
        sessions: "a.total_sessions",
        present: "a.present_count",
        late: "a.late_count",
        absent: "a.absent_count",
        leave: "a.leave_count",
        attendance: "a.percentage"
    };

    const dir = String(queryParams.dir).toLowerCase() === "desc" ? "DESC" : "ASC";
    const sortColumn = SORTABLE[queryParams.sort];
    const orderBy = sortColumn
        ? `${sortColumn} IS NULL, ${sortColumn} ${dir}, s.student_id ASC`
        : "s.student_id ASC";

    const counted = riskClause
        ? `SELECT COUNT(*) AS total FROM (
               SELECT s.student_id, a.percentage ${joined} ${riskClause}
           ) filtered`
        : `SELECT COUNT(*) AS total FROM students s WHERE ${where.sql}`;

    const [[{ total }], rows, [buckets], monthlyTrend] = await Promise.all([
        select(counted, { ...where.replacements, ...periodBinding }),
        select(
            `SELECT s.student_id, s.user_id, s.registration_number, s.first_name, s.last_name,
                    s.academic_status, p.program_name, b.batch_name,
                    a.total_sessions, a.attended, a.present_count, a.late_count,
                    a.absent_count, a.leave_count, a.percentage
             ${joined}
             ${riskClause}
             ORDER BY ${orderBy}
             LIMIT :limit OFFSET :offset`,
            { ...where.replacements, ...periodBinding, limit: page.limit, offset: page.offset }
        ),
        /*
         * Institute-wide, independent of the page, so the cards report the real
         * position rather than the visible slice. It does follow `period`, because
         * a month-filtered screen whose headline rate still describes all time is
         * two different answers to one question.
         *
         * `untracked` is counted here rather than derived on the client: it is
         * every live student who is NOT in the aggregate — no record at all when
         * no month is chosen, and no record IN THAT MONTH when one is. The join
         * is the only place both sides of that subtraction exist.
         */
        select(
            `SELECT COUNT(*)                                 AS roll,
                    SUM(pct IS NOT NULL)                     AS tracked,
                    SUM(pct IS NULL)                         AS untracked,
                    SUM(pct >= 90)                           AS excellent,
                    SUM(pct >= 75 AND pct < 90)              AS satisfactory,
                    SUM(pct < 75)                            AS at_risk,
                    ROUND(AVG(pct), 1)                       AS average
               FROM (
                     SELECT s.student_id, a.percentage AS pct
                       FROM students s
                       LEFT JOIN ( ${perStudent} ) a ON a.student_id = s.student_id
                      WHERE s.is_deleted = 0
                    ) per_student`,
            periodBinding
        ),
        /*
         * The real month-by-month attendance rate, from the `att_date` column
         * on the 60,216 attendance rows.
         *
         * The screen previously drew a twelve-month chart from a hardcoded
         * array of invented percentages — "Apr 72.5%", "Dec 71.0%" and so on —
         * with only the current month wired to anything real. Every other bar
         * described a month that had not been measured.
         *
         * Holidays are excluded: a holiday is not a session anyone could
         * attend, so counting it would drag every month's rate down.
         */
        select(
            `SELECT DATE_FORMAT(att_date, '%Y-%m') AS period,
                    COUNT(*)                                         AS total_sessions,
                    SUM(status IN ('Present','Late'))                 AS attended,
                    SUM(status = 'Absent')                            AS absent,
                    ROUND(100 * SUM(status IN ('Present','Late'))
                              / NULLIF(COUNT(*), 0), 1)               AS percentage
               FROM attendance
              WHERE att_date IS NOT NULL AND status <> 'Holiday'
              GROUP BY period
              ORDER BY period`
        )
    ]);

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    return {
        ...envelope(
            rows.map((r) => ({
                id: r.student_id,
                // The LOGIN id, not the student id. It is the only key
                // /api/users/:id/avatar accepts, and without it every roster in
                // the admin portal drew initials even for people who had
                // uploaded a photograph.
                userId: r.user_id ?? null,
                regNo: r.registration_number,
                name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
                status: r.academic_status,
                program: r.program_name || null,
                batch: r.batch_name || null,
                attendance: r.percentage != null ? `${num(r.percentage)}%` : null,
                attendancePercent: num(r.percentage),

                // Each status in its own right, so Present + Late + Absent +
                // Leave reconciles against totalClasses on screen.
                presentDays: r.present_count != null ? Number(r.present_count) : null,
                lateDays: r.late_count != null ? Number(r.late_count) : null,
                absentDays: r.absent_count != null ? Number(r.absent_count) : null,
                leaveDays: r.leave_count != null ? Number(r.leave_count) : null,

                // Present + Late — the numerator the 75% rule is computed from.
                attendedDays: r.attended != null ? Number(r.attended) : null,
                totalClasses: r.total_sessions != null ? Number(r.total_sessions) : null
            })),
            Number(total),
            page
        ),
        summary: {
            // Every live student, so `tracked + untracked` accounts for the whole
            // roll and the screen never has to guess at its own denominator.
            roll: Number(buckets.roll || 0),
            tracked: Number(buckets.tracked || 0),
            untracked: Number(buckets.untracked || 0),
            excellent: Number(buckets.excellent || 0),
            satisfactory: Number(buckets.satisfactory || 0),
            atRisk: Number(buckets.at_risk || 0),
            average: num(buckets.average)
        },

        // Which month the figures above describe, echoed back so the screen can
        // label them rather than assume the request it sent was honoured.
        period,
        monthlyTrend: monthlyTrend.map((m) => {
            const [year, month] = String(m.period).split("-");
            return {
                key: m.period,
                month: MONTHS[Number(month) - 1],
                year,
                label: `${MONTHS[Number(month) - 1]} ${year}`,
                totalSessions: Number(m.total_sessions || 0),
                attended: Number(m.attended || 0),
                absent: Number(m.absent || 0),
                presentPct: num(m.percentage),
                absentPct: m.percentage != null
                    ? Number((100 - Number(m.percentage)).toFixed(1))
                    : null
            };
        }),
        options: await filterOptions()
    };
};

// ==========================================================================
// 5. FEE MANAGEMENT  -  GET /api/admin/fees
// ==========================================================================
/*
 * The fee table for one page of students, plus the two charts and the totals.
 *
 * The charts come from `fee_structures` grouped by category and `fee_payments`
 * grouped by month — both aggregated in SQL. The screen used to download all
 * 1,909 payment rows and group them in the browser.
 */
const getFeesPage = async (queryParams) => {
    const where = studentFilters(queryParams);
    const page = paging(queryParams);

    const STATUS_FILTER = ["Paid", "Partial", "Unpaid", "Overdue"];
    const statusClause = STATUS_FILTER.includes(queryParams.fee_status)
        ? "HAVING status = :fee_status"
        : "";
    if (statusClause) where.replacements.fee_status = queryParams.fee_status;

    const joined = `
        FROM students s
        LEFT JOIN programs  p   ON p.program_id   = s.program_id
        LEFT JOIN batches   b   ON b.batch_id     = s.batch_id
        LEFT JOIN semesters sem ON sem.semester_id = ${effectiveSemesterId("s")}
        LEFT JOIN (
              SELECT student_id,
                     SUM(total_payable)     AS total_payable,
                     SUM(amount_paid)       AS amount_paid,
                     SUM(remaining_balance) AS remaining_balance,
                     MIN(CASE WHEN status IN ('Unpaid','Partial','Overdue')
                              THEN due_date END) AS due_date,
                     CASE MAX(CASE status WHEN 'Overdue' THEN 5 WHEN 'Unpaid' THEN 4
                                          WHEN 'Partial' THEN 3 ELSE 2 END)
                          WHEN 5 THEN 'Overdue' WHEN 4 THEN 'Unpaid'
                          WHEN 3 THEN 'Partial' ELSE 'Paid' END AS status
                FROM fee_vouchers
               WHERE status <> 'Cancelled'
               GROUP BY student_id
        ) f ON f.student_id = s.student_id
        WHERE ${where.sql}
    `;

    /*
     * The headline figures describe the SAME cohort the roster below them does.
     *
     * They used to be three unfiltered aggregates over the whole institute, so
     * narrowing the roster to one programme left "Rs 187,637,160 billed / 827
     * paid" sitting above 408 students — the tiles and the table were answering
     * different questions while looking like one screen.
     *
     * The cohort filters (search, programme, batch, section, semester,
     * department) are pushed into all three. `fee_status` deliberately is NOT:
     * it is a lens onto the cohort, and applying it would collapse the status
     * chips below into a single non-zero bucket that merely restates the filter.
     */
    const cohort = {
        sql: where.sql,
        // `fee_status` belongs to the HAVING on the roster, not to these.
        replacements: Object.fromEntries(
            Object.entries(where.replacements).filter(([k]) => k !== "fee_status")
        )
    };

    /*
     * The fee schedule is the published price list (`fee_structures`), not money
     * billed — every voucher in this database points at the one Tuition Fee
     * structure, so a pie of billed-by-category would be a single 100% slice.
     * It carries programme and semester and nothing finer, so those are the two
     * filters it can honour; the caption on screen says what it is.
     */
    const scheduleClauses = [];
    const scheduleReplacements = {};
    for (const [param, column] of [
        ["program_id", "program_id"],
        ["semester_id", "semester_id"]
    ]) {
        const value = Number.parseInt(queryParams[param], 10);
        if (Number.isInteger(value)) {
            scheduleClauses.push(`${column} = :${param}`);
            scheduleReplacements[param] = value;
        }
    }
    const scheduleWhere = scheduleClauses.length
        ? `WHERE ${scheduleClauses.join(" AND ")}`
        : "";

    const [[{ total }], rows, [totals], distribution, monthly] = await Promise.all([
        select(
            statusClause
                ? `SELECT COUNT(*) AS total FROM (
                       SELECT s.student_id, f.status ${joined} ${statusClause}
                   ) filtered`
                : `SELECT COUNT(*) AS total FROM students s WHERE ${where.sql}`,
            where.replacements
        ),
        select(
            `SELECT s.student_id, s.user_id, s.registration_number, s.first_name, s.last_name,
                    p.program_name, b.batch_name, sem.semester_number,
                    f.total_payable, f.amount_paid, f.remaining_balance,
                    f.due_date, f.status
             ${joined}
             ${statusClause}
             ORDER BY ${queryParams.sort === "due" ? "f.remaining_balance DESC" : "s.student_id"}
             LIMIT :limit OFFSET :offset`,
            { ...where.replacements, limit: page.limit, offset: page.offset }
        ),
        /*
         * One voucher-level roll-up per student, then counted — a student is
         * "Overdue" once, however many vouchers they hold. The status ladder
         * matches the one the roster derives above, so a chip and a row can
         * never disagree about the same person.
         */
        select(
            `SELECT SUM(v.total_payable)                     AS billed,
                    SUM(v.amount_paid)                       AS collected,
                    SUM(v.remaining_balance)                 AS outstanding,
                    COUNT(*)                                 AS students_billed,
                    SUM(v.status = 'Paid')                   AS paid,
                    SUM(v.status = 'Partial')                AS partial,
                    SUM(v.status = 'Unpaid')                 AS unpaid,
                    SUM(v.status = 'Overdue')                AS overdue
               FROM (
                     SELECT fv.student_id,
                            SUM(fv.total_payable)     AS total_payable,
                            SUM(fv.amount_paid)       AS amount_paid,
                            SUM(fv.remaining_balance) AS remaining_balance,
                            CASE MAX(CASE fv.status WHEN 'Overdue' THEN 5 WHEN 'Unpaid' THEN 4
                                                    WHEN 'Partial' THEN 3 ELSE 2 END)
                                 WHEN 5 THEN 'Overdue' WHEN 4 THEN 'Unpaid'
                                 WHEN 3 THEN 'Partial' ELSE 'Paid' END AS status
                       FROM fee_vouchers fv
                       JOIN students s ON s.student_id = fv.student_id
                      WHERE fv.status <> 'Cancelled' AND ${cohort.sql}
                      GROUP BY fv.student_id
                    ) v`,
            cohort.replacements
        ),
        select(
            `SELECT fee_category AS category, SUM(amount) AS amount
               FROM fee_structures
              ${scheduleWhere}
              GROUP BY fee_category
              ORDER BY amount DESC`,
            scheduleReplacements
        ),
        // Verified money only. A declared-but-unverified payment has not been
        // collected, and counting it would overstate the collection chart.
        // Scoped to the cohort through the voucher each payment settles.
        select(
            `SELECT DATE_FORMAT(fp.payment_date, '%Y-%m') AS period,
                    SUM(fp.amount_paid)                   AS collected,
                    COUNT(*)                              AS payments
               FROM fee_payments fp
               JOIN fee_vouchers fv ON fv.fee_voucher_id = fp.fee_voucher_id
               JOIN students s      ON s.student_id      = fv.student_id
              WHERE fp.status = 'Verified' AND fp.payment_date IS NOT NULL
                AND ${cohort.sql}
              GROUP BY period
              ORDER BY period`,
            cohort.replacements
        )
    ]);

    const distributionTotal = distribution.reduce((sum, d) => sum + Number(d.amount || 0), 0);

    return {
        ...envelope(
            rows.map((r) => ({
                id: r.student_id,
                // The LOGIN id, not the student id. It is the only key
                // /api/users/:id/avatar accepts, and without it every roster in
                // the admin portal drew initials even for people who had
                // uploaded a photograph.
                userId: r.user_id ?? null,
                regNo: r.registration_number,
                name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
                program: r.program_name || null,
                batch: r.batch_name || null,
                semester: r.semester_number ? `Semester ${r.semester_number}` : null,
                feeStatus: r.status || null,
                feeAmount: num(r.total_payable),
                paidAmount: num(r.amount_paid),
                remainingBalance: num(r.remaining_balance),
                dueDate: r.due_date || null
            })),
            Number(total),
            page
        ),
        totals: {
            billed: num(totals.billed),
            collected: num(totals.collected),
            outstanding: num(totals.outstanding),
            studentsBilled: Number(totals.students_billed || 0),
            paid: Number(totals.paid || 0),
            partial: Number(totals.partial || 0),
            unpaid: Number(totals.unpaid || 0),
            overdue: Number(totals.overdue || 0)
        },
        distribution: distribution.map((d) => ({
            category: d.category || "Uncategorised",
            amount: Number(d.amount || 0),
            percentage: distributionTotal > 0
                ? Number(((Number(d.amount || 0) / distributionTotal) * 100).toFixed(1))
                : 0
        })),
        monthlyCollection: monthly.map((m) => {
            const [year, month] = String(m.period).split("-");
            const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return {
                key: m.period,
                month: MONTHS[Number(month) - 1],
                label: `${MONTHS[Number(month) - 1]} ${year}`,
                collected: Number(m.collected || 0),
                payments: Number(m.payments || 0)
            };
        }),
        options: await filterOptions()
    };
};

// ==========================================================================
// 6. EXAMINATION  -  GET /api/admin/examination
// ==========================================================================
/*
 * Per-student exam standing for one page, plus the grade distribution and the
 * per-programme aggregates the charts draw — all counted in SQL over the whole
 * institute rather than over whichever page happens to be open.
 */
const getExaminationPage = async (queryParams) => {
    const { rows, total, page } = await studentPage(queryParams);
    const ids = rows.map((r) => r.student_id);

    const [result, mark, ladder, gradeBands, byProgram, upcoming, [totals]] = await Promise.all([
        resultsFor(ids),
        marksFor(ids),
        grades(),
        // Grade distribution over every student with a graded sitting.
        //
        // The band is the highest one whose minimum the score meets — see
        // letterFor() above for why a BETWEEN test drops eight real students
        // into the gaps between the stored ceilings.
        select(
            `SELECT g.grade_letter, g.min_percentage, COUNT(*) AS students
               FROM (
                     SELECT m.student_id,
                            SUM(m.obtained_marks) / NULLIF(SUM(e.total_marks), 0) * 100 AS pct
                       FROM marks m
                       JOIN exams e ON e.exam_id = m.exam_id
                      WHERE e.total_marks > 0
                      GROUP BY m.student_id
                    ) scored
               JOIN grades g
                 ON g.min_percentage = (
                        SELECT MAX(g2.min_percentage) FROM grades g2
                         WHERE scored.pct >= g2.min_percentage
                    )
              GROUP BY g.grade_letter, g.min_percentage
              ORDER BY g.min_percentage DESC`
        ),
        select(
            `SELECT p.program_id, p.program_name,
                    COUNT(DISTINCT s.student_id)                    AS students,
                    ROUND(AVG(newest.cgpa), 2)                      AS average_cgpa,
                    ROUND(100 * SUM(newest.cgpa >= 2.5)
                              / NULLIF(COUNT(newest.cgpa), 0), 1)   AS pass_rate
               FROM students s
               JOIN programs p ON p.program_id = s.program_id
               LEFT JOIN (
                     SELECT r.student_id, r.cgpa
                       FROM results r
                       JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                               FROM results GROUP BY student_id) l
                         ON l.student_id = r.student_id AND l.semester_id = r.semester_id
                    ) newest ON newest.student_id = s.student_id
              WHERE s.is_deleted = 0 AND p.is_deleted = 0
              GROUP BY p.program_id, p.program_name
              ORDER BY p.program_name`
        ),
        select(
            `SELECT e.exam_id, e.exam_name, e.exam_type, e.exam_date, e.total_marks,
                    sub.subject_code, sub.subject_name,
                    (SELECT COUNT(*) FROM marks m WHERE m.exam_id = e.exam_id) AS marks_entered
               FROM exams e
               LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
              ORDER BY e.exam_date DESC
              LIMIT 15`
        ),
        /*
         * The institute-wide exam headline, counted in SQL.
         *
         * These four numbers were previously reduced over the in-memory copy
         * of every student, which meant they described whatever had been
         * loaded. They are also careful about the denominator: a student with
         * no graded sitting is absent from the average rather than averaged in
         * as a zero, and a student whose result has not been published yet is
         * "not assessed", not "failed".
         */
        select(
            `SELECT COUNT(scored.pct)                         AS scored,
                    ROUND(AVG(scored.pct), 1)                 AS average_score,
                    SUM(scored.pct >= 80)                     AS distinction,
                    COUNT(newest.cgpa)                        AS with_cgpa,
                    SUM(newest.cgpa >= 2.5)                   AS passed
               FROM students s
               LEFT JOIN (
                     SELECT m.student_id,
                            SUM(m.obtained_marks) / NULLIF(SUM(e.total_marks), 0) * 100 AS pct
                       FROM marks m
                       JOIN exams e ON e.exam_id = m.exam_id
                      WHERE e.total_marks > 0
                      GROUP BY m.student_id
               ) scored ON scored.student_id = s.student_id
               LEFT JOIN (
                     SELECT r.student_id, r.cgpa
                       FROM results r
                       JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                               FROM results GROUP BY student_id) l
                         ON l.student_id = r.student_id AND l.semester_id = r.semester_id
               ) newest ON newest.student_id = s.student_id
              WHERE s.is_deleted = 0`
        )
    ]);

    const scoredCount = Number(totals.scored || 0);
    const withCgpaCount = Number(totals.with_cgpa || 0);
    const passedCount = Number(totals.passed || 0);
    const distinctionCount = Number(totals.distinction || 0);

    return {
        ...envelope(
            rows.map((r) => {
                const shaped = baseStudentShape(r);
                const res = result.get(r.student_id);
                const m = mark.get(r.student_id);
                return {
                    id: shaped.id,
                    // Already selected by STUDENT_BASE_SELECT; it was simply
                    // dropped on the way out, so this screen had no way to
                    // address a student's picture.
                    userId: shaped.userId ?? null,
                    regNo: shaped.regNo,
                    name: shaped.name,
                    program: shaped.program,
                    programId: shaped.programId,
                    semester: shaped.semester,
                    status: shaped.status,
                    cgpa: num(res?.cgpa),
                    gpa: num(res?.gpa),
                    resultStatus: res?.status || null,
                    examScore: num(m?.percentage),
                    examGrade: letterFor(ladder, m?.percentage),
                    examSittings: m ? Number(m.sittings) : 0
                };
            }),
            total,
            page
        ),
        summary: {
            scored: scoredCount,
            averageScore: num(totals.average_score),
            distinction: distinctionCount,
            distinctionRate: scoredCount
                ? Number(((distinctionCount / scoredCount) * 100).toFixed(1))
                : null,
            withCgpa: withCgpaCount,
            passed: passedCount,
            failed: withCgpaCount - passedCount,
            passRate: withCgpaCount
                ? Number(((passedCount / withCgpaCount) * 100).toFixed(1))
                : null
        },
        gradeDistribution: gradeBands.map((g) => ({
            grade: g.grade_letter,
            students: Number(g.students || 0)
        })),
        byProgram: byProgram.map((p) => ({
            programId: p.program_id,
            program: p.program_name,
            students: Number(p.students || 0),
            avgScore: num(p.average_cgpa),
            passRate: num(p.pass_rate)
        })),
        recentExams: upcoming.map((e) => ({
            examId: e.exam_id,
            name: e.exam_name,
            type: e.exam_type,
            date: e.exam_date,
            totalMarks: e.total_marks,
            subjectCode: e.subject_code,
            subjectName: e.subject_name,
            marksEntered: Number(e.marks_entered || 0)
        })),
        gradingScale: ladder,
        options: await filterOptions()
    };
};

// ==========================================================================
// 7. PARENTS  -  GET /api/admin/parents
// ==========================================================================
/*
 * Parents with their linked children, paginated.
 *
 * GET /api/parents returns all 2,000 parents with every child nested — 695 KB.
 * This returns one page and resolves the children for that page only.
 */
const getParentsPage = async (queryParams) => {
    const page = paging(queryParams);

    const clauses = ["p.is_deleted = 0"];
    const replacements = {};

    /*
     * "Search parent name, student name, or email" — the middle one was never
     * matched, and it is the one an admin most often has: a family calls about
     * their child, and the child's name is what is on the enquiry.
     *
     * The EXISTS walks student_guardians to the children, so a search for
     * "Amna Malik" finds her father's row. Also matches a registration number,
     * because that is what is written on every document the caller is holding.
     */
    if (queryParams.q) {
        clauses.push(
            `(CONCAT(p.first_name, ' ', p.last_name) LIKE :q
              OR p.phone LIKE :q
              OR u.email LIKE :q
              OR p.occupation LIKE :q
              OR EXISTS (SELECT 1 FROM student_guardians sg2
                           JOIN students st2 ON st2.student_id = sg2.student_id
                                            AND st2.is_deleted = 0
                          WHERE sg2.parent_id = p.parent_id
                            AND (CONCAT(st2.first_name, ' ', st2.last_name) LIKE :q
                                 OR st2.registration_number LIKE :q)))`
        );
        replacements.q = `%${queryParams.q}%`;
    }

    const where = clauses.join(" AND ");

    const [[{ total }], rows, [summary]] = await Promise.all([
        select(
            `SELECT COUNT(*) AS total FROM parents p
               LEFT JOIN users u ON u.user_id = p.user_id
              WHERE ${where}`,
            replacements
        ),
        select(
            `SELECT p.parent_id, p.user_id, p.first_name, p.last_name,
                    p.phone, p.occupation, u.email
               FROM parents p
               LEFT JOIN users u ON u.user_id = p.user_id
              WHERE ${where}
              ORDER BY p.parent_id
              LIMIT :limit OFFSET :offset`,
            { ...replacements, limit: page.limit, offset: page.offset }
        ),
        /*
         * The stat tiles above the list, counted over every parent the filter
         * matches rather than over the twenty-five on screen.
         *
         * They used to be reduced in the browser from `rows`, so "Multiple
         * Children: 3" meant "3 of the 25 parents on this page" while the tile
         * beside it read "Total Parents: 2,000". Four tiles in a row, two
         * different denominators, nothing on screen saying so.
         *
         * The guardian link is counted through student_guardians with the same
         * live-student test the children list uses, so a parent whose only ward
         * has been soft-deleted counts as having none in both places.
         */
        select(
            `SELECT COUNT(*)                        AS parents,
                    SUM(c.children > 1)             AS multiple_children,
                    SUM(c.children = 1)             AS single_child,
                    SUM(c.children = 0)             AS no_children,
                    COALESCE(SUM(c.children), 0)    AS linked_children
               FROM parents p
               LEFT JOIN users u ON u.user_id = p.user_id
               JOIN (
                     SELECT p2.parent_id,
                            (SELECT COUNT(*) FROM student_guardians sg
                               JOIN students st ON st.student_id = sg.student_id
                                               AND st.is_deleted = 0
                              WHERE sg.parent_id = p2.parent_id) AS children
                       FROM parents p2
                    ) c ON c.parent_id = p.parent_id
              WHERE ${where}`,
            replacements
        )
    ]);

    const parentIds = rows.map((r) => r.parent_id);

    const children = parentIds.length
        ? await select(
            `SELECT sg.parent_id, sg.relationship,
                    s.student_id, s.user_id, s.registration_number,
                    s.first_name, s.last_name, s.academic_status,
                    pr.program_name
               FROM student_guardians sg
               JOIN students s   ON s.student_id = sg.student_id AND s.is_deleted = 0
               LEFT JOIN programs pr ON pr.program_id = s.program_id
              WHERE sg.parent_id IN (:parentIds)`,
            { parentIds }
        )
        : [];

    const byParent = new Map();
    for (const c of children) {
        const list = byParent.get(c.parent_id) || [];
        list.push({
            id: c.student_id,
            studentId: c.student_id,
            // So a child row on the Parents screen shows the same face the
            // student's own profile does.
            userId: c.user_id ?? null,
            regNo: c.registration_number,
            name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim(),
            status: c.academic_status,
            program: c.program_name || null,
            relationship: c.relationship
        });
        byParent.set(c.parent_id, list);
    }

    return {
        ...envelope(
            rows.map((r) => ({
                id: r.parent_id,
                parentId: r.parent_id,
                userId: r.user_id,
                name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
                // Sent as separate columns as well as joined: the edit form
                // writes first_name and last_name, and splitting the joined
                // name on whitespace mangles anyone with two given names.
                firstName: r.first_name || null,
                lastName: r.last_name || null,
                email: r.email || null,
                phone: r.phone || null,
                occupation: r.occupation || null,
                children: byParent.get(r.parent_id) || [],
                childCount: (byParent.get(r.parent_id) || []).length
            })),
            Number(total),
            page
        ),
        summary: {
            parents: Number(summary?.parents || 0),
            multipleChildren: Number(summary?.multiple_children || 0),
            singleChild: Number(summary?.single_child || 0),
            noChildren: Number(summary?.no_children || 0),
            linkedChildren: Number(summary?.linked_children || 0)
        }
    };
};

// ==========================================================================
// 8. TEACHERS  -  GET /api/admin/teachers
// ==========================================================================
/*
 * The teacher directory with each teacher's real weekly load, joined in SQL.
 *
 * The screen used to call /api/teachers, /api/summaries/teacher-workload and
 * /api/departments separately and join them in the browser.
 */
const getTeachersPage = async (queryParams) => {
    const page = paging(queryParams);

    const clauses = ["t.is_deleted = 0"];
    const replacements = {};

    /*
     * The search box above this list says "Search by name, department, course,
     * or designation…" and matched none of those three but the name.
     *
     * It was also being applied in the browser, over the 50 rows of the current
     * page, so searching for a teacher on page 2 of the directory found nothing
     * and reported "No teachers found" — a result indistinguishable from that
     * teacher not existing. Every field the placeholder names is matched here
     * now, across the whole directory.
     */
    if (queryParams.q) {
        clauses.push(
            `(CONCAT(e.first_name, ' ', e.last_name) LIKE :q
              OR t.specialization LIKE :q
              OR u.email LIKE :q
              OR e.employee_code LIKE :q
              OR e.designation LIKE :q
              OR d.department_name LIKE :q
              OR EXISTS (SELECT 1 FROM teacher_subjects ts2
                           JOIN subjects sub ON sub.subject_id = ts2.subject_id
                          WHERE ts2.teacher_id = t.teacher_id
                            AND (sub.subject_name LIKE :q OR sub.subject_code LIKE :q)))`
        );
        replacements.q = `%${queryParams.q}%`;
    }

    const deptId = Number.parseInt(queryParams.department_id, 10);
    if (Number.isInteger(deptId)) {
        clauses.push("e.department_id = :department_id");
        replacements.department_id = deptId;
    }

    const where = clauses.join(" AND ");

    const joined = `
        FROM teachers t
        LEFT JOIN employees   e ON e.employee_id   = t.employee_id
        LEFT JOIN users       u ON u.user_id       = e.user_id
        LEFT JOIN departments d ON d.department_id = e.department_id
        LEFT JOIN vw_teacher_workload w ON w.teacher_id = t.teacher_id
        WHERE ${where}
    `;

    const [[{ total }], rows, departments, subjectList, lookups] = await Promise.all([
        select(`SELECT COUNT(*) AS total ${joined}`, replacements),
        select(
            `SELECT t.teacher_id, t.specialization, t.employee_id,
                    e.employee_code, e.first_name, e.last_name,
                    e.designation, e.department_id, e.employment_status, e.hire_date,
                    u.user_id, u.email, u.profile_picture,
                    d.department_name,
                    w.weekly_sessions, w.distinct_subjects,
                    w.distinct_sections, w.weekly_contact_hours
             ${joined}
             ORDER BY e.first_name, e.last_name
             LIMIT :limit OFFSET :offset`,
            { ...replacements, limit: page.limit, offset: page.offset }
        ),
        select(
            `SELECT department_id, department_name
               FROM departments WHERE is_deleted = 0 ORDER BY department_name`
        ),
        // The catalogue the "assign classes" picker needs when onboarding a
        // teacher. Small tables (200 subjects, 6 batches, 8 sections), so they
        // ride along with the screen that draws the picker instead of costing
        // three more round trips.
        select(
            `SELECT subject_id, subject_code, subject_name, credit_hours, semester_id
               FROM subjects WHERE is_deleted = 0 ORDER BY subject_code`
        ),
        filterOptions()
    ]);

    const teacherIds = rows.map((r) => r.teacher_id);

    // The subjects each teacher on this page actually teaches.
    const subjects = teacherIds.length
        ? await select(
            `SELECT ts.teacher_id, s.subject_id, s.subject_code, s.subject_name,
                    s.credit_hours
               FROM teacher_subjects ts
               JOIN subjects s ON s.subject_id = ts.subject_id AND s.is_deleted = 0
              WHERE ts.teacher_id IN (:teacherIds)`,
            { teacherIds }
        )
        : [];

    const byTeacher = new Map();
    for (const s of subjects) {
        const list = byTeacher.get(s.teacher_id) || [];
        list.push({
            subjectId: s.subject_id,
            code: s.subject_code,
            name: s.subject_name,
            creditHours: s.credit_hours
        });
        byTeacher.set(s.teacher_id, list);
    }

    return {
        ...envelope(
            rows.map((r) => ({
                id: r.teacher_id,
                teacherId: r.teacher_id,
                employeeId: r.employee_id,
                employeeCode: r.employee_code || null,
                userId: r.user_id ?? null,
                name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || null,
                email: r.email || null,
                profilePicture: r.profile_picture || null,
                designation: r.designation || null,
                specialization: r.specialization || null,
                department: r.department_name || null,
                departmentId: r.department_id ?? null,
                employmentStatus: r.employment_status || null,
                hireDate: r.hire_date || null,
                weeklySessions: r.weekly_sessions != null ? Number(r.weekly_sessions) : 0,
                weeklyContactHours: num(r.weekly_contact_hours) ?? 0,
                subjectCount: r.distinct_subjects != null ? Number(r.distinct_subjects) : 0,
                sectionCount: r.distinct_sections != null ? Number(r.distinct_sections) : 0,
                subjects: byTeacher.get(r.teacher_id) || []
            })),
            Number(total),
            page
        ),
        departments,
        // Everything the class-assignment picker offers.
        subjects: subjectList,
        batches: lookups.batches,
        sections: lookups.sections,
        programs: lookups.programs
    };
};

// ==========================================================================
// 9. AI ANALYTICS  -  GET /api/admin/ai-analytics
// ==========================================================================
/*
 * Risk cohorts, counted institute-wide, plus the named students in each cohort
 * capped at `limit` (default 25).
 *
 * The screen used to derive all of this by scanning the 2,013-student blob. The
 * counts here are the real institute-wide figures, so they no longer change
 * depending on which page of students happens to be loaded.
 */
const getAiAnalytics = async (queryParams) => {
    const limit = Math.min(
        Number.parseInt(queryParams.limit, 10) || 25,
        100
    );

    const riskExpression = `
        SELECT s.student_id,
               s.registration_number,
               CONCAT(s.first_name, ' ', s.last_name) AS name,
               p.program_name,
               sem.semester_number,
               att.pct                                AS attendance_pct,
               newest.cgpa                            AS cgpa,
               scored.pct                             AS exam_pct,
               fee.remaining                          AS remaining_balance,
               (
                   (att.pct IS NOT NULL AND att.pct < 75)
                 + (newest.cgpa IS NOT NULL AND newest.cgpa < 2.5)
                 + (scored.pct IS NOT NULL AND scored.pct < 50)
                 + (fee.remaining IS NOT NULL AND fee.remaining > 0)
               )                                      AS risk_factors
          FROM students s
          LEFT JOIN programs  p   ON p.program_id   = s.program_id
          LEFT JOIN semesters sem ON sem.semester_id = ${effectiveSemesterId("s")}
          LEFT JOIN (
                SELECT student_id,
                       100 * SUM(present_count + late_count)
                           / NULLIF(SUM(total_sessions), 0) AS pct
                  FROM vw_student_attendance_summary
                 GROUP BY student_id
          ) att ON att.student_id = s.student_id
          LEFT JOIN (
                SELECT r.student_id, r.cgpa
                  FROM results r
                  JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                          FROM results GROUP BY student_id) l
                    ON l.student_id = r.student_id AND l.semester_id = r.semester_id
          ) newest ON newest.student_id = s.student_id
          LEFT JOIN (
                SELECT m.student_id,
                       SUM(m.obtained_marks) / NULLIF(SUM(e.total_marks), 0) * 100 AS pct
                  FROM marks m
                  JOIN exams e ON e.exam_id = m.exam_id
                 WHERE e.total_marks > 0
                 GROUP BY m.student_id
          ) scored ON scored.student_id = s.student_id
          LEFT JOIN (
                SELECT student_id, SUM(remaining_balance) AS remaining
                  FROM fee_vouchers WHERE status <> 'Cancelled'
                 GROUP BY student_id
          ) fee ON fee.student_id = s.student_id
         WHERE s.is_deleted = 0
    `;

    /*
     * ONE SCAN FOR BOTH THE TOTALS AND THE PER-PROGRAMME BREAKDOWN
     * ------------------------------------------------------------
     * `riskExpression` is a six-way join with four grouped derived tables over
     * every student in the institute, and it costs about 650ms against the
     * live database. It used to be run FOUR times per request: once for the
     * cohort totals, once for the at-risk list, once grouped by programme, and
     * a fourth time (in the attendance-band query below) to re-derive the
     * per-student attendance aggregate.
     *
     * The four ran inside a Promise.all, which reads as though they overlap.
     * They do not — measured end to end they took 2,532ms, near enough the sum
     * of the individual timings, because the bottleneck is the database doing
     * the same heavy scan four times rather than the API waiting on four idle
     * sockets. Concurrency cannot help when the contended resource is the work
     * itself.
     *
     * The totals and the per-programme rows are now one query. WITH ROLLUP
     * appends the grand total as an extra row, so the aggregate that used to
     * be its own full scan is a byproduct of one that had to run anyway —
     * three scans instead of four, and the figures cannot drift apart because
     * they are now literally computed together.
     *
     * WHY GROUPING() AND NOT `program_name IS NULL`
     * ----------------------------------------------
     * ROLLUP marks its total row with a NULL in the grouped column, and a
     * student attached to no programme would produce a NULL group of its own.
     * Told apart by NULL alone the two would be indistinguishable, and the
     * institute's totals would silently become the orphan group's totals the
     * first time a student was left without a programme. GROUPING() returns 1
     * only for the row ROLLUP synthesised, which is the actual question being
     * asked. There are no such students today; this costs nothing and means
     * there never can be a day when it matters.
     *
     * WHY NOT SELECT THE ROWS ONCE AND AGGREGATE IN JAVASCRIPT
     * --------------------------------------------------------
     * That was tried first and is much worse: returning all 2,004 risk rows
     * over the link takes 11.1 SECONDS, against 650ms to have MySQL reduce
     * them to six. The cost here is shipping wide rows to the API, not the
     * scan, so the aggregation belongs in the database.
     */
    const [byProgramWithTotal, atRisk, attendanceBands, [feeTotals], feeMonthly] = await Promise.all([
        select(
            `SELECT program_name,
                    GROUPING(program_name)      AS is_total,
                    COUNT(*)                    AS students,
                    SUM(risk_factors >= 3)      AS critical,
                    SUM(risk_factors = 2)       AS high,
                    SUM(risk_factors = 1)       AS moderate,
                    SUM(risk_factors = 0)       AS on_track,
                    SUM(attendance_pct < 75)    AS low_attendance,
                    SUM(cgpa < 2.5)             AS low_cgpa,
                    SUM(exam_pct < 50)          AS failing_exams,
                    SUM(remaining_balance > 0)  AS fee_outstanding,
                    SUM(risk_factors >= 2)      AS at_risk,
                    ROUND(AVG(cgpa), 2)         AS average_cgpa,
                    ROUND(AVG(attendance_pct), 1) AS average_attendance
               FROM (${riskExpression}) risk
              GROUP BY program_name WITH ROLLUP`
        ),
        select(
            `SELECT * FROM (${riskExpression}) risk
              WHERE risk_factors >= 2
              ORDER BY risk_factors DESC, attendance_pct ASC
              LIMIT :limit`,
            { limit }
        ),
        select(
            `SELECT CASE WHEN pct >= 90 THEN '90-100'
                         WHEN pct >= 75 THEN '75-89'
                         WHEN pct >= 60 THEN '60-74'
                         ELSE 'Below 60' END AS band,
                    COUNT(*) AS students
               FROM (
                     SELECT student_id,
                            100 * SUM(present_count + late_count)
                                / NULLIF(SUM(total_sessions), 0) AS pct
                       FROM vw_student_attendance_summary
                      GROUP BY student_id
                    ) per_student
              WHERE pct IS NOT NULL
              GROUP BY band
              ORDER BY band DESC`
        ),

        /*
         * THE FEE FIGURES THE AI INSIGHTS SCREEN NEEDS, ANSWERED HERE
         * -----------------------------------------------------------
         * That screen wants exactly two things about money: the institute's
         * collection totals, and how much came in each month. It used to get
         * them by calling GET /api/admin/fees?limit=1 alongside this route.
         *
         * That endpoint is the Fee Management screen's, and it does the Fee
         * Management screen's work: a filtered, paged student roster, a COUNT
         * over the whole cohort, a fee-category distribution, and a
         * filterOptions() call that reads the programme, batch, section and
         * semester tables — awaited AFTER its Promise.all rather than inside
         * it. About 600ms, nearly all of it for rows AI Insights discards;
         * `limit=1` trimmed the roster to a single student and paid for
         * everything else regardless.
         *
         * The two queries below are lifted verbatim from that endpoint with
         * its cohort clause resolved to the unfiltered case — `s.is_deleted =
         * 0`, which is what an unparameterised call to it produced anyway — so
         * the figures are identical and are now cached with the rest of this
         * response instead of being recomputed on every open.
         */
        select(
            `SELECT SUM(v.total_payable)     AS billed,
                    SUM(v.amount_paid)       AS collected,
                    SUM(v.remaining_balance) AS outstanding,
                    COUNT(*)                 AS students_billed,
                    SUM(v.status = 'Paid')    AS paid,
                    SUM(v.status = 'Partial') AS partial,
                    SUM(v.status = 'Unpaid')  AS unpaid,
                    SUM(v.status = 'Overdue') AS overdue
               FROM (
                     SELECT fv.student_id,
                            SUM(fv.total_payable)     AS total_payable,
                            SUM(fv.amount_paid)       AS amount_paid,
                            SUM(fv.remaining_balance) AS remaining_balance,
                            CASE MAX(CASE fv.status WHEN 'Overdue' THEN 5 WHEN 'Unpaid' THEN 4
                                                    WHEN 'Partial' THEN 3 ELSE 2 END)
                                 WHEN 5 THEN 'Overdue' WHEN 4 THEN 'Unpaid'
                                 WHEN 3 THEN 'Partial' ELSE 'Paid' END AS status
                       FROM fee_vouchers fv
                       JOIN students s ON s.student_id = fv.student_id
                      WHERE fv.status <> 'Cancelled' AND s.is_deleted = 0
                      GROUP BY fv.student_id
                    ) v`
        ),

        // Verified money only. A declared-but-unverified payment has not been
        // collected, and counting it would overstate the collection chart.
        select(
            `SELECT DATE_FORMAT(fp.payment_date, '%Y-%m') AS period,
                    SUM(fp.amount_paid)                   AS collected,
                    COUNT(*)                              AS payments
               FROM fee_payments fp
               JOIN fee_vouchers fv ON fv.fee_voucher_id = fp.fee_voucher_id
               JOIN students s      ON s.student_id      = fv.student_id
              WHERE fp.status = 'Verified' AND fp.payment_date IS NOT NULL
                AND s.is_deleted = 0
              GROUP BY period
              ORDER BY period`
        )
    ]);

    /*
     * Split the one result back into the two shapes the response has always
     * had. The ROLLUP row is the institute-wide total; everything else is a
     * programme.
     *
     * `cohorts` falls back to an empty object rather than assuming the total
     * row exists — a GROUP BY over zero students returns the rollup row with
     * COUNT 0 in MySQL, but an empty array here would otherwise throw on the
     * first property read and take the whole screen down over an empty
     * database.
     */
    const cohorts = byProgramWithTotal.find((r) => Number(r.is_total) === 1) || {};

    const byProgram = byProgramWithTotal
        .filter((r) => Number(r.is_total) === 0 && r.program_name !== null)
        .sort((a, b) => String(a.program_name).localeCompare(String(b.program_name)));

    const REASONS = (r) => {
        const reasons = [];
        if (r.attendance_pct != null && Number(r.attendance_pct) < 75) {
            reasons.push(`Attendance ${Number(r.attendance_pct).toFixed(1)}%`);
        }
        if (r.cgpa != null && Number(r.cgpa) < 2.5) {
            reasons.push(`CGPA ${Number(r.cgpa).toFixed(2)}`);
        }
        if (r.exam_pct != null && Number(r.exam_pct) < 50) {
            reasons.push(`Exam average ${Number(r.exam_pct).toFixed(1)}%`);
        }
        if (r.remaining_balance != null && Number(r.remaining_balance) > 0) {
            reasons.push("Fee outstanding");
        }
        return reasons;
    };

    return {
        cohorts: {
            students: Number(cohorts.students || 0),
            critical: Number(cohorts.critical || 0),
            high: Number(cohorts.high || 0),
            moderate: Number(cohorts.moderate || 0),
            onTrack: Number(cohorts.on_track || 0),
            lowAttendance: Number(cohorts.low_attendance || 0),
            lowCgpa: Number(cohorts.low_cgpa || 0),
            failingExams: Number(cohorts.failing_exams || 0),
            feeOutstanding: Number(cohorts.fee_outstanding || 0),
            averageCgpa: num(cohorts.average_cgpa),
            averageAttendance: num(cohorts.average_attendance)
        },
        atRisk: atRisk.map((r) => ({
            id: r.student_id,
            regNo: r.registration_number,
            name: r.name,
            program: r.program_name || null,
            semester: r.semester_number ? `Semester ${r.semester_number}` : null,
            attendance: r.attendance_pct != null ? `${Number(r.attendance_pct).toFixed(1)}%` : null,
            attendancePercent: num(r.attendance_pct),
            cgpa: num(r.cgpa),
            examScore: num(r.exam_pct),
            remainingBalance: num(r.remaining_balance),
            riskFactors: Number(r.risk_factors || 0),
            riskLevel: Number(r.risk_factors) >= 3 ? "Critical" : "High",
            reasons: REASONS(r)
        })),
        byProgram: byProgram.map((p) => ({
            program: p.program_name,
            students: Number(p.students || 0),
            averageCgpa: num(p.average_cgpa),
            averageAttendance: num(p.average_attendance),
            atRisk: Number(p.at_risk || 0)
        })),
        attendanceBands: attendanceBands.map((b) => ({
            band: b.band,
            students: Number(b.students || 0)
        })),

        /*
         * Deliberately the same shape GET /api/admin/fees returns for these
         * two, so the screen reads `feeCollection.totals.collected` where it
         * read `fees.totals.collected` and nothing else about it changes.
         */
        feeCollection: {
            totals: {
                billed: num(feeTotals.billed),
                collected: num(feeTotals.collected),
                outstanding: num(feeTotals.outstanding),
                studentsBilled: Number(feeTotals.students_billed || 0),
                paid: Number(feeTotals.paid || 0),
                partial: Number(feeTotals.partial || 0),
                unpaid: Number(feeTotals.unpaid || 0),
                overdue: Number(feeTotals.overdue || 0)
            },
            monthly: feeMonthly.map((m) => {
                const [year, month] = String(m.period).split("-");
                const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return {
                    key: m.period,
                    month: MONTHS[Number(month) - 1],
                    label: `${MONTHS[Number(month) - 1]} ${year}`,
                    collected: Number(m.collected || 0),
                    payments: Number(m.payments || 0)
                };
            })
        }
    };
};

// ==========================================================================
// 10. REPORTS  -  GET /api/admin/reports
// ==========================================================================
/*
 * The figures the Reports screen prints and exports. All aggregates; no student
 * rows cross the wire, because the screen never lists an individual student.
 */
const getReports = async () => {
    const [
        [enrolment], byProgram, byBatch, [fees], [attendance], [academics], byDepartment
    ] = await Promise.all([
        select(
            `SELECT COUNT(*)                                          AS total,
                    SUM(academic_status = 'Active')                   AS active,
                    SUM(academic_status = 'Graduated')                AS graduated,
                    SUM(academic_status = 'Pending Verification')     AS pending,
                    SUM(academic_status IN ('Suspended','Withdrawn')) AS inactive,
                    SUM(gender = 'Male')                              AS male,
                    SUM(gender = 'Female')                            AS female
               FROM students WHERE is_deleted = 0`
        ),
        select(
            `SELECT p.program_name AS label, COUNT(*) AS students
               FROM students s JOIN programs p ON p.program_id = s.program_id
              WHERE s.is_deleted = 0 AND p.is_deleted = 0
              GROUP BY p.program_name ORDER BY students DESC`
        ),
        select(
            `SELECT b.batch_name AS label, COUNT(*) AS students
               FROM students s JOIN batches b ON b.batch_id = s.batch_id
              WHERE s.is_deleted = 0 AND b.is_deleted = 0
              GROUP BY b.batch_name ORDER BY b.batch_name`
        ),
        select(
            `SELECT SUM(total_payable)     AS billed,
                    SUM(amount_paid)       AS collected,
                    SUM(remaining_balance) AS outstanding,
                    ROUND(100 * SUM(amount_paid)
                              / NULLIF(SUM(total_payable), 0), 1) AS collection_rate
               FROM fee_vouchers WHERE status <> 'Cancelled'`
        ),
        select(
            `SELECT ROUND(AVG(pct), 1)   AS average,
                    SUM(pct < 75)        AS below_threshold,
                    COUNT(*)             AS tracked
               FROM (
                     SELECT student_id,
                            100 * SUM(present_count + late_count)
                                / NULLIF(SUM(total_sessions), 0) AS pct
                       FROM vw_student_attendance_summary GROUP BY student_id
                    ) per_student WHERE pct IS NOT NULL`
        ),
        select(
            `SELECT COUNT(*)            AS with_result,
                    ROUND(AVG(cgpa), 2) AS average_cgpa,
                    SUM(cgpa >= 2.5)    AS passed,
                    SUM(cgpa >= 3.5)    AS distinction
               FROM (
                     SELECT r.cgpa FROM results r
                       JOIN (SELECT student_id, MAX(semester_id) AS semester_id
                               FROM results GROUP BY student_id) l
                         ON l.student_id = r.student_id AND l.semester_id = r.semester_id
                    ) newest`
        ),
        select(
            `SELECT d.department_name AS label,
                    COUNT(DISTINCT t.teacher_id) AS teachers
               FROM teachers t
               LEFT JOIN employees   e ON e.employee_id   = t.employee_id
               LEFT JOIN departments d ON d.department_id = e.department_id
              WHERE t.is_deleted = 0
              GROUP BY d.department_name ORDER BY teachers DESC`
        )
    ]);

    const withResult = Number(academics.with_result || 0);

    return {
        enrolment: {
            total: Number(enrolment.total || 0),
            active: Number(enrolment.active || 0),
            graduated: Number(enrolment.graduated || 0),
            pending: Number(enrolment.pending || 0),
            inactive: Number(enrolment.inactive || 0),
            male: Number(enrolment.male || 0),
            female: Number(enrolment.female || 0),
            byProgram: byProgram.map((r) => ({ label: r.label, students: Number(r.students) })),
            byBatch: byBatch.map((r) => ({ label: r.label, students: Number(r.students) }))
        },
        fees: {
            billed: num(fees.billed),
            collected: num(fees.collected),
            outstanding: num(fees.outstanding),
            collectionRate: num(fees.collection_rate)
        },
        attendance: {
            average: num(attendance.average),
            belowThreshold: Number(attendance.below_threshold || 0),
            tracked: Number(attendance.tracked || 0)
        },
        academics: {
            withResult,
            averageCgpa: num(academics.average_cgpa),
            passed: Number(academics.passed || 0),
            distinction: Number(academics.distinction || 0),
            passRate: withResult > 0
                ? Number(((Number(academics.passed || 0) / withResult) * 100).toFixed(1))
                : null
        },
        faculty: {
            byDepartment: byDepartment.map((r) => ({
                label: r.label || "Unassigned",
                teachers: Number(r.teachers)
            }))
        }
    };
};

// ==========================================================================
// 11. RECENT ACTIVITY  -  GET /api/admin/activity
// ==========================================================================
/*
 * The dashboard's activity feed, built from rows the database actually holds.
 *
 * Two kinds of row, merged and sorted by time:
 *
 *   ACTS   — the audit trail. A named person did a specific thing: a teacher
 *            updated a section's marks, an accounts officer approved a payment,
 *            an admin reissued a password. This is the half the feed exists
 *            for, and the half that did not exist until the write paths across
 *            auth, users, fees, examinations, academics and attendance were
 *            wired to auditService.
 *
 *   EVENTS — announcements published, payments verified, results published,
 *            students enrolled. The state of the institute changing, whether or
 *            not anyone in the portal caused it.
 *
 * The card previously derived "activity" from the student blob, which meant it
 * described the current state rather than anything that happened.
 */
const getActivity = async (queryParams) => {
    const limit = Math.min(Number.parseInt(queryParams.limit, 10) || 10, 50);

    const [announcements, payments, results, enrolments] = await Promise.all([
        select(
            `SELECT announcement_id AS id, title, target_role, created_at
               FROM announcements ORDER BY created_at DESC LIMIT :limit`,
            { limit }
        ),
        select(
            `SELECT fp.fee_payment_id AS id, fp.amount_paid, fp.payment_date,
                    fp.payment_method, fp.receipt_number,
                    CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                    s.student_id
               FROM fee_payments fp
               JOIN fee_vouchers fv ON fv.fee_voucher_id = fp.fee_voucher_id
               JOIN students s      ON s.student_id      = fv.student_id
              WHERE fp.status = 'Verified'
              ORDER BY fp.payment_date DESC, fp.fee_payment_id DESC
              LIMIT :limit`,
            { limit }
        ),
        select(
            `SELECT r.result_id AS id, r.cgpa, r.gpa, r.published_at,
                    CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                    s.student_id
               FROM results r
               JOIN students s ON s.student_id = r.student_id
              WHERE r.status = 'Published' AND r.published_at IS NOT NULL
              ORDER BY r.published_at DESC LIMIT :limit`,
            { limit }
        ),
        select(
            `SELECT s.student_id AS id, s.registration_number, s.created_at,
                    CONCAT(s.first_name, ' ', s.last_name) AS student_name
               FROM students s WHERE s.is_deleted = 0
              ORDER BY s.created_at DESC LIMIT :limit`,
            { limit }
        )
    ]);

    /*
     * The audit trail, merged in.
     *
     * The two halves answer different questions and the feed needs both. The
     * four queries above are SYSTEM EVENTS — a payment cleared, a result went
     * out, a student appeared on the roll — and they are the state of the
     * institute changing. The audit rows are ACTS: a named person did a
     * specific thing at a specific time, which is the half that was missing and
     * the half an administrator actually reads the feed for.
     *
     * Kept as one list rather than two cards because they interleave: the
     * verified payment at 14:02 and the entry saying who approved it are the
     * same moment, and separating them makes the reader join them by eye.
     */
    const auditRows = await audit.list({ limit, page: 1 }).catch(() => ({ rows: [] }));

    const feed = [
        ...auditRows.rows.map((row) => ({
            type: "audit",
            id: `audit-${row.id}`,
            title: row.label,
            /*
             * The actor leads, because "who" is the thing this half adds. A row
             * whose actor could not be named still reads correctly — it just
             * starts with the subject instead.
             */
            message: [
                row.actor?.name || row.actor?.email,
                row.subject
            ].filter(Boolean).join(" · ") || row.entity,
            meta: [
                row.actor?.role,
                row.count ? `${row.count} records` : null
            ].filter(Boolean).join(" · ") || null,
            module: row.module,
            action: row.action,
            at: row.at
        })),
        ...announcements.map((a) => ({
            type: "announcement",
            id: `announcement-${a.id}`,
            title: "Announcement published",
            message: a.title,
            meta: a.target_role ? `To ${a.target_role}` : "To everyone",
            at: a.created_at
        })),
        ...payments.map((p) => ({
            type: "payment",
            id: `payment-${p.id}`,
            title: "Fee payment verified",
            message: `${p.student_name} paid ${Number(p.amount_paid).toLocaleString()}`,
            meta: `${p.payment_method}${p.receipt_number ? ` · ${p.receipt_number}` : ""}`,
            studentId: p.student_id,
            at: p.payment_date
        })),
        ...results.map((r) => ({
            type: "result",
            id: `result-${r.id}`,
            title: "Result published",
            message: `${r.student_name} — GPA ${Number(r.gpa).toFixed(2)}, CGPA ${Number(r.cgpa).toFixed(2)}`,
            meta: null,
            studentId: r.student_id,
            at: r.published_at
        })),
        ...enrolments.map((e) => ({
            type: "enrolment",
            id: `student-${e.id}`,
            title: "Student enrolled",
            message: `${e.student_name} (${e.registration_number})`,
            meta: null,
            studentId: e.id,
            at: e.created_at
        }))
    ]
        .filter((item) => item.at)
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, limit);

    return { activity: feed };
};

// ==========================================================================
// 12. ENROLMENT  -  GET /api/admin/enrollment
// ==========================================================================
/*
 * How many students are in each department, each programme, each batch and each
 * section — in one response, at every level at once.
 *
 * WHY IT IS ONE ENDPOINT AND NOT FOUR
 * -----------------------------------
 * The four questions are the same question asked at four depths, and asking
 * them separately is what makes the numbers disagree. A screen that fetches a
 * department total and a section total in two requests, a minute apart, with an
 * admission in between, shows a department whose sections do not add up to it —
 * and there is no way to tell that from a real data problem. One statement per
 * level, all issued together, means the four levels are always a consistent
 * view of the same instant.
 *
 * WHAT EACH LEVEL COUNTS
 * ----------------------
 * `students` is every student on the books. `active` is those whose
 * academic_status is Active — the distinction matters here more than anywhere
 * else in the portal, because a section holding 121 students of whom 106 are
 * active is a room that needs 106 seats, not 121, and "how many are enrolled"
 * is asked by people ordering chairs and printing papers.
 *
 * `enrolments` is a different thing again and is counted separately: it is
 * course registrations from the `enrollments` table, which is many rows per
 * student. A batch of 206 students carrying 5 subjects each is 1,030 enrolments
 * — the same fact, and not interchangeable with either number above. Screens
 * that conflated the two are why "enrolled students" has read as 10,000 in
 * places when the institute has 2,014.
 */
const getEnrollmentOverview = async (queryParams = {}) => {

    // Narrowing applies to every level at once, so a department chosen at the
    // top filters the sections at the bottom too.
    const clauses = ["s.is_deleted = 0"];
    const replacements = {};

    for (const [param, column] of [
        ["department_id", "p.department_id"],
        ["program_id", "s.program_id"],
        ["batch_id", "s.batch_id"],
        ["section_id", "s.section_id"],
        // Filtering on the effective semester, not the raw column, so a
        // semester chosen at the top of the explorer selects the students the
        // rows below it are counted from. See services/currentSemester.js.
        ["semester_id", effectiveSemesterId("s")]
    ]) {
        const value = Number.parseInt(queryParams[param], 10);
        if (Number.isInteger(value)) {
            clauses.push(`${column} = :${param}`);
            replacements[param] = value;
        }
    }

    const where = clauses.join(" AND ");

    /*
     * `current_semester_id` is NULL for any student nothing has explicitly set
     * it on, which is most of them — the enrollment path never writes it. The
     * explorer groups by this join, so those students were all collected into a
     * single row labelled "No semester" while their enrollments said otherwise.
     * That was Task 7's symptom: the bucket was real, the label was a lie about
     * the students in it.
     */
    const from = `
          FROM students s
          LEFT JOIN programs    p   ON p.program_id    = s.program_id
          LEFT JOIN departments d   ON d.department_id = p.department_id
          LEFT JOIN batches     b   ON b.batch_id      = s.batch_id
          LEFT JOIN sections    sec ON sec.section_id  = s.section_id
          LEFT JOIN semesters   sem ON sem.semester_id = ${effectiveSemesterId("s")}
         WHERE ${where}
    `;

    /**
     * One grouping level.
     *
     * @param columns  the grouped columns, listed once and used for both the
     *                 SELECT list and the GROUP BY. Deriving the GROUP BY from
     *                 the SELECT string instead would break the moment a column
     *                 carried an alias or a function, which is the kind of edit
     *                 nobody expects to change a total.
     */
    const level = (columns) => select(
        `SELECT ${columns.join(", ")},
                COUNT(*) AS students,
                SUM(s.academic_status = 'Active')    AS active,
                SUM(s.academic_status = 'Suspended') AS suspended,
                SUM(s.academic_status = 'Graduated') AS graduated,
                SUM(s.academic_status = 'Withdrawn') AS withdrawn
         ${from}
         GROUP BY ${columns.join(", ")}`,
        replacements
    );

    /*
     * The structure itself, read from its own tables rather than inferred from
     * the students standing in it.
     *
     * `level()` above groups over `students`, so a programme, section or
     * semester that nobody is enrolled in produces NO ROW AT ALL and disappears
     * from the screen. That is how the page came to report 5 programmes while
     * the Dashboard tile — which counts the `programs` table — reported 6, and
     * why a section an admin had just created was invisible until the first
     * student landed in it. An explorer that hides empty containers cannot be
     * used to find them, which is the main reason to open it.
     *
     * So each level is padded from its catalogue: every row the table holds
     * appears, and the ones no student matched are returned with zero counts
     * and `empty: true` for the screen to draw differently.
     *
     * `semesters` is keyed on `is_archived` rather than `is_deleted` — it is
     * the one dimension table that spells the flag differently.
     */
    const catalogue = () => Promise.all([
        select(`SELECT department_id, department_name
                  FROM departments WHERE is_deleted = 0`),
        select(`SELECT program_id, program_name, department_id
                  FROM programs WHERE is_deleted = 0`),
        select(`SELECT batch_id, batch_name, program_id
                  FROM batches WHERE is_deleted = 0`),
        select(`SELECT section_id, section_name, batch_id, capacity
                  FROM sections WHERE is_deleted = 0`),
        select(`SELECT semester_id, semester_number, program_id
                  FROM semesters WHERE is_archived = 0`)
    ]);

    const [
        byDepartment, byProgram, byBatch, bySection, bySemester,
        courseLoad, [totals], subjectCoverage,
        [catDepartments, catPrograms, catBatches, catSections, catSemesters]
    ] = await Promise.all([
            level(["d.department_id", "d.department_name"]),
            level(["p.program_id", "p.program_name", "p.department_id"]),
            level(["b.batch_id", "b.batch_name", "b.program_id"]),
            level(["sec.section_id", "sec.section_name", "sec.batch_id", "sec.capacity"]),
            level(["sem.semester_id", "sem.semester_number", "sem.program_id"]),

            /*
             * Course registrations, counted over the same filtered cohort.
             * Joined through students so a department filter reaches it too —
             * `enrollments` has no department, programme or batch of its own.
             *
             * Active and Dropped are counted SEPARATELY rather than the dropped
             * ones being filtered away in silence. The headline figure has
             * always been Active-only, but the card printed it as though it were
             * every registration in the table, so 9,650 read as the whole of a
             * table holding 10,000. A number that excludes something must say
             * what it excludes.
             */
            select(
                `SELECT COUNT(*)                                      AS total,
                        SUM(e.status = 'Active')                      AS active,
                        SUM(e.status = 'Dropped')                     AS dropped,
                        COUNT(DISTINCT CASE WHEN e.status = 'Active'
                                            THEN e.student_id END)    AS students,
                        COUNT(DISTINCT CASE WHEN e.status = 'Active'
                                            THEN e.subject_id END)    AS subjects
                   FROM enrollments e
                   JOIN students s ON s.student_id = e.student_id
                   LEFT JOIN programs p ON p.program_id = s.program_id
                  WHERE ${where}`,
                replacements
            ),

            select(
                `SELECT COUNT(*) AS students,
                        SUM(s.academic_status = 'Active') AS active,
                        SUM(s.section_id IS NULL)         AS unsectioned
                 ${from}`,
                replacements
            ),

            // How much of the catalogue is actually being taught. 25 of 200
            // subjects carry every registration in this database, and nothing
            // on the screen said so.
            select(`SELECT COUNT(*) AS total FROM subjects WHERE is_deleted = 0`),

            catalogue()
        ]);

    const counts = (r) => ({
        students: Number(r.students || 0),
        active: Number(r.active || 0),
        suspended: Number(r.suspended || 0),
        graduated: Number(r.graduated || 0),
        withdrawn: Number(r.withdrawn || 0)
    });

    // A student whose programme, batch or section is NULL still exists and is
    // still counted; the row is labelled rather than dropped, because dropping
    // it is how a total stops matching the sum of its parts.
    const named = (id, name, fallback) => ({
        id: id ?? null,
        name: name || fallback
    });

    // Zeroes, for a catalogue row no student matched.
    const NONE = {
        students: 0, active: 0, suspended: 0, graduated: 0, withdrawn: 0
    };

    /**
     * Merge one level's student-derived counts with its catalogue.
     *
     * Rows the students produced come first and keep their real counts; every
     * remaining catalogue row is appended at zero and flagged `empty`. The
     * unmatched-parent row (`id: null` — "No department", "No semester") is
     * always student-derived, so it survives untouched.
     *
     * @param rows     already-shaped rows from level(), each with an `id`
     * @param cat      catalogue rows from the dimension's own table
     * @param shape    turns one catalogue row into the same shape at zero
     */
    const withEmpties = (rows, cat, shape) => {
        const seen = new Set(rows.map((r) => r.id).filter((id) => id != null));
        return rows
            .map((r) => ({ ...r, empty: false }))
            .concat(
                cat.filter((c) => !seen.has(shape(c).id))
                    .map((c) => ({ ...shape(c), ...NONE, empty: true }))
            );
    };

    // Populated levels first and biggest-first within them, so padding the tail
    // with empties never pushes a real row down the table.
    const byStudents = (a, b) => b.students - a.students;

    const sections = withEmpties(
        bySection.map((r) => ({
            ...named(r.section_id, r.section_name, "Unplaced"),
            batchId: r.batch_id ?? null,
            capacity: r.capacity != null ? Number(r.capacity) : null,
            ...counts(r)
        })),
        catSections,
        (c) => ({
            id: c.section_id,
            name: c.section_name,
            batchId: c.batch_id ?? null,
            capacity: c.capacity != null ? Number(c.capacity) : null
        })
    ).sort(byStudents);

    const semesters = withEmpties(
        bySemester.map((r) => ({
            id: r.semester_id ?? null,
            name: r.semester_number ? `Semester ${r.semester_number}` : "No semester",
            number: r.semester_number != null ? Number(r.semester_number) : null,
            programId: r.program_id ?? null,
            ...counts(r)
        })),
        catSemesters,
        (c) => ({
            id: c.semester_id,
            name: c.semester_number ? `Semester ${c.semester_number}` : "No semester",
            number: c.semester_number != null ? Number(c.semester_number) : null,
            programId: c.program_id ?? null
        })
    ).sort((a, b) => (b.students - a.students) || ((a.number ?? 99) - (b.number ?? 99)));

    const departments = withEmpties(
        byDepartment.map((r) => ({
            ...named(r.department_id, r.department_name, "No department"),
            ...counts(r)
        })),
        catDepartments,
        (c) => ({ id: c.department_id, name: c.department_name })
    ).sort(byStudents);

    const programs = withEmpties(
        byProgram.map((r) => ({
            ...named(r.program_id, r.program_name, "No programme"),
            departmentId: r.department_id ?? null,
            ...counts(r)
        })),
        catPrograms,
        (c) => ({
            id: c.program_id,
            name: c.program_name,
            departmentId: c.department_id ?? null
        })
    ).sort(byStudents);

    const batches = withEmpties(
        byBatch.map((r) => ({
            ...named(r.batch_id, r.batch_name, "No batch"),
            programId: r.program_id ?? null,
            ...counts(r)
        })),
        catBatches,
        (c) => ({
            id: c.batch_id,
            name: c.batch_name,
            programId: c.program_id ?? null
        })
    ).sort(byStudents);

    const load = courseLoad[0] || {};

    return {
        departments,
        programs,
        batches,
        sections,
        semesters,

        // How many rows at each level hold nobody, so the screen can say
        // "6 programmes · 1 with no students" instead of quietly showing 5.
        empties: {
            departments: departments.filter((r) => r.empty).length,
            programs: programs.filter((r) => r.empty).length,
            batches: batches.filter((r) => r.empty).length,
            sections: sections.filter((r) => r.empty).length,
            semesters: semesters.filter((r) => r.empty).length
        },

        totals: {
            students: Number(totals?.students || 0),
            active: Number(totals?.active || 0),
            unsectioned: Number(totals?.unsectioned || 0),

            // See the header: course registrations, NOT students. `courseEnrolments`
            // is the ACTIVE ones — `droppedEnrolments` is what that figure leaves
            // out, and `allEnrolments` is the two together, so the card can state
            // its own scope instead of implying it.
            courseEnrolments: Number(load.active || 0),
            droppedEnrolments: Number(load.dropped || 0),
            allEnrolments: Number(load.total || 0),
            studentsWithCourses: Number(load.students || 0),
            distinctSubjects: Number(load.subjects || 0),
            subjectsInCatalogue: Number(subjectCoverage[0]?.total || 0)
        }
    };
};

module.exports = {
    getDashboard,
    getEnrollmentOverview,
    getStudentsPage,
    exportStudents,
    getStudentProfile,
    getAttendancePage,
    getFeesPage,
    getExaminationPage,
    getParentsPage,
    getTeachersPage,
    getAiAnalytics,
    getReports,
    getActivity
};
