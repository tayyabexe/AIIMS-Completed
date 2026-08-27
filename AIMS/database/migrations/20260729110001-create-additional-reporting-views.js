'use strict';

// Follow-up to 20260729100001: broadened reporting coverage to every
// module that had real live data but no view yet - teacher workload,
// teacher attendance, academic performance, enrollment, fee collection,
// library, and HR leave. Same rule as before: CREATE OR REPLACE, safe to
// re-run.
//
// EXPLAIN was run on all 8 before deciding on indexes (see the status doc,
// Day 11 section) - every full/index scan found is either on a tiny table
// (<300 rows) or an aggregate with no WHERE clause covering 100% of the
// table, neither of which an index can improve. No new indexes were added
// as a result - that's a documented finding, not an oversight.

const VIEWS = {
  vw_teacher_workload: `
CREATE OR REPLACE VIEW vw_teacher_workload AS
SELECT
    t.teacher_id,
    emp.first_name,
    emp.last_name,
    COUNT(*)                                                              AS weekly_sessions,
    COUNT(DISTINCT tt.subject_id)                                         AS distinct_subjects,
    COUNT(DISTINCT tt.section_id)                                         AS distinct_sections,
    ROUND(SUM(TIME_TO_SEC(TIMEDIFF(tt.end_time, tt.start_time))) / 3600, 2) AS weekly_contact_hours
FROM timetables tt
JOIN teachers t    ON t.teacher_id = tt.teacher_id
JOIN employees emp ON emp.employee_id = t.employee_id
GROUP BY t.teacher_id, emp.first_name, emp.last_name`,

  vw_teacher_attendance_summary: `
CREATE OR REPLACE VIEW vw_teacher_attendance_summary AS
SELECT
    employee_id,
    COUNT(*)                                          AS total_days,
    SUM(status = 'Present')                             AS present_count,
    SUM(status = 'Absent')                              AS absent_count,
    SUM(status = 'Late')                                AS late_count,
    SUM(status = 'Leave')                               AS leave_count,
    ROUND(SUM(status = 'Present') / COUNT(*) * 100, 2)  AS attendance_percentage
FROM teacher_attendance
GROUP BY employee_id`,

  // Per-student subject percentage first (matches the same aggregation
  // sp_publish_semester_results uses), THEN averaged at the class level -
  // not per individual exam row, which would let one bad quiz score skew
  // the pass rate independently of a student's real subject outcome.
  vw_class_performance_summary: `
CREATE OR REPLACE VIEW vw_class_performance_summary AS
SELECT
    per_student.section_id,
    per_student.subject_id,
    per_student.subject_name,
    per_student.semester_id,
    COUNT(*)                                                              AS students_assessed,
    ROUND(AVG(per_student.subject_percentage), 2)                        AS avg_percentage,
    ROUND(SUM(per_student.subject_percentage >= 50) / COUNT(*) * 100, 2)  AS pass_rate_percentage
FROM (
    SELECT
        st.section_id,
        e.subject_id,
        sub.subject_name,
        e.semester_id,
        m.student_id,
        SUM(m.obtained_marks) / SUM(e.total_marks) * 100 AS subject_percentage
    FROM marks m
    JOIN exams e      ON e.exam_id = m.exam_id
    JOIN subjects sub ON sub.subject_id = e.subject_id
    JOIN students st  ON st.student_id = m.student_id
    GROUP BY st.section_id, e.subject_id, sub.subject_name, e.semester_id, m.student_id
) AS per_student
GROUP BY per_student.section_id, per_student.subject_id, per_student.subject_name, per_student.semester_id`,

  vw_semester_enrollment_summary: `
CREATE OR REPLACE VIEW vw_semester_enrollment_summary AS
SELECT
    en.semester_id,
    s.semester_number,
    s.program_id,
    en.subject_id,
    sub.subject_name,
    COUNT(*)                    AS enrolled_count,
    SUM(en.status = 'Active')    AS active_count,
    SUM(en.status = 'Completed') AS completed_count,
    SUM(en.status = 'Dropped')   AS dropped_count
FROM enrollments en
JOIN semesters s  ON s.semester_id = en.semester_id
JOIN subjects sub ON sub.subject_id = en.subject_id
GROUP BY en.semester_id, s.semester_number, s.program_id, en.subject_id, sub.subject_name`,

  vw_fee_collection_summary: `
CREATE OR REPLACE VIEW vw_fee_collection_summary AS
SELECT
    fs.program_id,
    p.program_name,
    fs.semester_id,
    sem.semester_number,
    COUNT(DISTINCT sf.student_fee_id)                                          AS total_challans,
    SUM(sf.total_payable)                                                      AS total_payable,
    COALESCE(SUM(pay.amount_paid), 0)                                          AS total_collected,
    SUM(sf.total_payable) - COALESCE(SUM(pay.amount_paid), 0)                  AS outstanding_balance,
    ROUND(COALESCE(SUM(pay.amount_paid), 0) / SUM(sf.total_payable) * 100, 2)  AS collection_rate_percentage
FROM student_fees sf
JOIN fee_structures fs ON fs.fee_structure_id = sf.fee_structure_id
JOIN programs p         ON p.program_id = fs.program_id
JOIN semesters sem       ON sem.semester_id = fs.semester_id
LEFT JOIN payments pay ON pay.student_fee_id = sf.student_fee_id
GROUP BY fs.program_id, p.program_name, fs.semester_id, sem.semester_number`,

  vw_book_availability: `
CREATE OR REPLACE VIEW vw_book_availability AS
SELECT
    book_id,
    title,
    author,
    category,
    total_copies,
    available_copies,
    (total_copies - available_copies) AS copies_issued
FROM books
WHERE is_deleted = FALSE`,

  vw_overdue_book_issues: `
CREATE OR REPLACE VIEW vw_overdue_book_issues AS
SELECT
    bi.issue_id,
    bi.book_id,
    b.title,
    bi.borrower_user_id,
    u.email AS borrower_email,
    bi.issue_date,
    bi.due_date,
    DATEDIFF(CURDATE(), bi.due_date) AS days_overdue,
    bi.fine_amount
FROM book_issues bi
JOIN books b ON b.book_id = bi.book_id
JOIN users u ON u.user_id = bi.borrower_user_id
WHERE bi.return_date IS NULL
  AND bi.due_date < CURDATE()`,

  vw_leave_request_summary: `
CREATE OR REPLACE VIEW vw_leave_request_summary AS
SELECT
    u.user_id,
    emp.first_name,
    emp.last_name,
    emp.department_id,
    COUNT(*)                                                                                  AS total_requests,
    SUM(lr.status = 'Pending')                                                                 AS pending_count,
    SUM(lr.status = 'Approved')                                                                AS approved_count,
    SUM(lr.status = 'Rejected')                                                                AS rejected_count,
    SUM(lr.status = 'Approved' AND lr.start_date <= CURDATE() AND lr.end_date >= CURDATE())    AS currently_on_leave
FROM leave_requests lr
JOIN users u            ON u.user_id = lr.user_id
LEFT JOIN employees emp ON emp.user_id = u.user_id
GROUP BY u.user_id, emp.first_name, emp.last_name, emp.department_id`,
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
