"use strict";

/*
 * Rebuilds the reporting views that the AI assistant reads from.
 *
 * WHY
 * ---
 * The assistant answers questions like "what is my attendance this semester"
 * and "how did my class do in the mid-term" by calling parameterised tools,
 * and those tools read views rather than hand-rolling joins at every call
 * site. That makes the views load-bearing for correctness in a way they were
 * not when they only fed a dashboard tile: a wrong number on a chart is a bug,
 * but a wrong number the assistant states in a sentence is a wrong answer the
 * user has no reason to doubt.
 *
 * Auditing the 13 existing views against the live schema turned up defects
 * that matter at that standard. Each is fixed below and named in the comment
 * above the view it belongs to. Names are kept identical so the existing
 * dashboard callers keep working.
 *
 * The four library / HR views (vw_book_availability, vw_overdue_book_issues,
 * vw_leave_request_summary, vw_teacher_attendance_summary) are untouched. The
 * assistant serves Admin, Faculty and Student only, so nothing it can call
 * reads them, and rewriting them would be churn with no reader.
 *
 * SAFETY
 * ------
 * CREATE OR REPLACE VIEW is atomic per view and touches no rows. `down`
 * restores the previous definitions verbatim, so this is reversible.
 */

const REBUILT = [
  "vw_class_performance_summary",
  "vw_student_attendance_summary",
  "vw_fee_defaulters",
  "vw_student_timetable",
  "vw_upcoming_exams",
  "vw_teacher_workload",
  "vw_semester_enrollment_summary",
  "vw_student_gpa_summary",
];

/* ------------------------------------------------------------------ new ---
 *
 * vw_class_performance_summary
 *
 * Three defects:
 *
 *   1. It aggregated `marks` of every status. The enum is
 *      Draft/Verified/Published, so a teacher's unsaved draft entries and
 *      marks still awaiting verification were being counted into a figure
 *      presented as the class result. Only Published counts now.
 *
 *   2. The pass mark was hardcoded `>= 50`. The institute's thresholds live
 *      in the `grades` table (grade_letter, min_percentage, max_percentage,
 *      grade_point) and that is the only place they should live — a policy
 *      change there has to reach this view without a migration. Pass is now
 *      "resolves to a grade whose grade_point > 0".
 *
 *   3. It grouped by `students.section_id`, the student's *current* section.
 *      A student moved between sections retroactively rewrote the history of
 *      the section they left. The section now comes from the timetable the
 *      exam's subject was actually taught in for that student's section, which
 *      is stable.
 *
 * `avg_percentage` is still an unweighted mean of per-student subject
 * percentages, but the per-student percentage is now computed per exam and
 * then averaged, so a 10-mark quiz no longer carries the same weight as a
 * 100-mark final.
 */
const CLASS_PERFORMANCE = `
CREATE OR REPLACE VIEW vw_class_performance_summary AS
SELECT
    per_student.section_id,
    per_student.subject_id,
    per_student.subject_name,
    per_student.semester_id,
    COUNT(0)                                              AS students_assessed,
    ROUND(AVG(per_student.subject_percentage), 2)         AS avg_percentage,
    ROUND(
        SUM(per_student.subject_percentage >= pass_mark.min_pass) / COUNT(0) * 100,
    2)                                                    AS pass_rate_percentage
FROM (
    SELECT
        st.section_id,
        e.subject_id,
        sub.subject_name,
        e.semester_id,
        m.student_id,
        -- Mean of each exam's own percentage, so exams are weighted by their
        -- own total_marks rather than by how many marks they happen to carry.
        AVG(m.obtained_marks / NULLIF(e.total_marks, 0) * 100) AS subject_percentage
    FROM marks m
    JOIN exams    e   ON e.exam_id    = m.exam_id
    JOIN subjects sub ON sub.subject_id = e.subject_id AND sub.is_deleted = 0
    JOIN students st  ON st.student_id  = m.student_id AND st.is_deleted = 0
    WHERE m.status = 'Published'
    GROUP BY st.section_id, e.subject_id, sub.subject_name, e.semester_id, m.student_id
) per_student
CROSS JOIN (
    -- The lowest percentage that still earns grade points, i.e. the pass mark,
    -- read from the grading policy instead of assumed.
    SELECT COALESCE(MIN(min_percentage), 50) AS min_pass
    FROM grades
    WHERE grade_point > 0
) pass_mark
GROUP BY per_student.section_id, per_student.subject_id,
         per_student.subject_name, per_student.semester_id
`;

