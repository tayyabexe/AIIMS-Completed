"use strict";

/*
 * Hangs the two existing halves of the schema off `course_offerings`, and
 * adopts every row that already exists into an offering.
 *
 * WHAT CHANGES SHAPE
 * ------------------
 *   timetables.offering_id   - the class this weekly meeting belongs to.
 *   enrollments.offering_id  - the class this student joined.
 *   enrollments.term_id      - which year they took it in.
 *
 * WHY `timetables` KEEPS section_id / subject_id / teacher_id
 * -----------------------------------------------------------
 * They are now derived - an offering already knows all three - and dropping
 * them would be the structurally correct move. They stay because the cost of
 * removing them is paid by things that have nothing to do with scheduling:
 * vw_student_timetable and the other reporting views select them by name, the
 * assistant's SQL catalogue exposes them as queryable columns, and the three
 * unique indexes that make double-booking impossible
 * (20260807120000-enforce-timetable-slot-grid.js) are built on section_id,
 * teacher_id and classroom_id directly.
 *
 * Those indexes are the single most valuable guarantee in this module, and
 * they are enforced by the database rather than by anything that can be
 * forgotten. Normalising the columns away would mean rebuilding them as
 * expression indexes over a join, which MySQL cannot do - the guarantee would
 * have had to move into application code to buy a tidier table. That trade is
 * the wrong way round.
 *
 * So the columns stay as a denormalised copy, kept in step with the offering
 * by the service layer, and this migration adds a CHECK-equivalent in the only
 * form MySQL offers cheaply: the backfill below makes them consistent, and
 * courseOfferingService is the only writer from here on.
 *
 * THE ADOPTION PASS
 * -----------------
 * Existing timetable rows are the only evidence of which classes exist, so
 * offerings are reconstructed from them: every distinct (section, subject)
 * pair becomes one offering, its sessions_per_week set to however many
 * meetings that pair actually has, and its teacher taken from the pair's
 * earliest row.
 *
 * That last choice matters. Where a pair's rows disagreed about the teacher -
 * exactly the inconsistency offerings exist to prevent - one of them has to
 * win. The earliest row wins because it is deterministic and re-runnable; the
 * losing rows are reported by name rather than silently rewritten, because
 * rewriting a teacher can collide with the teacher/day/slot unique index and
 * because a human should see that the data disagreed.
 */

/*
 * ON RESUMABILITY
 * ---------------
 * Sequelize does not wrap a migration in a transaction, so a failure partway
 * leaves the steps that already ran applied while the migration itself is
 * still recorded as pending. Re-running it then fails on "duplicate column"
 * long before reaching whatever actually broke - and the only way forward is
 * to unpick the partial state by hand against a live database.
 *
 * This one does enough work in enough separate statements that the odds of
 * that are not academic, so every step checks whether it has already been done
 * and skips it if so. Re-running is safe, and picks up where it stopped.
 */

const BACKFILL_TERM_CODE = "FALL-2026";

const hasColumn = async (queryInterface, table, column) => {
  const describe = await queryInterface.describeTable(table);
  return Object.prototype.hasOwnProperty.call(describe, column);
};

