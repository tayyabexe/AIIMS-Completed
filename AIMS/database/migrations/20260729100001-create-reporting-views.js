'use strict';

// Day 10: 6 reporting views for attendance, results, fees, exams, and
// timetable lookups. All are CREATE OR REPLACE, so this is safe to re-run.
//
// Decision on attendance handling (documented per the task): 'Holiday' rows
// are excluded from total_sessions entirely (a holiday isn't a real class,
// so it shouldn't affect either the numerator or the denominator).
// 'Leave' rows ARE included in total_sessions and count against
// attendance_percentage (same as 'Absent') - only 'Present' counts toward
// the percentage numerator. Rationale: most institute attendance policies
// don't exempt approved leave from the required attendance percentage,
// they just track it separately for reporting - which is why leave_count
// is exposed as its own column instead of being silently folded into
// absent_count.

const VIEWS = {
  vw_student_attendance_summary: `
CREATE OR REPLACE VIEW vw_student_attendance_summary AS
SELECT
    student_id,
    subject_id,
    COUNT(*)                                           AS total_sessions,
    SUM(status = 'Present')                             AS present_count,
    SUM(status = 'Absent')                               AS absent_count,
    SUM(status = 'Late')                                 AS late_count,
    SUM(status = 'Leave')                                AS leave_count,
    ROUND(SUM(status = 'Present') / COUNT(*) * 100, 2)   AS attendance_percentage
FROM attendance
WHERE status <> 'Holiday'
GROUP BY student_id, subject_id`,

  vw_student_gpa_summary: `
CREATE OR REPLACE VIEW vw_student_gpa_summary AS
SELECT
    r.result_id,
    r.student_id,
    r.semester_id,
    s.semester_number,
    s.program_id,
    r.gpa,
    r.cgpa,
    r.published_at
FROM results r
JOIN semesters s ON s.semester_id = r.semester_id
WHERE r.status = 'Published'`,

  vw_student_fee_status: `
CREATE OR REPLACE VIEW vw_student_fee_status AS
SELECT
    sf.student_fee_id,
    sf.student_id,
    sf.total_payable,
    COALESCE(SUM(p.amount_paid), 0)                      AS amount_paid,
    sf.total_payable - COALESCE(SUM(p.amount_paid), 0)   AS remaining_balance,
    sf.due_date,
    sf.status
FROM student_fees sf
LEFT JOIN payments p ON p.student_fee_id = sf.student_fee_id
GROUP BY sf.student_fee_id, sf.student_id, sf.total_payable, sf.due_date, sf.status`,

  vw_upcoming_exams: `
CREATE OR REPLACE VIEW vw_upcoming_exams AS
SELECT
    e.exam_id,
    e.exam_name,
    e.exam_type,
    e.exam_date,
    e.total_marks,
    e.semester_id,
    e.subject_id,
    sub.subject_code,
    sub.subject_name,
    e.classroom_id,
    e.invigilator_id
FROM exams e
JOIN subjects sub ON sub.subject_id = e.subject_id
WHERE e.exam_date >= CURDATE()
ORDER BY e.exam_date ASC`,

  // Not parameterized (MySQL views can't take arguments) - callers filter
  // with WHERE section_id = ? when querying this view. day_of_week is a
  // real ENUM defined in calendar order (Monday..Saturday), so ORDER BY
  // day_of_week sorts correctly without needing FIELD()/CASE.
  vw_student_timetable: `
CREATE OR REPLACE VIEW vw_student_timetable AS
SELECT
    t.timetable_id,
    t.section_id,
    t.subject_id,
    sub.subject_code,
    sub.subject_name,
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
JOIN subjects sub   ON sub.subject_id  = t.subject_id
JOIN teachers tch    ON tch.teacher_id = t.teacher_id
JOIN employees emp   ON emp.employee_id = tch.employee_id
JOIN classrooms c    ON c.classroom_id = t.classroom_id
ORDER BY t.day_of_week, t.start_time`,

  vw_fee_defaulters: `
CREATE OR REPLACE VIEW vw_fee_defaulters AS
SELECT
    sf.student_fee_id,
    sf.student_id,
    st.registration_number,
    st.first_name,
    st.last_name,
    sf.total_payable,
    sf.due_date,
    sf.status,
    DATEDIFF(CURDATE(), sf.due_date) AS days_overdue
FROM student_fees sf
JOIN students st ON st.student_id = sf.student_id
WHERE sf.status = 'Overdue'
   OR (sf.due_date < CURDATE() AND sf.status <> 'Paid')`,
};

module.exports = {
  async up(queryInterface) {
    for (const sql of Object.values(VIEWS)) {
      await queryInterface.sequelize.query(sql);
    }
  },
  async down(queryInterface) {
    for (const name of Object.keys(VIEWS)) {
      await queryInterface.sequelize.query(`DROP VIEW IF EXISTS ${name}`);
    }
  },
};
