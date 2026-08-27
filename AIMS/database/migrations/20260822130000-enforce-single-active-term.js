"use strict";

/*
 * THE RULE: at most one academic term is Active at a time.
 *
 * WHY THIS NEEDS A CONSTRAINT AND NOT JUST A CHECK IN THE SERVICE
 * --------------------------------------------------------------
 * Two terms went Active at once during testing, and the system quietly
 * disagreed with itself about which one "now" meant:
 *
 *   - the admin timetable screen defaults to the Active term and picked one
 *   - every portal query resolves the current term with
 *     `WHERE status IN ('Active','Planned') ORDER BY ... start_date LIMIT 1`
 *     and picked the other
 *
 * So the timetable being edited and the timetable students were being shown
 * were different terms, with nothing on screen admitting it. That is the worst
 * class of bug this schema can have — not a crash, just two honest answers to
 * the same question.
 *
 * `setTermStatus` now refuses to activate a second term. This is the backstop
 * for everything that does not go through it: a seeder, a migration, a repair
 * script, a hand-run UPDATE at 2am.
 *
 * HOW A "ONLY ONE ROW MAY HOLD THIS VALUE" RULE IS EXPRESSED IN MySQL
 * ------------------------------------------------------------------
 * MySQL has no partial indexes, so `UNIQUE (status) WHERE status='Active'` is
 * not available. The standard trick is a generated column that is the constant
 * 1 for the rows being constrained and NULL for everything else — because a
 * UNIQUE index permits any number of NULLs, but only one 1.
 *
 *     active_flag = CASE WHEN status = 'Active' THEN 1 ELSE NULL END
 *
 * Planned and Closed terms are unconstrained; there may be any number of them.
 */

const COLUMN = "active_flag";
const INDEX = "uq_one_active_term";

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        /*
         * Resolve any existing clash first — the index cannot be created while
         * the data violates it.
         *
         * The oldest Active term wins, because that is the one already running:
         * it holds the placed timetable, the enrolments and the attendance.
         * The others are demoted to Planned rather than Closed, since Closed is
         * one-way and would complete every enrolment in them.
         */
        const [active] = await sequelize.query(
            `SELECT term_id, term_name, start_date FROM academic_terms
              WHERE status = 'Active' ORDER BY start_date, term_id`
        );

        if (active.length > 1) {
            const keep = active[0];
            const demote = active.slice(1);

            console.log(
                `  ${active.length} terms were Active. Keeping ${keep.term_name}`
                + " (earliest start, so it is the one actually running)."
            );

            for (const t of demote) {
                console.log(`  demoting ${t.term_name} -> Planned`);
            }

            await sequelize.query(
                `UPDATE academic_terms SET status = 'Planned'
                  WHERE status = 'Active' AND term_id <> :keepId`,
                { replacements: { keepId: keep.term_id } }
            );
        } else {
            console.log(`  ${active.length} active term — nothing to reconcile`);
        }

        // Idempotent: this migration may be re-run after a partial failure.
        const [cols] = await sequelize.query(
            `SHOW COLUMNS FROM academic_terms LIKE '${COLUMN}'`
        );

        if (!cols.length) {
            await sequelize.query(`
                ALTER TABLE academic_terms
                ADD COLUMN ${COLUMN} TINYINT
                GENERATED ALWAYS AS (CASE WHEN status = 'Active' THEN 1 ELSE NULL END)
                VIRTUAL
            `);
        }

        const [idx] = await sequelize.query(
            `SHOW INDEX FROM academic_terms WHERE Key_name = '${INDEX}'`
        );

        if (!idx.length) {
            await sequelize.query(
                `ALTER TABLE academic_terms ADD UNIQUE INDEX ${INDEX} (${COLUMN})`
            );
        }

        console.log("  at most one term can be Active from here on");
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;

        const [idx] = await sequelize.query(
            `SHOW INDEX FROM academic_terms WHERE Key_name = '${INDEX}'`
        );
        if (idx.length) {
            await sequelize.query(`ALTER TABLE academic_terms DROP INDEX ${INDEX}`);
        }

        const [cols] = await sequelize.query(
            `SHOW COLUMNS FROM academic_terms LIKE '${COLUMN}'`
        );
        if (cols.length) {
            await sequelize.query(`ALTER TABLE academic_terms DROP COLUMN ${COLUMN}`);
        }

        console.log("  single-active-term constraint removed");
    }
};
