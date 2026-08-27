"use strict";

/*
 * A fifth pinnable surface: the Attendance screen's analytics board.
 *
 * WHY THE ANALYTICS SECTION AND NOT THE WHOLE SCREEN
 * --------------------------------------------------
 * The top of the Attendance screen is a task, not a board. A teacher picks a
 * class, marks a register and presses Submit, in that order, and the order is
 * the point — a Submit button that can be dragged away from the table it
 * submits is a hazard, not a customisation. Everything above the analytics
 * heading therefore stays exactly where it is.
 *
 * What sits BELOW that heading is a different kind of thing: six read-only
 * summaries of the same trend response, none of which is a step in the task.
 * Which of them a teacher wants first is genuinely personal — one wants the
 * late-arrival count because they chase punctuality, another only ever looks
 * at the trend line. That is a board.
 *
 * WHY IT IS A SEPARATE SURFACE FROM 'faculty_dashboard'
 * -----------------------------------------------------
 * Same reasoning as migration 20260821170000 gives for splitting the dashboard
 * off from 'faculty_insights'. These panels are scoped to ONE class and ONE
 * period — they change when the class picker changes — where the dashboard's
 * are the teacher's whole roster. Sharing a surface would mean a card pinned
 * here appearing on the landing screen with no class selected to draw it from.
 *
 * WHAT IS NEWLY EXPOSED: nothing. All six panels are drawn from
 * GET /api/faculty/attendance/trend, which the screen already calls and which
 * resolves the teacher from their token. The figures were already on the page;
 * they become individually arrangeable.
 *
 * WHY THE COLUMN STAYS AN ENUM
 * ----------------------------
 * Same reason as 20260821140000 and 20260821170000: a VARCHAR would let a new
 * board ship without a matching entry in config/dashboardCards.js and a
 * matching row in SURFACES_BY_SCOPE. The ENUM makes the database refuse a
 * surface the application has not declared.
 */

const OLD = "ENUM('dashboard', 'ai_insights', 'faculty_insights', 'faculty_dashboard')";
const NEW = "ENUM('dashboard', 'ai_insights', 'faculty_insights', 'faculty_dashboard', 'faculty_attendance')";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE analytics_dashboard_cards MODIFY COLUMN surface ${NEW} NOT NULL`
    );
  },

  async down(queryInterface) {
    /*
     * The attendance rows have nowhere to live under the narrower ENUM, and
     * MySQL would coerce them to '' rather than fail. They go first, so the
     * narrowing is explicit about what it discards instead of silently
     * corrupting the column.
     */
    await queryInterface.sequelize.query(
      "DELETE FROM analytics_dashboard_cards WHERE surface = 'faculty_attendance'"
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE analytics_dashboard_cards MODIFY COLUMN surface ${OLD} NOT NULL`
    );
  },
};
