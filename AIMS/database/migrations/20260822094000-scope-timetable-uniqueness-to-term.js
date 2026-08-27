"use strict";

/*
 * Puts the term into the timetable's uniqueness rules.
 *
 * WHY
 * ---
 * 20260807120000-enforce-timetable-slot-grid.js added the three constraints
 * that make double-booking impossible:
 *
 *   uq_timetable_section_slot    (section_id,   day_of_week, start_time)
 *   uq_timetable_teacher_slot    (teacher_id,   day_of_week, start_time)
 *   uq_timetable_classroom_slot  (classroom_id, day_of_week, start_time)
 *
 * They are the most valuable guarantee in this module and they are enforced by
 * the database rather than by code that can be forgotten. But they are global:
 * they say room 401 is booked on Monday at 08:30 *ever*, not *this term*.
 *
 * That was true enough while the schema had no notion of a year. Now that it
 * does, the rules say something stronger than intended, and two things
 * ordinary universities do become impossible:
 *
 *   - Planning next term while this one runs. Every draft placement collides
 *     with the live timetable, so a Planned term cannot be built at all.
 *   - Keeping a term after it closes. The only way to free the grid for next
 *     year is to delete last year's rows - which is exactly the history that
 *     academic_terms was introduced to preserve.
 *
 * Adding term_id to each index restores the intended meaning: one section, one
 * teacher and one room can each be in one place per period *within a term*.
 * Across terms they are free, which is what a calendar year is for.
 *
 * WHY term_id IS DENORMALISED ONTO `timetables`
 * ---------------------------------------------
 * The offering already knows its term, so this column is redundant data. It
 * has to exist anyway: a MySQL index can only be built over columns of the
 * table it belongs to, so the constraint cannot reach through offering_id to
 * find the term. The choice is a denormalised column or no database-level
 * guarantee, and the guarantee is worth more.
 *
 * THE FOREIGN-KEY INDEX TRAP
 * --------------------------
 * InnoDB refuses to drop the only index backing a foreign key. Once
 * uq_timetable_teacher_slot is replaced by an index whose *leading* column is
 * term_id, teacher_id is no longer leftmost anywhere and the drop fails with
 * "needed in a foreign key constraint". The same applies to classroom_id.
 * (section_id survives either way - idx_timetables_section_schedule from
 * 20260729100002 still leads with it.)
 *
 * So plain single-column indexes are added back first, and only then are the
 * old constraints dropped. This is the same trap that migration's own down()
 * documents hitting.
 */

const BACKFILL_TERM_CODE = "FALL-2026";

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const { sequelize } = queryInterface;

    const [term] = await sequelize.query(
      "SELECT term_id FROM academic_terms WHERE term_code = :code LIMIT 1",
      { type: Sequelize.QueryTypes.SELECT, replacements: { code: BACKFILL_TERM_CODE } }
    );

    if (!term) {
      throw new Error(
        `Backfill term ${BACKFILL_TERM_CODE} is missing. ` +
          "20260822090000-create-academic-terms.js must run first."
      );
    }

    await queryInterface.addColumn("timetables", "term_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "academic_terms", key: "term_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });

    // Prefer the offering's own term; fall back to the backfill term for any
    // row the adoption pass could not link (it linked all of them, but a row
    // inserted between the two migrations would not be).
    await sequelize.query(
      `UPDATE timetables t
    LEFT JOIN course_offerings o ON o.offering_id = t.offering_id
          SET t.term_id = COALESCE(o.term_id, :fallback)`,
      { replacements: { fallback: term.term_id } }
    );

    await queryInterface.changeColumn("timetables", "term_id", {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "academic_terms", key: "term_id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });

    // Keep the FKs backed before the old constraints come off. See above.
    await queryInterface.addIndex("timetables", ["teacher_id"], {
      name: "idx_timetables_teacher_fk",
    });

    await queryInterface.addIndex("timetables", ["classroom_id"], {
      name: "idx_timetables_classroom_fk",
    });

    await queryInterface.removeIndex("timetables", "uq_timetable_section_slot");
    await queryInterface.removeIndex("timetables", "uq_timetable_teacher_slot");
    await queryInterface.removeIndex("timetables", "uq_timetable_classroom_slot");

    // term_id leads, so "everything in this term" is also served by these.
    await queryInterface.addIndex(
      "timetables",
      ["term_id", "section_id", "day_of_week", "start_time"],
      { name: "uq_timetable_section_slot", unique: true }
    );

    await queryInterface.addIndex(
      "timetables",
      ["term_id", "teacher_id", "day_of_week", "start_time"],
      { name: "uq_timetable_teacher_slot", unique: true }
    );

    await queryInterface.addIndex(
      "timetables",
      ["term_id", "classroom_id", "day_of_week", "start_time"],
      { name: "uq_timetable_classroom_slot", unique: true }
    );
  },

  async down(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.removeIndex("timetables", "uq_timetable_section_slot");
    await queryInterface.removeIndex("timetables", "uq_timetable_teacher_slot");
    await queryInterface.removeIndex("timetables", "uq_timetable_classroom_slot");

    /*
     * Restoring the global constraints can fail, and correctly so: if more
     * than one term has been timetabled while they were term-scoped, the
     * global rule is no longer true of the data. Forcing it back would mean
     * deleting a real term's grid, so the error is left to surface.
     */
    await queryInterface.addIndex("timetables", ["section_id", "day_of_week", "start_time"], {
      name: "uq_timetable_section_slot",
      unique: true,
    });

    await queryInterface.addIndex("timetables", ["teacher_id", "day_of_week", "start_time"], {
      name: "uq_timetable_teacher_slot",
      unique: true,
    });

    await queryInterface.addIndex("timetables", ["classroom_id", "day_of_week", "start_time"], {
      name: "uq_timetable_classroom_slot",
      unique: true,
    });

    // Now redundant again - the restored constraints lead with these columns.
    await queryInterface.removeIndex("timetables", "idx_timetables_teacher_fk");
    await queryInterface.removeIndex("timetables", "idx_timetables_classroom_fk");

    await queryInterface.changeColumn("timetables", "term_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });

    await queryInterface.removeColumn("timetables", "term_id");
  },
};
