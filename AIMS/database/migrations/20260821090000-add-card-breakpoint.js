"use strict";

/*
 * A card's position now belongs to a WIDTH as well as to a screen.
 *
 * WHY A SECOND LAYOUT EXISTS AT ALL
 * ---------------------------------
 * The twelve-column grid is a desktop instrument. A stat tile is three columns
 * wide, which is a comfortable 340px on a monitor and about 150px on a laptop
 * window with the sidebar open — narrow enough that a figure like
 * "Rs 108.3M" wraps onto two lines and the tile stops being readable at a
 * glance, which is the only thing a stat tile is for.
 *
 * So below a threshold the cards stack full width. That much could have been
 * done in CSS. What could not is letting someone ARRANGE them there — and
 * arranging at a narrow width is not a cosmetic variant of arranging at a wide
 * one. Reordering a stack is a single sequence; placing cards on a
 * twelve-column grid is two dimensions. One set of coordinates cannot hold
 * both without the narrow session flattening the desktop arrangement it was
 * never meant to touch.
 *
 * Hence a row per card PER BREAKPOINT. Rearranging on a tablet leaves the
 * desktop layout exactly as it was, and vice versa.
 *
 * WHY 'sm' ROWS ARE USUALLY ABSENT
 * --------------------------------
 * Nothing writes an 'sm' row until somebody actually arranges at that width.
 * Until then the stack is derived from the desktop layout in reading order —
 * top to bottom, left to right — which is almost always what a person would
 * have built by hand anyway. Same principle as an account with no rows at all
 * getting the factory layout: the default stays a computed thing, so improving
 * it later improves it for everyone rather than only for new accounts.
 *
 * WHY THE INDEX CHANGES
 * ---------------------
 * Every read is "this user's cards, on this screen, at this width". Leaving
 * the breakpoint out of the index would mean fetching both layouts and
 * discarding one on every single open.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("analytics_dashboard_cards");

    /*
     * Guarded because this migration's first run added the column and then
     * failed on the index step below, leaving the column in place but the
     * migration unrecorded. A migration that cannot be re-run after a partial
     * failure has to be repaired by hand on every database it half-applied to.
     */
    if (!table.breakpoint) {
      await queryInterface.addColumn("analytics_dashboard_cards", "breakpoint", {
        type: Sequelize.DataTypes.ENUM("lg", "sm"),
        allowNull: false,
        defaultValue: "lg",
      });
    }

    /*
     * Existing rows are all desktop arrangements — the only width that could
     * be arranged before this migration — so the 'lg' default above is not a
     * fallback, it is the correct value for every one of them.
     *
     * ADD BEFORE DROP, and not for tidiness.
     * --------------------------------------
     * `user_id` carries a foreign key to users, and InnoDB requires an index
     * with that column leading in order to enforce it. The old index was the
     * only one that qualified, so dropping it first is refused outright:
     * "Cannot drop index: needed in a foreign key constraint". Creating the
     * replacement first — which also leads with user_id — gives the constraint
     * somewhere to move to, and the drop then succeeds.
     */
    await queryInterface.addIndex("analytics_dashboard_cards", {
      fields: ["user_id", "surface", "breakpoint"],
      name: "ix_analytics_cards_user_surface_bp",
    });

    await queryInterface.removeIndex(
      "analytics_dashboard_cards",
      "ix_analytics_cards_user_surface"
    );
  },

  async down(queryInterface) {
    // Same foreign-key rule as up(): the replacement index has to exist before
    // the one currently backing the constraint can go.
    await queryInterface.addIndex("analytics_dashboard_cards", {
      fields: ["user_id", "surface"],
      name: "ix_analytics_cards_user_surface",
    });

    await queryInterface.removeIndex(
      "analytics_dashboard_cards",
      "ix_analytics_cards_user_surface_bp"
    );

    /*
     * The narrow-width rows have no meaning under a schema with one layout per
     * screen, and leaving them would double every card. They go; the desktop
     * rows, which are the ones anyone would miss, stay untouched.
     */
    await queryInterface.sequelize.query(
      "DELETE FROM analytics_dashboard_cards WHERE breakpoint = 'sm'"
    );

    await queryInterface.removeColumn("analytics_dashboard_cards", "breakpoint");
  },
};
