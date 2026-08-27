'use strict';

/*
 * Sanity-checks the views the AI assistant reads.
 *
 * Read-only: SELECT only, no DDL or DML. Run after any migration that touches
 * a reporting view, so a definition that compiles but returns nonsense is
 * caught here rather than in an answer the assistant states to a user.
 *
 * Usage: node scripts/verify_assistant_views.js
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const CHECKS = [
  ['marks by status', 'SELECT status, COUNT(*) AS n FROM marks GROUP BY status'],
  ['grading policy', 'SELECT grade_letter, min_percentage, grade_point FROM grades ORDER BY min_percentage'],
  ['class performance rows', 'SELECT COUNT(*) AS n FROM vw_class_performance_summary'],
  ['class performance sample', 'SELECT * FROM vw_class_performance_summary LIMIT 3'],
  ['attendance rows', 'SELECT COUNT(*) AS n FROM vw_student_attendance_summary'],
  ['attendance sample', 'SELECT * FROM vw_student_attendance_summary LIMIT 2'],
  ['fee defaulters', 'SELECT COUNT(*) AS n FROM vw_fee_defaulters'],
  ['gpa sample', 'SELECT * FROM vw_student_gpa_summary LIMIT 1'],
  ['timetable rows', 'SELECT COUNT(*) AS n FROM vw_student_timetable'],
  ['upcoming exams', 'SELECT COUNT(*) AS n FROM vw_upcoming_exams'],
  ['teacher workload', 'SELECT COUNT(*) AS n FROM vw_teacher_workload'],
  ['semester enrollment', 'SELECT COUNT(*) AS n FROM vw_semester_enrollment_summary'],

  // --- views created for the assistant tool layer
  ['profile rows', 'SELECT COUNT(*) AS n FROM vw_student_profile_full'],
  ['profile sample', 'SELECT student_id, registration_number, full_name, program_name, section_name, current_semester_number FROM vw_student_profile_full LIMIT 2'],
  ['subject marks rows', 'SELECT COUNT(*) AS n FROM vw_student_subject_marks'],
  ['subject marks sample', 'SELECT student_id, subject_code, exam_type, obtained_marks, total_marks, percentage, grade_letter FROM vw_student_subject_marks LIMIT 3'],
  ['ungraded marks (should be 0)', 'SELECT COUNT(*) AS n FROM vw_student_subject_marks WHERE grade_letter IS NULL'],
  ['roster rows', 'SELECT COUNT(*) AS n FROM vw_teacher_class_roster'],
  // NOTE: the server runs with ANSI_QUOTES, so double quotes are identifiers
  // here, not string literals. Keep every literal in single quotes.
  ['roster classes per teacher', 'SELECT teacher_id, COUNT(DISTINCT subject_id, section_id) AS classes, COUNT(DISTINCT student_id) AS students FROM vw_teacher_class_roster GROUP BY teacher_id ORDER BY students DESC LIMIT 5'],
  ['attendance daily rows', 'SELECT COUNT(*) AS n FROM vw_attendance_daily'],
  ['fee status rows', 'SELECT COUNT(*) AS n FROM vw_student_fee_status'],
  ['fee pending verification', 'SELECT COUNT(*) AS n FROM vw_student_fee_status WHERE pending_total > 0'],
  ['catalog rows', 'SELECT COUNT(*) AS n FROM vw_program_semester_catalog'],
  ['at risk rows', 'SELECT COUNT(*) AS n FROM vw_at_risk_students'],
  ['at risk sample', 'SELECT registration_number, avg_attendance_percentage, latest_cgpa, outstanding_balance FROM vw_at_risk_students WHERE avg_attendance_percentage < 75 ORDER BY avg_attendance_percentage LIMIT 3'],
  ['exam schedule rows', 'SELECT COUNT(*) AS n FROM vw_exam_schedule_full'],
  ['exam marking states', 'SELECT exam_type, COUNT(*) AS exams, SUM(marks_entered > 0) AS with_marks, SUM(marks_published > 0) AS with_published FROM vw_exam_schedule_full GROUP BY exam_type'],
];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 25000,
  });

  for (const [label, sql] of CHECKS) {
    const [rows] = await c.query(sql);
    console.log(`\n--- ${label}`);
    console.log(JSON.stringify(rows, null, 1));
  }

  await c.end();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
