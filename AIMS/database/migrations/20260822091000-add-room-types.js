"use strict";

/*
 * Room typing: teaching what "Lab 1" means to something other than a human.
 *
 * `classrooms` stored room_name, building and capacity, so "Lab 1" and "401"
 * were the same kind of thing to every query that touched them — a string.
 * Nothing could refuse to timetable a practical into a lecture theatre,
 * because nothing knew which was which. An admin who knew the estate could
 * avoid it; a scheduler could not.
 *
 * Two columns fix that from both ends: what a room *is*, and what a subject
 * *needs*. The scheduler then has a rule it can check instead of a convention
 * it has to be told about.
 *
 * WHY `required_room_type` IS NULLABLE
 * ------------------------------------
 * NULL means "any room will do", which is true of most subjects and is the
 * honest default for every row that exists today. The alternative — an 'Any'
 * enum member — would have made the column look decided when it was really
 * just unset, and would have hidden the subjects nobody has classified yet.
 * NULL is greppable; 'Any' is not.
 *
 * THE BACKFILL IS A GUESS, AND SAYS SO
 * ------------------------------------
 * Rooms are typed by name, because the name is the only evidence there is:
 * anything matching 'lab' becomes a Lab, everything else stays a Lecture room.
 * That is right for the seeded estate and will be wrong for any room named
 * without the word. It is left for an admin to correct in Academic Structure
 * rather than guessed harder — a wrong type that is visible and editable beats
 * a cleverer rule that is wrong in a way nobody notices.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn("classrooms", "room_type", {
      type: DataTypes.ENUM("Lecture", "Lab", "Auditorium", "Seminar"),
      allowNull: false,
      defaultValue: "Lecture",
    });

    await queryInterface.addColumn("subjects", "required_room_type", {
      // NULL = no requirement. See the note above.
      type: DataTypes.ENUM("Lecture", "Lab", "Auditorium", "Seminar"),
      allowNull: true,
      defaultValue: null,
    });

    /*
     * How many times a week a class in this subject meets. It lives on the
     * subject as the curriculum's default; an individual offering may override
     * it, because one section can legitimately need an extra session while the
     * subject itself has not changed.
     *
     * Seeded from credit hours, which is the convention the timetable already
     * follows in practice: a 3-credit subject meets twice on the 90-minute
     * grid (3 hours), a 1- or 2-credit subject once.
     */
    await queryInterface.addColumn("subjects", "sessions_per_week", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
    });

    await queryInterface.sequelize.query(
      `UPDATE classrooms
          SET room_type = 'Lab'
        WHERE LOWER(room_name) LIKE '%lab%'`
    );

    await queryInterface.sequelize.query(
      `UPDATE classrooms
          SET room_type = 'Auditorium'
        WHERE LOWER(room_name) LIKE '%auditorium%'
           OR LOWER(room_name) LIKE '%hall%'`
    );

    // A subject whose name says it is a practical needs a practical room.
    await queryInterface.sequelize.query(
      `UPDATE subjects
          SET required_room_type = 'Lab'
        WHERE LOWER(subject_name) LIKE '%lab%'
           OR LOWER(subject_name) LIKE '%practical%'`
    );

    await queryInterface.sequelize.query(
      `UPDATE subjects
          SET sessions_per_week = CASE
              WHEN credit_hours >= 3 THEN 2
              ELSE 1
          END`
    );

    // The scheduler's hot path asks "which rooms of this type seat at least
    // N?", so type and capacity are indexed together.
    await queryInterface.addIndex("classrooms", ["room_type", "capacity"], {
      name: "idx_classrooms_type_capacity",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("classrooms", "idx_classrooms_type_capacity");
    await queryInterface.removeColumn("subjects", "sessions_per_week");
    await queryInterface.removeColumn("subjects", "required_room_type");
    await queryInterface.removeColumn("classrooms", "room_type");
  },
};
