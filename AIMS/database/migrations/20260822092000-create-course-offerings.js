"use strict";

/*
 * Course offerings: the spine that was missing.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The schema had two halves that never met.
 *
 *   delivery:  batches -> sections -> students.section_id -> timetables
 *   academics: students -> enrollments -> subjects -> semesters
 *
 * `enrollments` carried no section and no teacher. `teacher_subjects` was
 * (teacher, subject, batch) - an entire batch, not one section. So the
 * question "which teacher teaches this student this subject" had no join that
 * answered it. The only available inference was to look at the timetable of
 * the student's section, which is wrong in both directions: a section's
 * timetable lists subjects a given student may not be enrolled in, and it
 * cannot distinguish a student who dropped the course from one who did not.
 *
 * Worse, nothing bound the teacher of a class. Every timetable row carried its
 * own teacher_id independently, so CS-101 for section A could legitimately say
 * Teacher X on Monday and Teacher Y on Wednesday. There was no row anywhere
 * asserting who taught the course - only rows asserting who stood in a room at
 * a time.
 *
 * An offering is that missing assertion: *this section studies this subject
 * with this teacher in this term*. It is one row per class, and it exists
 * before any of the class's meetings are placed on the grid.
 *
 * WHAT HANGS OFF IT
 * -----------------
 *   timetables  - a row becomes one weekly *meeting* of an offering. The
 *                 teacher, section and subject stop being independent facts
 *                 per row and start being properties of the class.
 *   enrollments - a student joins an offering, so the roster of a class and
 *                 the courses of a student are two directions of one join.
 *
 * WHAT `teacher_subjects` BECOMES
 * -------------------------------
 * Eligibility, not assignment. It says who *may* teach a subject to a batch -
 * a qualification. The offering says who *does*. That distinction is what lets
 * the scheduler offer a shortlist of qualified teachers instead of the whole
 * faculty, while keeping the actual decision recorded in one place.
 *
 * WHY THE TEACHER IS NULLABLE
 * ---------------------------
 * Offerings are created when a term is planned, which is usually before
 * teaching load is allocated. An offering with no teacher is a class that
 * exists and is not yet staffed - a state worth being able to represent and
 * report on. It simply cannot be scheduled: `timetables.teacher_id` is NOT
 * NULL, so placing a meeting requires the teacher to have been decided first.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable("course_offerings", {
      offering_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      term_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academic_terms", key: "term_id" },
        // RESTRICT: a term with classes in it is not something to delete by
        // accident. Closing it is the supported way to retire a term.
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },

      section_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "sections", key: "section_id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },

      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "subjects", key: "subject_id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },

      // NULL = the class exists but is not staffed yet. See the note above.
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "teachers", key: "teacher_id" },
        // SET NULL, not CASCADE: a teacher leaving unstaffs the class, it does
        // not delete the class or the enrollments and attendance behind it.
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      /*
       * How many meetings a week this class needs on the grid. Seeded from
       * subjects.sessions_per_week and overridable per offering.
       *
       * This is the scheduler's target: an offering is fully scheduled when it
       * has exactly this many timetable rows. It is what makes "what is left
       * to place" answerable, rather than the admin having to remember.
       */
      sessions_per_week: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 2,
      },

      /*
       * Copied from subjects.required_room_type when the offering is created,
       * and overridable. The copy is deliberate: the curriculum's requirement
       * can change later, and that must not silently invalidate a timetable
       * that was already built and taught against the old rule.
       */
      required_room_type: {
        type: DataTypes.ENUM("Lecture", "Lab", "Auditorium", "Seminar"),
        allowNull: true,
        defaultValue: null,
      },

      /*
       * Seat cap for the class. NULL = the section's own size governs, which
       * is the normal case under cohort enrolment. It exists for the case
       * where a room or a piece of equipment caps the class below the section.
       */
      max_seats: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      /*
       * Draft     - created, not yet fully placed on the grid.
       * Scheduled - has all sessions_per_week meetings placed.
       * Active    - being taught. Set when the term goes Active.
       * Completed - finished; kept as the record of what was taught.
       * Cancelled - will not run. Kept rather than deleted so enrollments that
       *             referenced it still resolve.
       */
      status: {
        type: DataTypes.ENUM("Draft", "Scheduled", "Active", "Completed", "Cancelled"),
        allowNull: false,
        defaultValue: "Draft",
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

    /*
     * One class per (term, section, subject). This is the constraint that
     * makes an offering *the* answer to "who teaches section A CS-101 this
     * term" rather than one of several possible answers - and it is exactly
     * the guarantee the old per-row teacher_id could not give.
     *
     * The term is in the key, so the same section studying the same subject
     * again next year is a different offering, not a duplicate.
     */
    await queryInterface.addIndex(
      "course_offerings",
      ["term_id", "section_id", "subject_id"],
      { name: "uq_offering_term_section_subject", unique: true }
    );

    // "What is this teacher's load this term", asked by the faculty portal and
    // by the scheduler before it offers a teacher for a slot.
    await queryInterface.addIndex("course_offerings", ["teacher_id", "term_id"], {
      name: "idx_offering_teacher_term",
    });

    // "Everything running this term", the admin timetable screen's base query.
    await queryInterface.addIndex("course_offerings", ["term_id", "status", "is_deleted"], {
      name: "idx_offering_term_status",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("course_offerings");
  },
};
