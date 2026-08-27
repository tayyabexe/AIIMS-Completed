"use strict";

/*
 * `grid_h` changed units: it was grid rows, it is now pixels.
 *
 * WHY THE UNIT CHANGED
 * --------------------
 * react-grid-layout derives an item's height as
 *
 *     h * rowHeight + (h - 1) * verticalMargin
 *
 * so with the original rowHeight of 30 and a 16px margin, the only heights a
 * card could have were multiples of 46px. The Dashboard's stat tiles render at
 * about 150px; the grid could offer them 138px, which clipped the supporting
 * line, or 184px, which left a third of the card empty. They came out as tall
 * rectangles with the figure stranded in the middle, and no value of `h` fixed
 * it because the height the tiles wanted was not expressible.
 *
 * The grid now runs at rowHeight 1 with no vertical margin, so `h` is a height
 * in pixels exactly and the 16px gap between rows is padding inside each cell.
 * See config/dashboardCards.js.
 *
 * WHY THE STORED ROWS ARE DELETED RATHER THAN CONVERTED
 * -----------------------------------------------------
 * Multiplying the old row counts through would preserve the arrangement but
 * not the intent: those heights were already the wrong ones — a compromise
 * between two multiples of 46 — and scaling a bad fit produces a bad fit at a
 * larger scale. The Dashboard measures its panels at runtime now, so a cleared
 * layout is not merely a default, it is a better result than any conversion
 * could give.
 *
 * Deleting only costs a user their card ARRANGEMENT. It does not touch
 * saved_analytics_queries, so nobody loses a saved question — the chips are
 * all still in the strip and a pinned card is one drag from coming back. That
 * is a proportionate price for the change, and it is why this deletes cards
 * and not queries.
 *
 * `x`, `y` and `w` are all still in their original units (columns and grid
 * rows), so this is genuinely about `h` alone; the rows are dropped because a
 * layout is a whole arrangement and half-converting one is worse than starting
 * from the default.
 */

module.exports = {
  async up(queryInterface) {
    /*
     * An empty table is the documented "this account has never customised"
     * state — layout.service.get() serves the factory arrangement when it
     * finds no rows — so this restores every account to a valid, correct
     * layout rather than leaving anything in a half-migrated one.
     */
    await queryInterface.sequelize.query("DELETE FROM analytics_dashboard_cards");
  },

  async down() {
    /*
     * Deliberately empty. The rows held pixel-unit heights by the time anyone
     * could roll back, and re-inserting them under the old row-based grid
     * would put 166-ROW cards on the screen — a single tile some five thousand
     * pixels tall. Reversing to "no stored layout" is the honest inverse, and
     * that is the state this migration leaves behind.
     */
  },
};
