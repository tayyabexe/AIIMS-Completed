'use strict';

/*
 * ISSUE 2 — a student registered for two Semester 1 courses saw one of them.
 *
 * `enrollments.semester_id` is a denormalised COPY of `subjects.semester_id`.
 * It is written once, when the cohort is enrolled
 * (backend/src/services/courseOfferingService.js -> enrolCohort, which reads
 * `offering.subject.semester_id` at that moment), and nothing has ever
 * reconciled it afterwards. `subjectService.updateSubject` changed the
 * subject's stage and left every enrollment pointing at the old one.
 *
 * The consequence is not a missing row — it is a MISFILED one. Every read
 * groups by the copy, so the course does not simply disappear: it falls out of
 * the semester the student is sitting and materialises a phantom semester of
 * its own to hold itself. The student's dashboard then shows a short course
 * list under the right semester and an extra semester they have never sat.
 *
 * In `aims_test` this was exact and reproducible:
 *
 *     subjects     CS-101 (id 1) -> semester_id 1
 *     subjects     CS-102 (id 2) -> semester_id 1
 *     enrollments  ids 1-4  (subject 1) -> semester_id 1   correct
 *     enrollments  ids 7-10 (subject 2) -> semester_id 2   stale
 *
 * Both offerings target section CS-A and both subjects sit in Semester 1, so
 * all four students in the section should have seen both courses there.
 *
 * This migration realigns every enrollment whose semester disagrees with its
 * subject. It is idempotent — a second run matches nothing — and it is safe to
 * run against a database where no row has drifted.
 *
 * WHY THIS DOES NOT OVERWRITE DELIBERATE DATA
 * -------------------------------------------
 * Unlike the `current_semester_id` backfill, there is no defensible reading in
 * which an enrollment's stage is deliberately different from its subject's. A
 * subject belongs to exactly one semester of the curriculum; an enrollment in
 * that subject is, by definition, at that stage. A disagreement is drift, not
 * intent, so every disagreeing row is corrected rather than only the NULL ones.
 *
 * The `down` cannot restore the old wrong values — they carry no record of
 * what they were, and restoring them would be restoring the defect. It is a
 * deliberate no-op, and says so.
 *
 * Two further guards keep this from recurring, and are why the fix is not this
 * migration alone:
 *   - backend/src/services/subjectService.js cascades a semester change onto
 *     the enrollments, in the same transaction as the subject write.
 *   - backend/src/controllers/enrollmentController.js resolves the semester
 *     from `subjects` on read, so a row written by any path not yet found
 *     cannot misfile a course on a screen.
 */

module.exports = {
    async up(queryInterface) {

        const [drifted] = await queryInterface.sequelize.query(`
            SELECT COUNT(*) AS n
              FROM enrollments e
              JOIN subjects s ON s.subject_id = e.subject_id
             WHERE e.semester_id <> s.semester_id
        `);

        const count = Number(drifted?.[0]?.n || 0);

        if (count === 0) {
            console.log(
                '  enrollments: every row already agrees with its subject, nothing to realign.'
            );
            return;
        }

        await queryInterface.sequelize.query(`
            UPDATE enrollments e
              JOIN subjects s ON s.subject_id = e.subject_id
               SET e.semester_id = s.semester_id
             WHERE e.semester_id <> s.semester_id
        `);

        console.log(
            `  enrollments: ${count} row${count === 1 ? '' : 's'} realigned to the ` +
            'semester their subject actually belongs to.'
        );
    },

    async down() {
        /*
         * Not reversible, and deliberately so. The rows this corrected held a
         * semester that was simply wrong, and nothing recorded what each stale
         * value had been. Re-introducing them would be re-introducing the bug.
         */
        console.log(
            '  enrollment-semester realignment is not reversible: the previous ' +
            'values were drift, not data.'
        );
    }
};
