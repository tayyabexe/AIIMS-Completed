"use strict";

/*
 * A third pinnable surface: the faculty portal's own board.
 *
 * WHY A NEW SURFACE RATHER THAN LETTING TEACHERS ONTO AN EXISTING ONE
 * -------------------------------------------------------------------
 * Both existing surfaces are admin-portal screens, and every built-in panel on
 * them is an institute-wide figure: fee collection, the whole student roll,
 * the institute pass rate. A teacher is entitled to none of those. Letting a
 * teacher pin onto 'dashboard' would have put their card on a screen made of
 * numbers they cannot see, and would have made a permission boundary out of a
 * layout file.
 *
 * 'faculty_insights' ships with no built-ins at all. What a teacher pins is
 * their own saved questions, and those are re-validated and re-scoped to their
 * roster on every single run - savedQueries.service.run hands the plan back
 * through planValidator and executor.execute, which rebuilds the scopedSql
 * prelude from the teacher's CURRENT roster. A card is never a stored result,
 * so a teacher who stops teaching a section stops seeing it in their own
 * pinned card the next time it loads.
 *
 * WHY THE COLUMN IS AN ENUM AND STAYS ONE
 * ----------------------------------------
 * The alternative is a VARCHAR, and a VARCHAR would have let this feature ship
 * without anyone noticing the surface list had grown - which is precisely the
 * check that caught it. A new board is a deliberate act with a matching entry
 * in config/dashboardCards.js and a matching row in SURFACES_BY_SCOPE; the
 * ENUM makes the database refuse anything the application has not declared.
 */

const OLD = "ENUM('dashboard', 'ai_insights')";
const NEW = "ENUM('dashboard', 'ai_insights', 'faculty_insights')";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE analytics_dashboard_cards MODIFY COLUMN surface ${NEW} NOT NULL`
    );
  },

  async down(queryInterface) {
    /*
     * The faculty rows have nowhere to live under the old two-value ENUM, and
     * MySQL would coerce them to '' rather than fail. They go first, so the
     * narrowing is explicit about what it discards instead of silently
     * corrupting the column.
     */
    await queryInterface.sequelize.query(
      "DELETE FROM analytics_dashboard_cards WHERE surface = 'faculty_insights'"
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE analytics_dashboard_cards MODIFY COLUMN surface ${OLD} NOT NULL`
    );
  },
};
