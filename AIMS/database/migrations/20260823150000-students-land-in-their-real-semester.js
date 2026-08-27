'use strict';

/*
 * TASK 7 — students were shown as "No semester".
 *
 * `students.current_semester_id` is the column every screen groups by: the
 * admin academic-structure explorer, the student directory, the faculty class
 * lists, announcement targeting and the assistant's scoped SQL all read it.
 * It is also nullable, and nothing on the enrollment path ever sets it — so a
 * student can be correctly registered for Semester 1 in `enrollments`, sit
 * their exams, receive a published GPA, and still be bucketed under
 * "No semester" everywhere the column is read.
 *
 * That is not a display bug in one screen. The enrollment IS the fact of which
 * semester a student is in; `current_semester_id` is a denormalised cache of it
 * that was never populated. In `aims_test` it was NULL for every one of the
 * four students while all four had an Active Semester 1 enrollment.
 *
 * This backfills the column from the enrollment roster: the highest semester
 * the student is not-Dropped in, which is the semester they are currently
 * sitting. Only NULL rows are touched — a value an administrator set by hand is
 * left exactly as it is, because a backfill that overwrites deliberate data is
 * worse than the gap it closes.
 *
 * The read paths additionally COALESCE to the same expression (see
 * backend/src/services/currentSemester.js), so a student created after this
 * migration and not yet given a semester still resolves to the right one
 * instead of reappearing in the "No semester" bucket.
 */

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            UPDATE students s
              JOIN (
                    SELECT e.student_id,
                           MAX(e.semester_id) AS semester_id
                      FROM enrollments e
                     WHERE e.status <> 'Dropped'
                     GROUP BY e.student_id
                   ) latest ON latest.student_id = s.student_id
               SET s.current_semester_id = latest.semester_id
             WHERE s.current_semester_id IS NULL
        `);
    },

    /*
     * Deliberately not reversible.
     *
     * Down would have to decide which of the values now in the column it put
     * there, and it cannot: a NULL restored across the board would throw away
     * semesters set by an administrator before this ran, and there is no record
     * of which rows were touched. Reinstating a data gap is not a rollback
     * anybody wants, so this states that rather than guessing.
     */
    async down() {
        // no-op
    }
};