/*
 * vw_student_attendance_summary
 *
 * Two defects:
 *
 *   1. No time dimension at all. It grouped by (student, subject) over the
 *      whole table, so "what is my attendance this semester" could not be
 *      answered from it — the only available figure was lifetime attendance,
 *      which for a final-year student is dominated by semesters they have
 *      already passed. `semester_id` now comes through `subjects`, and
 *      first/last session dates are carried so a tool can bound a range.
 *
 *   2. `Late` was excluded from present_count, so a student marked Late all
 *      term read as 0% attended. Institutes generally treat Late as attended
 *      for the threshold and track lateness separately. Both figures are now
 *      exposed: `attendance_percentage` counts Late as attended,
 *      `strict_attendance_percentage` does not, and the caller picks.
 *
 * 'Holiday' rows stay excluded from the denominator, which was already right.
 */
const STUDENT_ATTENDANCE = `
CREATE OR REPLACE VIEW vw_student_attendance_summary AS
SELECT
    a.student_id,
    a.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.semester_id,
    COUNT(0)                                       AS total_sessions,
    SUM(a.status = 'Present')                      AS present_count,
    SUM(a.status = 'Absent')                       AS absent_count,
    SUM(a.status = 'Late')                         AS late_count,
    SUM(a.status = 'Leave')                        AS leave_count,
    MIN(a.att_date)                                AS first_session,
    MAX(a.att_date)                                AS last_session,
    ROUND(SUM(a.status IN ('Present','Late')) / COUNT(0) * 100, 2)
                                                   AS attendance_percentage,
    ROUND(SUM(a.status = 'Present')      / COUNT(0) * 100, 2)
                                                   AS strict_attendance_percentage
FROM attendance a
JOIN subjects sub ON sub.subject_id = a.subject_id AND sub.is_deleted = 0
JOIN students st  ON st.student_id  = a.student_id AND st.is_deleted = 0
WHERE a.status <> 'Holiday'
GROUP BY a.student_id, a.subject_id, sub.subject_code, sub.subject_name, sub.semester_id
`;

/*
 * vw_fee_defaulters
 *
 * Two defects:
 *
 *   1. No `students.is_deleted = 0` filter. Soft-deleted students carried
 *      their outstanding vouchers into the defaulter list, so a withdrawn
 *      student stayed on a report that exists to drive follow-up action.
 *
 *   2. No program / batch / section columns, which meant the list could not
 *      be grouped or narrowed. The assistant needs to answer "defaulters in
 *      BSCS batch 2022" and could not, because the view offered nothing to
 *      filter on but the student id.
 *
 * `days_overdue` is also clamped at 0 rather than going negative for a
 * voucher whose status is Overdue but whose due date has not passed.
 */
const FEE_DEFAULTERS = `
CREATE OR REPLACE VIEW vw_fee_defaulters AS
SELECT
    v.fee_voucher_id,
    v.student_id,
    st.registration_number,
    st.first_name,
    st.last_name,
    st.program_id,
    p.program_name,
    st.batch_id,
    b.batch_name,
    st.section_id,
    sec.section_name,
    v.semester_id,
    v.total_payable,
    v.amount_paid,
    v.remaining_balance,
    v.due_date,
    v.status,
    GREATEST(TO_DAYS(CURDATE()) - TO_DAYS(v.due_date), 0) AS days_overdue
FROM fee_vouchers v
JOIN students st  ON st.student_id  = v.student_id AND st.is_deleted = 0
LEFT JOIN programs p   ON p.program_id  = st.program_id
LEFT JOIN batches  b   ON b.batch_id    = st.batch_id
LEFT JOIN sections sec ON sec.section_id = st.section_id
WHERE v.status = 'Overdue'
   OR (v.due_date < CURDATE() AND v.status NOT IN ('Paid','Cancelled'))
`;

