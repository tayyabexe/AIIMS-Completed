"use strict";

/*
 * Academic terms: the calendar dimension the schema was missing.
 *
 * WHY THIS TABLE EXISTS
 * ---------------------
 * `semesters` is keyed on (program_id, semester_number) and `subjects` hangs
 * off it, so a semester row is a *curriculum stage* — "the third semester of
 * BSCS", the one that teaches these six subjects. It is not a point in time,
 * even though it carries start_date/end_date: batch 2023 and batch 2024 both
 * pass through that same single row, two years apart.
 *
 * That collapse is harmless while the system only ever describes the present.
 * It stops being harmless the moment anything needs to be true *of a year*:
 *
 *   - Last year's timetable cannot be kept, because "Section A, semester 3"
 *     is one key and the new year overwrites it.
 *   - A retake cannot be recorded, because a student re-sitting a subject
 *     produces a second enrollment row with an identical (student, subject,
 *     semester) — which the unique index refuses.
 *   - A fee cannot change between intakes, because fee_structures keys on
 *     semester_id and there is only one row per stage, forever.
 *
 * So the stage stays where it is and the calendar moves here. `semesters`
 * answers "what is taught"; `academic_terms` answers "when, and to whom".
 * Course offerings, and through them the timetable, are scoped to a term.
 *
 * WHY THE DATES STAY ON `semesters` TOO
 * -------------------------------------
 * They are wrong in principle and load-bearing in practice — reporting views,
 * the assistant's SQL catalogue and several portal queries read them. Removing
 * them is a separate change with its own blast radius; this migration does not
 * pretend to make it. They are left as the curriculum's nominal dates and
 * nothing new is taught to read them.
 *
 * THE BACKFILL TERM
 * -----------------
 * Every existing enrollment and timetable row belongs to *some* term, and
 * until this migration ran there was nowhere to say which. They are all
 * assigned to a single seeded current term rather than left NULL, because a
 * NULL term_id on an offering would mean "scheduled in no year", which no
 * query can sensibly filter and which would quietly drop those rows out of
 * every term-scoped screen.
 */

// The term the existing data is adopted into. Dated to span the current
// academic year so the seeded rows resolve as "now" rather than as history.
const BACKFILL_TERM = {
  term_code: "FALL-2026",
  term_name: "Fall 2026",
  start_date: "2026-08-01",
  end_date: "2026-12-31",
  status: "Active",
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable("academic_terms", {
      term_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // Stable machine-facing handle ("FALL-2026"). Unique, and what an
      // import or an integration keys on, so the display name stays free to
      // be corrected without breaking anything that referenced it.
      term_code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },

      term_name: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },

      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      /*
       * Planned   - being built. Offerings may be created and the timetable
       *             edited freely; students are not enrolled yet.
       * Active    - in progress. Enrollment and attendance are live; the
       *             timetable is editable but every edit is a real change to
       *             a class that is already running.
       * Closed    - finished. Read-only. Results are final and the timetable
       *             is kept as the historical record of what was taught.
       *
       * Cancelled is deliberately absent: a term that did not happen is
       * deleted while Planned, and one that did happen cannot be un-happened.
       */
      status: {
        type: DataTypes.ENUM("Planned", "Active", "Closed"),
        allowNull: false,
        defaultValue: "Planned",
      },

      is_deleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // The common filter is "the term that is running now", and the common
    // sort is reverse-chronological.
    await queryInterface.addIndex("academic_terms", ["status", "is_deleted"], {
      name: "idx_academic_terms_status",
    });

    await queryInterface.addIndex("academic_terms", ["start_date"], {
      name: "idx_academic_terms_start",
    });

    // Seeded here rather than in a seeder: the migrations that follow depend
    // on a term existing to backfill into, and seeders are not guaranteed to
    // have run.
    await queryInterface.bulkInsert("academic_terms", [
      { ...BACKFILL_TERM, is_deleted: false },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("academic_terms");
  },
};
