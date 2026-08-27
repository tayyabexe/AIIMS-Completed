"use strict";

/*
 * ONE RULE: how many times a week does a class meet?
 *
 * THE CONTRADICTION THIS REMOVES
 * ------------------------------
 * The same fact was stored in two places and they disagreed:
 *
 *   subjects.sessions_per_week          the curriculum's answer
 *   course_offerings.sessions_per_week  the class's answer
 *
 * `subjects` was internally coherent — 2 CH meant 1 session, 3 CH meant 2 —
 * but every one of the 40 offerings held the literal value 1, because the
 * column had a NOT NULL DEFAULT 1 and nothing ever populated it from the
 * subject. So 24 of 40 classes claimed to meet once a week for a 3-credit
 * course, the admin screen called the term "40/40 complete", and a student's
 * week showed five lectures where it should have shown eight.
 *
 * Two columns holding one fact will always drift. This makes one of them the
 * rule and the other an exception.
 *
 * THE RULE
 * --------
 *     A class meets as many times a week as its credit hours require,
 *     and that number is stated once — on the subject.
 *
 *         sessions_per_week = GREATEST(1, ROUND(credit_hours / 1.5))
 *
 * The 1.5 is not arbitrary: a period on this institute's grid is 90 minutes
 * (see backend/src/config/timetableSlots.js), so a credit hour of weekly
 * contact time costs two thirds of a period. Rounding to whole periods:
 *
 *     2 CH -> 1 session   (1.5h against 2h of credit — the closest whole period)
 *     3 CH -> 2 sessions  (3.0h — exact)
 *     4 CH -> 3 sessions  (4.5h against 4h)
 *
 * The first two already matched the seeded data for all 195 subjects that use
 * them, so this writes the rule down rather than inventing one. The third is a
 * correction: five 4-credit subjects claimed 2 sessions, which is three hours
 * of contact for four credits.
 *
 * WHY `course_offerings.sessions_per_week` BECOMES NULLABLE
 * --------------------------------------------------------
 * It stays, because a real registry does occasionally need one section of one
 * subject to meet more often for one term — an intensive, a merged cohort, a
 * catch-up. But it becomes NULL by default, and NULL means "follow the
 * subject".
 *
 * That is the whole fix. The old column could not represent "unset": 1 was
 * indistinguishable from a deliberate decision to meet once, so the default
 * silently outranked the curriculum on every row. A nullable override can only
 * disagree with the subject when somebody actually chose to — which is the
 * same reason `subjects.required_room_type` is nullable rather than carrying
 * an 'Any' member.
 *
 * Every read now resolves it in one place:
 *
 *     COALESCE(o.sessions_per_week, sub.sessions_per_week)
 *
 * WHAT THIS DOES TO THE SEEDED TERM
 * ---------------------------------
 * Sections go from 5 placed periods a week to 8 required, against a grid of
 * 24. Nothing becomes unschedulable: the busiest teacher lands at 9 periods a
 * week and the estate has 31 rooms. The admin screen will correctly stop
 * calling the term complete, because it is not — 40 periods are placed and 64
 * are required. That is the point.
 */

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        // ---------------------------------------------------------------
        // 1. The subject is the rule. Recompute it from credit hours.
        // ---------------------------------------------------------------
        const [before] = await sequelize.query(`
            SELECT credit_hours,
                   sessions_per_week AS was,
                   GREATEST(1, ROUND(credit_hours / 1.5)) AS will_be,
                   COUNT(*) AS subjects
              FROM subjects
             WHERE is_deleted = 0
             GROUP BY credit_hours, sessions_per_week
             ORDER BY credit_hours
        `);

        for (const r of before) {
            const mark = Number(r.was) === Number(r.will_be) ? "unchanged" : "CORRECTED";
            console.log(
                `  ${r.credit_hours} CH: ${r.was} -> ${r.will_be} session(s)`
                + ` across ${r.subjects} subject(s)  [${mark}]`
            );
        }

        await sequelize.query(`
            UPDATE subjects
               SET sessions_per_week = GREATEST(1, ROUND(credit_hours / 1.5))
             WHERE is_deleted = 0
        `);

        // ---------------------------------------------------------------
        // 2. The offering becomes a nullable override.
        // ---------------------------------------------------------------
        await sequelize.query(`
            ALTER TABLE course_offerings
            MODIFY COLUMN sessions_per_week TINYINT NULL DEFAULT NULL
            COMMENT 'NULL = follow subjects.sessions_per_week. Set only to override for this term.'
        `);

        /*
         * Clear every existing value.
         *
         * Safe precisely because none of them were decisions: all 40 rows held
         * the old column default of 1, so there is no deliberate override to
         * preserve. Had any row disagreed with 1, this would need to keep it.
         */
        const [{ 0: distinct }] = await sequelize.query(`
            SELECT COUNT(DISTINCT sessions_per_week) AS values_seen,
                   MIN(sessions_per_week) AS only_value
              FROM course_offerings
             WHERE is_deleted = 0 AND sessions_per_week IS NOT NULL
        `);

        if (Number(distinct.values_seen) > 1) {
            console.log(
                `  NOTE: offerings carry ${distinct.values_seen} distinct values, so some`
                + " may be deliberate overrides — leaving them in place."
            );
        } else {
            await sequelize.query(
                "UPDATE course_offerings SET sessions_per_week = NULL"
            );
            console.log(
                `  offerings: cleared the inherited default (${distinct.only_value})`
                + " on every row; they now follow their subject"
            );
        }

        const [[after]] = await sequelize.query(`
            SELECT COUNT(*) AS classes,
                   SUM(COALESCE(o.sessions_per_week, sub.sessions_per_week)) AS periods_required,
                   (SELECT COUNT(*) FROM timetables) AS periods_placed
              FROM course_offerings o
              JOIN subjects sub ON sub.subject_id = o.subject_id
             WHERE o.is_deleted = 0
        `);

        console.log(
            `  result: ${after.classes} classes now require ${after.periods_required}`
            + ` periods a week; ${after.periods_placed} are placed`
        );
    },

    /*
     * Reversible in shape, not in content.
     *
     * The column goes back to NOT NULL DEFAULT 1, and every row goes back to
     * carrying a literal number — which is what it looked like before. The
     * pre-existing subject values for 4-credit subjects are not restored,
     * because they were wrong and the rule is recomputable at any time.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;

        await sequelize.query(`
            UPDATE course_offerings o
              JOIN subjects sub ON sub.subject_id = o.subject_id
               SET o.sessions_per_week = COALESCE(o.sessions_per_week, sub.sessions_per_week)
        `);

        await sequelize.query(`
            ALTER TABLE course_offerings
            MODIFY COLUMN sessions_per_week TINYINT NOT NULL DEFAULT 1
        `);

        console.log("  sessions_per_week: offerings carry a literal value again");
    }
};
