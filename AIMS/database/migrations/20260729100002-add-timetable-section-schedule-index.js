'use strict';

// Day 10 optimization pass. The task's 4 requested indexes
// (student_fees.student_id, marks.student_id, timetables.section_id,
// attendance(student_id, subject_id)) were all checked live first and
// turned out to already exist: InnoDB auto-creates a single-column index
// for every FK column, and attendance already has a 3-column composite
// (student_id, subject_id, att_date) whose leftmost 2 columns already
// serve any (student_id, subject_id) lookup. Adding them again would just
// be duplicate indexes - extra write cost, zero read benefit. Skipped.
//
// EXPLAIN on the 6 view queries surfaced one real, different problem
// instead: vw_student_timetable, filtered by section_id and ordered by
// (day_of_week, start_time), used the existing section_id index for the
// filter but still needed a filesort for the ORDER BY. This composite
// closes that gap - "Using filesort" is gone once it's in place, confirmed
// live. (vw_fee_defaulters' OR condition also full-scans, but that's
// because due_date < CURDATE() matches ~100% of this dataset's rows since
// every fee record is historically dated - a full scan is the objectively
// correct plan there, not an indexing gap. No index fixes that.)
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      `SHOW INDEX FROM timetables WHERE Key_name = 'idx_timetables_section_schedule'`
    );
    if (existing.length > 0) return;

    await queryInterface.addIndex('timetables', ['section_id', 'day_of_week', 'start_time'], {
      name: 'idx_timetables_section_schedule',
    });
  },
  async down(queryInterface) {
    // Bug found during a from-scratch migrate+undo test (Day 12): MySQL
    // silently drops the auto-generated single-column FK-support index for
    // `section_id` once this composite index exists (the composite's
    // leftmost column already covers it), so by the time down() runs, this
    // composite is the ONLY index covering `section_id` - and InnoDB refuses
    // to drop the sole index backing a foreign key ("needed in a foreign key
    // constraint"). Add a plain single-column index back first so the FK
    // stays supported, then drop the composite - this is what running down()
    // is actually supposed to restore.
    await queryInterface.addIndex('timetables', ['section_id'], { name: 'timetables_section_id_idx' });
    await queryInterface.removeIndex('timetables', 'idx_timetables_section_schedule');
  },
};
