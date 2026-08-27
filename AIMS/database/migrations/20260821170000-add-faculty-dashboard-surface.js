"use strict";

/*
 * A fourth pinnable surface: the faculty portal's own dashboard.
 *
 * WHY THIS IS A SEPARATE SURFACE FROM 'faculty_insights'
 * ------------------------------------------------------
 * They are two different screens with two different jobs, and a card belongs
 * to one of them. 'faculty_insights' is the board under Ask the Data, which
 * ships empty and holds only what a teacher pinned. This one is the teacher's
 * landing screen, which ships with ten built-in panels — their class count,
 * their roster size, today's timetable, their own grade distribution.
 *
 * Sharing one surface between the two would mean a card pinned on Ask the Data
 * silently appearing on the dashboard, and the built-in panels appearing on a
 * board whose whole point is that it starts empty. Two boards, two rows in
 * SURFACES_BY_SCOPE, arranged independently.
 *
 * WHY THE BUILT-INS HERE ARE SAFE WHERE THE ADMIN ONES WERE NOT
 * -------------------------------------------------------------
 * The reason 'faculty_insights' ships with no built-ins is that every admin
 * panel is an institute-wide figure a teacher may not see. That objection does
 * not apply here: these ten panels are the faculty dashboard's OWN panels,
 * already served by GET /api/faculty/dashboard, which resolves the teacher
 * from their token and counts only their roster. Nothing new is exposed —
 * the same figures the screen already drew become individually arrangeable.
 *
 * WHY THE COLUMN STAYS AN ENUM
 * ----------------------------
 * Same reason as migration 20260821140000: a VARCHAR would let a new board
 * ship without a matching entry in config/dashboardCards.js and a matching row
 * in SURFACES_BY_SCOPE. The ENUM makes the database refuse a surface the
 * application has not declared.
 */

const OLD = "ENUM('dashboard', 'ai_insights', 'faculty_insights')";
const NEW = "ENUM('dashboard', 'ai_insights', 'faculty_insights', 'faculty_dashboard')";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE analytics_dashboard_cards MODIFY COLUMN surface ${NEW} NOT NULL`
    );
  },

  async down(queryInterface) {
    /*
     * The faculty dashboard rows have nowhere to live under the narrower ENUM,
     * and MySQL would coerce them to '' rather than fail. They go first, so
     * the narrowing is explicit about what it discards instead of silently
     * corrupting the column.
     */
    await queryInterface.sequelize.query(
      "DELETE FROM analytics_dashboard_cards WHERE surface = 'faculty_dashboard'"
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE analytics_dashboard_cards MODIFY COLUMN surface ${OLD} NOT NULL`
    );
  },
};
