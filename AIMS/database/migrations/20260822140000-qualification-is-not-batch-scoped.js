"use strict";

/*
 * THE RULE: a teacher is qualified to teach a SUBJECT, not a subject-and-batch.
 *
 * WHAT THE COLUMN WAS CLAIMING
 * ----------------------------
 * `teacher_subjects` was keyed `(teacher_id, subject_id, batch_id)`. Read
 * literally, a row said:
 *
 *     "Dr Anwar may teach CS-501 — but only to BSCS-2023."
 *
 * That is not a rule any university has. Competence to teach Computer Networks
 * does not expire when a new intake arrives. The table predates
 * `course_offerings`, and back then it was doing double duty: half
 * qualification, half assignment. The offering spine took the assignment half
 * (`course_offerings.teacher_id` — one teacher, one section, one term), which
 * left `teacher_subjects` holding only the qualification half. The batch column
 * is the vestige of the job it no longer does.
 *
 * WHY IT ACTIVELY BREAKS THINGS, NOT JUST OFFENDS TIDINESS
 * -------------------------------------------------------
 * `getEligibleTeachers` builds the staffing shortlist with
 *
 *     EXISTS (... WHERE ts.subject_id = :subjectId AND ts.batch_id = :batchId)
 *
 * so the "Recorded as qualified" group is scoped to the batch being staffed.
 * Create a new batch — which is the one moment a registrar most needs the
 * shortlist — and **every teacher drops out of it**, because no row exists for
 * a batch that did not exist when the rows were written. The screen does not
 * fail; it quietly presents a faculty of strangers, and the registrar staffs
 * the term from an unsorted list of 24 names.
 *
 * That is exactly what happened to BSCS-2023's new section CS-5A.
 *
 * THE TRAPS IN THIS PARTICULAR ALTER (both hit during writing)
 * -----------------------------------------------------------
 * 1. **The FK on batch_id must go before the column.** InnoDB will not drop a
 *    column a foreign key still names (`teacher_subjects_ibfk_3` → batches).
 *
 * 2. **Dropping the PRIMARY KEY and adding the new one must be ONE statement.**
 *    `teacher_subjects_ibfk_1` (teacher_id → teachers) is backed by nothing but
 *    the leading column of the PRIMARY KEY, and InnoDB refuses to drop the only
 *    index backing an FK. In a single ALTER it sees the replacement key — which
 *    also leads with teacher_id — and allows it. Split across two statements it
 *    fails with errno 150. (Same trap as `…093000`, different table.)
 *
 * Collapsing the key can merge rows, so duplicates are removed first. On this
 * database that is a no-op — 41 rows in, 41 distinct (teacher, subject) — but
 * the delete is written anyway, because the migration has to be correct on a
 * database it has not seen.
 *
 * Sequelize migrations are not transactional (see `…093000`), so every step
 * below is idempotent and re-running a half-applied migration is safe.
 *
 * DOWN IS LOSSY, AND SAYS SO
 * --------------------------
 * The batch a qualification was once scoped to is not recoverable — that is the
 * whole point of dropping it. `down` restores the shape so the schema can move
 * backwards, and backfills every row with the teacher's earliest real batch so
 * the NOT NULL key can be rebuilt. It does not restore the old meaning.
 */

const TABLE = "teacher_subjects";
const COLUMN = "batch_id";
const FK = "teacher_subjects_ibfk_3";

/* Whether `column` still exists on `teacher_subjects`. */
const hasColumn = async (sequelize, column) => {
    const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS n
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = '${TABLE}'
            AND column_name = '${column}'`
    );

    return Number(rows[0].n) > 0;
};

/* Whether a foreign key of this name is still attached. */
const hasForeignKey = async (sequelize, name) => {
    const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS n
           FROM information_schema.table_constraints
          WHERE table_schema = DATABASE()
            AND table_name = '${TABLE}'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name = '${name}'`
    );

    return Number(rows[0].n) > 0;
};

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        if (!(await hasColumn(sequelize, COLUMN))) {
            // Already applied. Nothing to do, and nothing to complain about.
            return;
        }

        /*
         * Step 1 — the foreign key, before anything else touches the column.
         *
         * Named explicitly rather than discovered, because the name is
         * deterministic here (InnoDB's ibfk_N ordering) and a discovery query
         * that returned the wrong constraint would drop the wrong FK.
         */
        if (await hasForeignKey(sequelize, FK)) {
            await sequelize.query(
                `ALTER TABLE ${TABLE} DROP FOREIGN KEY ${FK}`
            );
        }

        /*
         * Step 2 — collapse duplicates before the key that permits them goes.
         *
         * A teacher recorded as qualified for the same subject against three
         * batches becomes one row. The lowest batch_id survives; which one it
         * is does not matter, since the column is about to be deleted. The
         * self-join form is used because MySQL will not let a DELETE read the
         * table it is deleting from inside a subquery.
         */
        await sequelize.query(
            `DELETE dup FROM ${TABLE} dup
               JOIN ${TABLE} keep
                 ON keep.teacher_id = dup.teacher_id
                AND keep.subject_id = dup.subject_id
                AND keep.${COLUMN}  < dup.${COLUMN}`
        );

        /*
         * Step 3 — the key and the column together, in one statement.
         *
         * See trap 2 in the header: separating these fails with errno 150,
         * because teacher_id would be momentarily unindexed while an FK still
         * points at it.
         */
        await sequelize.query(
            `ALTER TABLE ${TABLE}
               DROP PRIMARY KEY,
               ADD PRIMARY KEY (teacher_id, subject_id),
               DROP COLUMN ${COLUMN}`
        );
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;

        if (await hasColumn(sequelize, COLUMN)) return;

        /*
         * Added nullable first. The rows have no batch — that information was
         * deliberately destroyed — so a NOT NULL column cannot be added until
         * after the backfill below.
         */
        await sequelize.query(
            `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} INT NULL`
        );

        /*
         * Backfill: the earliest batch of the programme that owns the subject.
         * This is a fabrication, and the only defensible one available — it at
         * least keeps every row pointing at a batch that could plausibly have
         * been taught this subject, so the FK will hold.
         */
        await sequelize.query(
            `UPDATE ${TABLE} ts
               JOIN subjects  sub ON sub.subject_id  = ts.subject_id
               JOIN semesters sem ON sem.semester_id = sub.semester_id
               SET ts.${COLUMN} = (
                   SELECT b.batch_id FROM batches b
                    WHERE b.program_id = sem.program_id AND b.is_deleted = 0
                    ORDER BY b.start_year, b.batch_id
                    LIMIT 1
               )`
        );

        // Anything the backfill could not resolve cannot take part in a
        // NOT NULL key, and a fabricated row is worse than a missing one.
        await sequelize.query(
            `DELETE FROM ${TABLE} WHERE ${COLUMN} IS NULL`
        );

        await sequelize.query(
            `ALTER TABLE ${TABLE}
               MODIFY COLUMN ${COLUMN} INT NOT NULL,
               DROP PRIMARY KEY,
               ADD PRIMARY KEY (teacher_id, subject_id, ${COLUMN})`
        );

        await sequelize.query(
            `ALTER TABLE ${TABLE}
               ADD CONSTRAINT ${FK} FOREIGN KEY (${COLUMN})
               REFERENCES batches (batch_id)`
        );
    }
};
