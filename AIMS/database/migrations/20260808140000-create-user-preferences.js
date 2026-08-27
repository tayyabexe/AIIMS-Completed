"use strict";

// Somewhere to keep the per-user choices the Settings screens have always
// offered but never had anywhere to store.
//
// Before this, faculty/Settings.jsx held every switch in React state: the
// notification toggles, the theme and the contact fields were all forgotten on
// reload, and "Save Changes" only raised a toast. This table is what makes
// those screens persist.
//
// One JSON document per user rather than a column per switch: the set of
// preferences a portal offers changes with the UI, and a new toggle should not
// need a migration. The shape written by the API is
//
//   {
//     notifications: { unreadBadge, assignmentBadge, mutedTypes: [] },
//     appearance:    { theme },
//     seen:          { assignments }        // acknowledgement watermarks
//   }
//
// `seen` is what clears the sidebar bubbles: it records the highest id the user
// has already looked at for a module, so a badge counts only what arrived
// since. See facultyPortalService.getBadges.

const TABLE = "user_preferences";

module.exports = {

    async up(queryInterface, Sequelize) {

        const tables = await queryInterface.showAllTables();

        // showAllTables casing varies by driver, so compare case-insensitively.
        const exists = tables
            .map((t) => (typeof t === "string" ? t : t.tableName))
            .some((t) => String(t).toLowerCase() === TABLE);

        if (exists) return;

        await queryInterface.createTable(TABLE, {
            // The user owns exactly one preferences document, so the FK is the
            // primary key - no separate surrogate id, and no way to end up with
            // two conflicting rows for one account.
            user_id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                allowNull: false,
                references: { model: "users", key: "user_id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE"
            },

            preferences: {
                type: Sequelize.JSON,
                allowNull: false
            },

            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
            }
        });

    },

    async down(queryInterface) {
        await queryInterface.dropTable(TABLE);
    }

};