const indexNames = async (queryInterface, table) => {
  const indexes = await queryInterface.showIndex(table);
  return new Set(indexes.map((i) => i.name));
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const { sequelize } = queryInterface;

    const select = (sql, replacements) =>
      sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    // ------------------------------------------------------------- columns --

    if (!(await hasColumn(queryInterface, "timetables", "offering_id"))) {
      await queryInterface.addColumn("timetables", "offering_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "course_offerings", key: "offering_id" },
      // Deleting a class deletes its meetings. That is the point of the link:
      // a timetable row with no class behind it is not a thing.
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      });
    }

    if (!(await hasColumn(queryInterface, "enrollments", "offering_id"))) {
      await queryInterface.addColumn("enrollments", "offering_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "course_offerings", key: "offering_id" },
      // SET NULL rather than CASCADE: a cancelled class must not erase the
      // record that a student was enrolled in it, which attendance and marks
      // may still reference.
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      });
    }

    if (!(await hasColumn(queryInterface, "enrollments", "term_id"))) {
      await queryInterface.addColumn("enrollments", "term_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "academic_terms", key: "term_id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      });
    }

    // ---------------------------------------------------------- the term ----

    const [term] = await select(
      "SELECT term_id FROM academic_terms WHERE term_code = :code LIMIT 1",
      { code: BACKFILL_TERM_CODE }
    );

    if (!term) {
      throw new Error(
        `Backfill term ${BACKFILL_TERM_CODE} is missing. ` +
          "20260822090000-create-academic-terms.js must run first."
      );
    }

    const termId = term.term_id;

    // ------------------------------------------------- reconstruct classes --

    // Grouped in SQL rather than in JS so the meeting count and the earliest
    // row's id come back already resolved, and so this stays one round trip
    // against a remote database.
    const pairs = await select(
      `SELECT t.section_id,
              t.subject_id,
              COUNT(*)              AS meetings,
              MIN(t.timetable_id)   AS first_row_id,
              COUNT(DISTINCT t.teacher_id) AS distinct_teachers
         FROM timetables t
        GROUP BY t.section_id, t.subject_id
        ORDER BY t.section_id, t.subject_id`
    );

    for (const pair of pairs) {
      // Already adopted on a previous, partly-completed run.
      const [existing] = await select(
        `SELECT offering_id FROM course_offerings
          WHERE term_id = :termId AND section_id = :sectionId
            AND subject_id = :subjectId
          LIMIT 1`,
        { termId, sectionId: pair.section_id, subjectId: pair.subject_id }
      );

      if (existing) continue;

      // The teacher of the pair's earliest meeting. See the note above.
      const [anchor] = await select(
        "SELECT teacher_id FROM timetables WHERE timetable_id = :id",
        { id: pair.first_row_id }
      );

      const [subject] = await select(
        `SELECT required_room_type, sessions_per_week
           FROM subjects WHERE subject_id = :id`,
        { id: pair.subject_id }
      );

      await sequelize.query(
        `INSERT INTO course_offerings
              (term_id, section_id, subject_id, teacher_id,
               sessions_per_week, required_room_type, status, is_deleted)
         VALUES (:termId, :sectionId, :subjectId, :teacherId,
                 :sessions, :roomType, 'Scheduled', 0)`,
        {
          replacements: {
            termId,
            sectionId: pair.section_id,
            subjectId: pair.subject_id,
            teacherId: anchor ? anchor.teacher_id : null,
            // What the class actually has on the grid, not what the
            // curriculum says it should have - the adopted timetable is the
            // ground truth here, and marking a fully-placed class as short of
            // sessions would send the scheduler hunting for meetings that are
            // not missing.
            sessions: Number(pair.meetings),
            roomType: subject ? subject.required_room_type : null,
          },
        }
      );

      if (Number(pair.distinct_teachers) > 1) {
        console.warn(
          `[link-offerings] section ${pair.section_id} / subject ${pair.subject_id} ` +
            `had ${pair.distinct_teachers} different teachers across its ` +
            `timetable rows. The offering records the teacher of row ` +
            `${pair.first_row_id}; the other rows are left as they are and ` +
            `should be reviewed in Timetable Management.`
        );
      }
    }

    // --------------------------------------------------------- link them ----

    await sequelize.query(
      `UPDATE timetables t
         JOIN course_offerings o
           ON o.section_id = t.section_id
          AND o.subject_id = t.subject_id
          AND o.term_id    = :termId
          SET t.offering_id = o.offering_id`,
      { replacements: { termId } }
    );

    /*
     * An enrollment joins the offering for the subject it names, in the
     * section its student sits in. A student with no section, or a subject
     * whose section never had it timetabled, matches nothing and is left with
     * a NULL offering_id - visible, and reported below, rather than forced
     * into an arbitrary class.
     */
    await sequelize.query(
      `UPDATE enrollments e
         JOIN students s
           ON s.student_id = e.student_id
         JOIN course_offerings o
           ON o.section_id = s.section_id
          AND o.subject_id = e.subject_id
          AND o.term_id    = :termId
          SET e.offering_id = o.offering_id`,
      { replacements: { termId } }
    );

    // Every enrollment belongs to a term even when its class could not be
    // identified, so the uniqueness rule below has a non-NULL value to key on.
    await sequelize.query(
      "UPDATE enrollments SET term_id = :termId WHERE term_id IS NULL",
      { replacements: { termId } }
    );

    const [orphans] = await select(
      "SELECT COUNT(*) AS n FROM enrollments WHERE offering_id IS NULL"
    );

    if (Number(orphans.n) > 0) {
      console.warn(
        `[link-offerings] ${orphans.n} enrollment(s) could not be matched to a ` +
          "course offering - their student has no section, or the section has " +
          "no timetabled meetings for that subject. They keep their subject " +
          "and semester and will resolve once the class is created."
      );
    }

    await queryInterface.changeColumn("enrollments", "term_id", {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "academic_terms", key: "term_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });

    // ----------------------------------------------------- retakes, at last --

    /*
     * `uq_enrollment_once` was (student, subject, semester), and since a
     * semester row is a curriculum stage shared by every batch, it said a
     * student may never take a subject twice - ever. A retake was
     * unrepresentable, and so was the same subject appearing in two years.
     *
     * The term joins the key. Taking CS-101 twice in one term is still
     * refused, which is the rule that was actually wanted; taking it again
     * next year is now simply a different row.
     */
    /*
     * InnoDB refuses to drop the only index backing a foreign key, and
     * `uq_enrollment_once` is exactly that for student_id: it leads with the
     * column, so no separate index was ever auto-created for it. (subject_id
     * and semester_id are not leftmost, so they each got their own and are
     * fine.) Dropping the constraint first fails with "needed in a foreign key
     * constraint" - the same trap
     * 20260822094000-scope-timetable-uniqueness-to-term.js documents hitting
     * on teacher_id and classroom_id.
     *
     * So the FK is given its own index first. It is not redundant afterwards:
     * the replacement unique constraint below also leads with student_id, but
     * "the student's enrollments" is the single commonest query in the module
     * and deserves the narrower index regardless.
     */
    const enrollmentIndexes = await indexNames(queryInterface, "enrollments");

    if (!enrollmentIndexes.has("idx_enrollments_student_fk")) {
      await queryInterface.addIndex("enrollments", ["student_id"], {
        name: "idx_enrollments_student_fk",
      });
    }

    if (enrollmentIndexes.has("uq_enrollment_once")) {
      await queryInterface.removeConstraint("enrollments", "uq_enrollment_once");
    }

    if (!enrollmentIndexes.has("uq_enrollment_once_per_term")) {
      await queryInterface.addConstraint("enrollments", {
        fields: ["student_id", "subject_id", "semester_id", "term_id"],
        type: "unique",
        name: "uq_enrollment_once_per_term",
      });
    }

    // The class roster: "every student in this offering", which is the query
    // the faculty portal and attendance both open with.
    if (!enrollmentIndexes.has("idx_enrollments_offering")) {
      await queryInterface.addIndex("enrollments", ["offering_id", "status"], {
        name: "idx_enrollments_offering",
      });
    }

    if (!(await indexNames(queryInterface, "timetables")).has("idx_timetables_offering")) {
      await queryInterface.addIndex("timetables", ["offering_id"], {
        name: "idx_timetables_offering",
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.removeIndex("timetables", "idx_timetables_offering");
    await queryInterface.removeIndex("enrollments", "idx_enrollments_offering");

    await queryInterface.removeConstraint("enrollments", "uq_enrollment_once_per_term");

    /*
     * Restoring the old constraint can fail, and that is correct rather than a
     * bug to work around: if a retake was recorded while it was lifted, the
     * old rule is no longer true of the data and forcing it back would mean
     * deleting a real enrollment. The error names the rows to resolve.
     */
    await queryInterface.addConstraint("enrollments", {
      fields: ["student_id", "subject_id", "semester_id"],
      type: "unique",
      name: "uq_enrollment_once",
    });

    // Nullable again first, so dropping the term column cannot trip the NOT
    // NULL on a partially-applied down().
    await queryInterface.changeColumn("enrollments", "term_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });

    await queryInterface.removeIndex("enrollments", "idx_enrollments_student_fk");
    await queryInterface.removeColumn("enrollments", "term_id");
    await queryInterface.removeColumn("enrollments", "offering_id");
    await queryInterface.removeColumn("timetables", "offering_id");
  },
};
