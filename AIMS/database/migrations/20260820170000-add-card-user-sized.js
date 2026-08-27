"use strict";

/*
 * Did a person choose this card's height, or did its contents?
 *
 * The Dashboard's built-in panels size themselves: each one is measured after
 * it renders and the card is set to exactly that height, so a stat tile is as
 * tall as its figure and supporting line and no taller. That measurement keeps
 * arriving — when a web font lands, when a number grows a digit, when the
 * sidebar collapses and a supporting line re-wraps.
 *
 * Which is fine until somebody drags the card taller. From that moment the
 * height is a decision, and the next measurement would silently undo it: the
 * card would spring back to its content height and the resize would look like
 * it had not worked. The user would drag it again, and it would spring back
 * again.
 *
 * So the fact of having been sized by hand has to be remembered, and it has to
 * be remembered in the database — it describes the stored layout, and a flag
 * held only in the browser would be forgotten on the next page load, which is
 * exactly when the springing-back would resume.
 *
 * FALSE is the right default for every existing row. A card whose height
 * nobody has deliberately set is one that should track its contents, and that
 * is also what the pre-existing rows are: heights this feature assigned, not
 * heights anyone chose.
 *
 * Note this never lets a card be SHORTER than its contents. The measurement
 * remains the floor whatever this column says; the flag only decides whether
 * it is also the ceiling.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("analytics_dashboard_cards", "user_sized", {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("analytics_dashboard_cards", "user_sized");
  },
};
