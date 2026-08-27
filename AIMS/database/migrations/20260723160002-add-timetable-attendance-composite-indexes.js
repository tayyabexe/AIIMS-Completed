'use strict';

// Found via EXPLAIN on realistic query patterns: both showed "Using filesort"
// because the index used to satisfy the WHERE clause didn't also cover the
// ORDER BY.
//   - "a teacher's weekly schedule" (WHERE teacher_id = ? ORDER BY
//     day_of_week, start_time) was using the plain teacher_id FK index, then
//     sorting separately.
//   - "a student's attendance history for one subject" (WHERE student_id = ?
//     AND subject_id = ? ORDER BY att_date) was using uq_attendance_once
//     (student_id, timetable_id, att_date), which only serves the student_id
//     half of the filter since subject_id isn't part of that key.
// Both composite indexes below let MySQL satisfy the filter AND the sort
// directly from the index (day_of_week is an ENUM, so it already sorts
// Monday..Saturday in declaration order, matching calendar order).
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('timetables', ['teacher_id', 'day_of_week', 'start_time'], {
      name: 'idx_timetables_teacher_schedule',
    });
    await queryInterface.addIndex('attendance', ['student_id', 'subject_id', 'att_date'], {
      name: 'idx_attendance_student_subject_date',
    });
  },
  async down(queryInterface) {
    // Bug found during a from-scratch migrate+undo test (Day 12): same issue
    // as 20260729100002-add-timetable-section-schedule-index.js. Once this
    // composite exists, MySQL drops the auto-generated single-column
    // FK-support index for `teacher_id` (it's now redundant), so this
    // composite becomes the ONLY index covering `teacher_id` - InnoDB then
    // refuses to drop it ("needed in a foreign key constraint"). Add a plain
    // index back first so the FK stays supported. (`attendance.student_id`
    // doesn't have this problem: `uq_attendance_once (student_id, ...)` is a
    // separate index that also covers it, so that FK is never left
    // unsupported and removeIndex there already works as-is.)
    await queryInterface.addIndex('timetables', ['teacher_id'], { name: 'timetables_teacher_id_idx' });
    await queryInterface.removeIndex('timetables', 'idx_timetables_teacher_schedule');
    await queryInterface.removeIndex('attendance', 'idx_attendance_student_subject_date');
  },
};
