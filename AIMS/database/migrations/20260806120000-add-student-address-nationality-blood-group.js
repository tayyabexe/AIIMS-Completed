"use strict";

// Adds the three personal fields the student profile screen has always shown
// but never had anywhere to store.
//
// Before this, Profile.jsx printed a hardcoded address, nationality and blood
// group for every student, and its edit form accepted changes to them that
// were silently dropped on save because PUT /api/students/me had no column to
// write to. These are the columns.
//
// All three are nullable: the 2,003 existing rows have no value for them, and
// a student supplying one is optional.

const TABLE = "students";

module.exports = {

    async up(queryInterface, Sequelize) {

        const table = await queryInterface.describeTable(TABLE);

        // Re-runnable: the columns were applied to the live database directly
        // before this file existed, so adding them again must not fail.
        if (!table.address) {
            await queryInterface.addColumn(TABLE, "address", {
                type: Sequelize.STRING(255),
                allowNull: true
            });
        }

        if (!table.nationality) {
            await queryInterface.addColumn(TABLE, "nationality", {
                type: Sequelize.STRING(50),
                allowNull: true
            });
        }

        if (!table.blood_group) {
            await queryInterface.addColumn(TABLE, "blood_group", {
                // An ENUM rather than free text so a typo cannot produce a
                // blood group that is not a blood group.
                type: Sequelize.ENUM(
                    "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"
                ),
                allowNull: true
            });
        }

    },

    async down(queryInterface) {

        const table = await queryInterface.describeTable(TABLE);

        if (table.blood_group) await queryInterface.removeColumn(TABLE, "blood_group");
        if (table.nationality) await queryInterface.removeColumn(TABLE, "nationality");
        if (table.address) await queryInterface.removeColumn(TABLE, "address");

    }

};
