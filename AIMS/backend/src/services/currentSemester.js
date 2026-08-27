/*
 * Which semester a student is actually in.
 *
 * `students.current_semester_id` is the column the screens group by, but
 * nothing on the enrollment path maintains it, so it is routinely NULL for a
 * student who is properly registered. Every screen that grouped by the raw
 * column therefore reported real, enrolled students as "No semester" — the
 * defect behind Task 7.
 *
 * The migration 20260823150000 backfills the existing rows. This is the other
 * half: the read paths resolve the column against the enrollment roster, so a
 * student created after the backfill — or one an import leaves without a
 * semester — still lands in the semester their registrations say they are in,
 * rather than in a bucket labelled with the absence of one.
 *
 * The roster is the authority here. A student's enrollments are what an
 * administrator actually maintains; the column is a cache of them.
 */

/**
 * SQL for the student's effective semester id.
 *
 * Inlined as an expression rather than exposed as a JOIN so it can be dropped
 * into an existing SELECT, GROUP BY or WHERE without disturbing the query's
 * shape — several of the callers group by it, and a correlated subquery in the
 * SELECT list alone would not be groupable.
 *
 * @param {string} alias  the `students` alias in the calling query.
 * @returns {string} an expression yielding a semester_id, or NULL when the
 *                   student genuinely has no registration anywhere.
 */
const effectiveSemesterId = (alias = "s") => `
    COALESCE(
        ${alias}.current_semester_id,
        (SELECT MAX(e_cs.semester_id)
           FROM enrollments e_cs
          WHERE e_cs.student_id = ${alias}.student_id
            AND e_cs.status <> 'Dropped')
    )`;

module.exports = { effectiveSemesterId };