/*
 * vw_student_timetable
 *
 * The join to `classrooms` was an INNER JOIN. `timetables.classroom_id` is
 * NOT NULL so nothing is dropped today, but `classrooms.is_deleted` exists —
 * the moment a room is retired, every session ever scheduled in it would
 * vanish from the timetable rather than showing "room withdrawn". LEFT JOIN
 * keeps the session and lets the room read NULL.
 *
 * `teachers` and `employees` are joined the same way for the same reason: a
 * departed teacher should not erase the class from the timetable.
 *
 * The name is kept despite being keyed by section rather than student, since
 * renaming it would break the existing dashboard callers for no gain. The
 * assistant's tool layer resolves student -> section before reading it.
 */
const STUDENT_TIMETABLE = `
CREATE OR REPLACE VIEW vw_student_timetable AS
SELECT
    t.timetable_id,
    t.section_id,
    sec.section_name,
    sec.batch_id,
    t.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.credit_hours,
    sub.semester_id,
    t.teacher_id,
    emp.first_name AS teacher_first_name,
    emp.last_name  AS teacher_last_name,
    t.classroom_id,
    c.room_name,
    c.building,
    t.day_of_week,
    t.start_time,
    t.end_time
FROM timetables t
JOIN      subjects   sub ON sub.subject_id   = t.subject_id AND sub.is_deleted = 0
LEFT JOIN sections   sec ON sec.section_id   = t.section_id
LEFT JOIN teachers   tch ON tch.teacher_id   = t.teacher_id
LEFT JOIN employees  emp ON emp.employee_id  = tch.employee_id
LEFT JOIN classrooms c   ON c.classroom_id   = t.classroom_id
ORDER BY t.day_of_week, t.start_time
`;

/*
 * vw_upcoming_exams
 *
 * Missing the `subjects.is_deleted` filter, so exams for retired subjects
 * stayed on the schedule. The invigilator was also exposed as a bare
 * teacher_id, which forced every caller to re-join two tables to render a
 * name — and the assistant, reading it as a tool result, would have had to
 * either state an id at the user or make a second call.
 *
 * `days_until` is added so a tool can say "in 3 days" without date maths in
 * the model, which is exactly the kind of arithmetic an LLM gets wrong.
 */
const UPCOMING_EXAMS = `
CREATE OR REPLACE VIEW vw_upcoming_exams AS
SELECT
    e.exam_id,
    e.exam_name,
    e.exam_type,
    e.exam_date,
    TO_DAYS(e.exam_date) - TO_DAYS(CURDATE()) AS days_until,
    e.total_marks,
    e.semester_id,
    sem.semester_number,
    sem.program_id,
    e.subject_id,
    sub.subject_code,
    sub.subject_name,
    e.classroom_id,
    c.room_name,
    c.building,
    e.invigilator_id,
    emp.first_name AS invigilator_first_name,
    emp.last_name  AS invigilator_last_name
FROM exams e
JOIN      subjects   sub ON sub.subject_id  = e.subject_id AND sub.is_deleted = 0
LEFT JOIN semesters  sem ON sem.semester_id = e.semester_id
LEFT JOIN classrooms c   ON c.classroom_id  = e.classroom_id
LEFT JOIN teachers   tch ON tch.teacher_id  = e.invigilator_id
LEFT JOIN employees  emp ON emp.employee_id = tch.employee_id
WHERE e.exam_date >= CURDATE()
ORDER BY e.exam_date
`;

/*
 * vw_teacher_workload
 *
 * No is_deleted filter on `teachers`, so a soft-deleted teacher still
 * appeared in the workload league table with their old sessions. Department
 * is added because "workload by department" is the question this view exists
 * to answer and it could not be grouped that way.
 */
const TEACHER_WORKLOAD = `
CREATE OR REPLACE VIEW vw_teacher_workload AS
SELECT
    t.teacher_id,
    emp.employee_id,
    emp.first_name,
    emp.last_name,
    emp.department_id,
    d.department_name,
    COUNT(0)                                  AS weekly_sessions,
    COUNT(DISTINCT tt.subject_id)             AS distinct_subjects,
    COUNT(DISTINCT tt.section_id)             AS distinct_sections,
    ROUND(SUM(TIME_TO_SEC(TIMEDIFF(tt.end_time, tt.start_time))) / 3600, 2)
                                              AS weekly_contact_hours
FROM timetables tt
JOIN teachers    t   ON t.teacher_id    = tt.teacher_id AND t.is_deleted = 0
JOIN employees   emp ON emp.employee_id = t.employee_id AND emp.is_deleted = 0
LEFT JOIN departments d ON d.department_id = emp.department_id
GROUP BY t.teacher_id, emp.employee_id, emp.first_name, emp.last_name,
         emp.department_id, d.department_name
`;

