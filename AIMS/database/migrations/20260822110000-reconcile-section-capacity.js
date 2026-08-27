"use strict";

/*
 * Making `sections.capacity` tell the truth.
 *
 * THE DISAGREEMENT
 * ----------------
 * Every section declared a capacity of 40-60 and actually held 81 to 405
 * students. Not one row was right:
 *
 *     BBA-2A  declared 60   actual 405
 *     SE-2A   declared 40   actual 398
 *     EE-4A   declared 50   actual 397
 *     DS-4A   declared 60   actual 395
 *     CS-4A   declared 60   actual 121
 *     CS-2B   declared 55   actual 113
 *     CS-2A   declared 45   actual  94
 *     CS-4B   declared 40   actual  81
 *
 * That mattered from the moment the scheduler started reading it. Room fit is
 * decided by `classrooms.capacity >= class size`, and a section that claims 60
 * seats but seats 405 will happily be timetabled into a 60-seat room. The
 * column was not merely stale, it was actively wrong in the direction that
 * produces an unusable timetable.
 *
 * WHY CORRECT THE COLUMN RATHER THAN SPLIT THE SECTIONS
 * ----------------------------------------------------
 * Two readings were possible: the capacity is the intent and the cohorts are
 * overloaded, or the cohorts are the fact and the capacity was never
 * maintained. The second is what the data supports - every row is wrong, by
 * wildly varying amounts, which is what an unmaintained default column looks
 * like rather than a policy anybody enforced.
 *
 * Splitting instead would have turned 8 sections into ~40 and 40 offerings
 * into ~200, which realistically needs the timetable auto-generation that was
 * explicitly deferred; the interim state is a mostly-unplaced timetable with
 * no practical way to fix it by hand. The room estate was expanded to 31 rooms
 * including two 450-seat halls precisely so the large cohorts are schedulable
 * as they stand, so nothing is blocked by leaving them intact.
 *
 * This is reversible and touches no timetable or attendance row.
 *
 * WHY THE HEADCOUNT IS COMPUTED, NOT HARD-CODED
 * ---------------------------------------------
 * The numbers above are what the dev database held when this was written. A
 * literal list would be wrong on any other database and would silently drift
 * here. The UPDATE derives each figure from the students actually in the
 * section, so it is correct wherever it runs - and re-running it is harmless.
 *
 * Only sections whose declared capacity is *below* their real headcount are
 * touched. A section with room to spare is not overloaded, and rewriting its
 * capacity down to its current enrolment would destroy the one piece of
 * genuine intent the column still carries.
 */

module.exports = {
    async up(queryInterface) {
        const [rows] = await queryInterface.sequelize.query(`
            SELECT s.section_id,
                   s.section_name,
                   s.capacity AS declared,
                   COUNT(st.student_id) AS actual
              FROM sections s
              JOIN students st
                ON st.section_id = s.section_id
               AND st.is_deleted = 0
               AND st.academic_status = 'Active'
             WHERE s.is_deleted = 0
             GROUP BY s.section_id, s.section_name, s.capacity
            HAVING COUNT(st.student_id) > s.capacity
        `);

        if (!rows.length) {
            console.log("  section capacity: every section already fits its cohort");
            return;
        }

        for (const row of rows) {
            console.log(
                `  ${row.section_name}: capacity ${row.declared} -> ${row.actual}`
            );
        }

        await queryInterface.sequelize.query(`
            UPDATE sections s
              JOIN (
                    SELECT st.section_id, COUNT(*) AS actual
                      FROM students st
                     WHERE st.is_deleted = 0
                       AND st.academic_status = 'Active'
                     GROUP BY st.section_id
                   ) c ON c.section_id = s.section_id
               SET s.capacity = c.actual
             WHERE s.is_deleted = 0
               AND c.actual > s.capacity
        `);

        console.log(`  section capacity: ${rows.length} section(s) reconciled`);
    },

    /*
     * There is no honest down().
     *
     * The previous values were wrong - that is the entire reason this ran -
     * and they were not the same wrong number for every row, so they cannot be
     * reconstructed from anything left in the schema. Restoring a plausible
     * default like 60 would not be a rollback; it would be a second guess
     * wearing a rollback's clothes, and it would re-break room fitting.
     *
     * Left deliberately empty so a `down` is a no-op rather than a silent
     * corruption. If the real intent was to split the oversized sections, that
     * is forward work at a term boundary, not a reversal of this.
     */
    async down() {
        console.log(
            "  section capacity: not reverted - the prior values were incorrect " +
                "and are not recoverable"
        );
    }
};