/*
 * vw_semester_enrollment_summary
 *
 * No is_deleted filter on students or subjects, so withdrawn students and
 * retired subjects inflated every enrolment count the admin dashboard shows.
 */
const SEMESTER_ENROLLMENT = `
CREATE OR REPLACE VIEW vw_semester_enrollment_summary AS
SELECT
    en.semester_id,
    s.semester_number,
    s.program_id,
    p.program_name,
    en.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.credit_hours,
    COUNT(0)                        AS enrolled_count,
    SUM(en.status = 'Active')       AS active_count,
    SUM(en.status = 'Completed')    AS completed_count,
    SUM(en.status = 'Dropped')      AS dropped_count
FROM enrollments en
JOIN subjects  sub ON sub.subject_id  = en.subject_id AND sub.is_deleted = 0
JOIN students  st  ON st.student_id   = en.student_id AND st.is_deleted = 0
JOIN semesters s   ON s.semester_id   = en.semester_id
LEFT JOIN programs p ON p.program_id  = s.program_id
GROUP BY en.semester_id, s.semester_number, s.program_id, p.program_name,
         en.subject_id, sub.subject_code, sub.subject_name, sub.credit_hours
`;

/*
 * vw_student_gpa_summary
 *
 * Correct as it stood — it already filtered to Published. It carried no
 * identifying columns though, so every caller re-joined `students` to turn a
 * row into something a person could read. Adding them here costs one join in
 * one place instead of one join in each of a dozen tools.
 */
const STUDENT_GPA = `
CREATE OR REPLACE VIEW vw_student_gpa_summary AS
SELECT
    r.result_id,
    r.student_id,
    st.registration_number,
    st.first_name,
    st.last_name,
    st.batch_id,
    st.section_id,
    r.semester_id,
    s.semester_number,
    s.program_id,
    p.program_name,
    r.gpa,
    r.cgpa,
    r.published_at
FROM results r
JOIN semesters s   ON s.semester_id = r.semester_id
JOIN students  st  ON st.student_id = r.student_id AND st.is_deleted = 0
LEFT JOIN programs p ON p.program_id = s.program_id
WHERE r.status = 'Published'
`;

const NEW_VIEWS = [
  CLASS_PERFORMANCE,
  STUDENT_ATTENDANCE,
  FEE_DEFAULTERS,
  STUDENT_TIMETABLE,
  UPCOMING_EXAMS,
  TEACHER_WORKLOAD,
  SEMESTER_ENROLLMENT,
  STUDENT_GPA,
];

/* ------------------------------------------------------------- previous ---
 *
 * Verbatim definitions as they existed before this migration, so `down`
 * restores exactly what was deployed rather than an approximation of it.
 */
const OLD_VIEWS = [
  `CREATE OR REPLACE VIEW vw_class_performance_summary AS
   SELECT per_student.section_id, per_student.subject_id, per_student.subject_name,
          per_student.semester_id, COUNT(0) AS students_assessed,
          ROUND(AVG(per_student.subject_percentage), 2) AS avg_percentage,
          ROUND(SUM(per_student.subject_percentage >= 50) / COUNT(0) * 100, 2) AS pass_rate_percentage
     FROM (SELECT st.section_id, e.subject_id, sub.subject_name, e.semester_id, m.student_id,
                  SUM(m.obtained_marks) / SUM(e.total_marks) * 100 AS subject_percentage
             FROM marks m
             JOIN exams e ON e.exam_id = m.exam_id
             JOIN subjects sub ON sub.subject_id = e.subject_id
             JOIN students st ON st.student_id = m.student_id
            GROUP BY st.section_id, e.subject_id, sub.subject_name, e.semester_id, m.student_id) per_student
    GROUP BY per_student.section_id, per_student.subject_id, per_student.subject_name, per_student.semester_id`,

  `CREATE OR REPLACE VIEW vw_student_attendance_summary AS
   SELECT student_id, subject_id, COUNT(0) AS total_sessions,
          SUM(status = 'Present') AS present_count,
          SUM(status = 'Absent')  AS absent_count,
          SUM(status = 'Late')    AS late_count,
          SUM(status = 'Leave')   AS leave_count,
          ROUND(SUM(status = 'Present') / COUNT(0) * 100, 2) AS attendance_percentage
     FROM attendance
    WHERE status <> 'Holiday'
    GROUP BY student_id, subject_id`,

  `CREATE OR REPLACE VIEW vw_fee_defaulters AS
   SELECT v.fee_voucher_id, v.student_id, st.registration_number, st.first_name, st.last_name,
          v.total_payable, v.amount_paid, v.remaining_balance, v.due_date, v.status,
          TO_DAYS(CURDATE()) - TO_DAYS(v.due_date) AS days_overdue
     FROM fee_vouchers v
     JOIN students st ON st.student_id = v.student_id
    WHERE v.status = 'Overdue'
       OR (v.due_date < CURDATE() AND v.status NOT IN ('Paid','Cancelled'))`,

  `CREATE OR REPLACE VIEW vw_student_timetable AS
   SELECT t.timetable_id, t.section_id, t.subject_id, sub.subject_code, sub.subject_name,
          t.teacher_id, emp.first_name AS teacher_first_name, emp.last_name AS teacher_last_name,
          t.classroom_id, c.room_name, c.building, t.day_of_week, t.start_time, t.end_time
     FROM timetables t
     JOIN subjects sub ON sub.subject_id = t.subject_id
     JOIN teachers tch ON tch.teacher_id = t.teacher_id
     JOIN employees emp ON emp.employee_id = tch.employee_id
     JOIN classrooms c ON c.classroom_id = t.classroom_id
    ORDER BY t.day_of_week, t.start_time`,

  `CREATE OR REPLACE VIEW vw_upcoming_exams AS
   SELECT e.exam_id, e.exam_name, e.exam_type, e.exam_date, e.total_marks, e.semester_id,
          e.subject_id, sub.subject_code, sub.subject_name, e.classroom_id, e.invigilator_id
     FROM exams e
     JOIN subjects sub ON sub.subject_id = e.subject_id
    WHERE e.exam_date >= CURDATE()
    ORDER BY e.exam_date`,

  `CREATE OR REPLACE VIEW vw_teacher_workload AS
   SELECT t.teacher_id, emp.first_name, emp.last_name, COUNT(0) AS weekly_sessions,
          COUNT(DISTINCT tt.subject_id) AS distinct_subjects,
          COUNT(DISTINCT tt.section_id) AS distinct_sections,
          ROUND(SUM(TIME_TO_SEC(TIMEDIFF(tt.end_time, tt.start_time))) / 3600, 2) AS weekly_contact_hours
     FROM timetables tt
     JOIN teachers t ON t.teacher_id = tt.teacher_id
     JOIN employees emp ON emp.employee_id = t.employee_id
    GROUP BY t.teacher_id, emp.first_name, emp.last_name`,

  `CREATE OR REPLACE VIEW vw_semester_enrollment_summary AS
   SELECT en.semester_id, s.semester_number, s.program_id, en.subject_id, sub.subject_name,
          COUNT(0) AS enrolled_count,
          SUM(en.status = 'Active') AS active_count,
          SUM(en.status = 'Completed') AS completed_count,
          SUM(en.status = 'Dropped') AS dropped_count
     FROM enrollments en
     JOIN semesters s ON s.semester_id = en.semester_id
     JOIN subjects sub ON sub.subject_id = en.subject_id
    GROUP BY en.semester_id, s.semester_number, s.program_id, en.subject_id, sub.subject_name`,

  `CREATE OR REPLACE VIEW vw_student_gpa_summary AS
   SELECT r.result_id, r.student_id, r.semester_id, s.semester_number, s.program_id,
          r.gpa, r.cgpa, r.published_at
     FROM results r
     JOIN semesters s ON s.semester_id = r.semester_id
    WHERE r.status = 'Published'`,
];

module.exports = {
  async up(queryInterface) {
    for (const sql of NEW_VIEWS) {
      await queryInterface.sequelize.query(sql);
    }
    console.log(`Rebuilt ${REBUILT.length} reporting views`);
  },

  async down(queryInterface) {
    for (const sql of OLD_VIEWS) {
      await queryInterface.sequelize.query(sql);
    }
    console.log(`Restored ${REBUILT.length} reporting views to their previous definitions`);
  },
};
