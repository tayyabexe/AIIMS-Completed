"use strict";

/*
 * Two columns on `users`, both needed by admin-provisioned accounts.
 *
 * WHY
 * ---
 * When an admin admits a student or onboards a teacher, the system now creates
 * their login and generates a random password, which is shown to the admin once
 * and never again (the stored value is a bcrypt hash — it cannot be read back).
 *
 * That creates two facts the database had nowhere to record:
 *
 * 1. `must_change_password` — the account is holding a password that a second
 *    person has seen. It is fine for a first sign-in and not fine as a standing
 *    credential, so the account is forced to set its own on first use. Without
 *    a flag there is no way to tell an admin-issued password apart from one the
 *    user chose, and the prompt would either never appear or appear forever.
 *
 *    `last_password_change IS NULL` was considered instead, but 1,021 of the
 *    4,047 existing accounts already have a NULL there from seeding — using it
 *    would force a password reset on a quarter of the institute at next login.
 *
 * 2. `credentials_issued_at` — when the one-time credentials were generated.
 *    This is what lets the admin screen say "issued 3 days ago, never used" and
 *    lets an admin reissue with confidence. It is a timestamp, not a password:
 *    nothing here makes a plaintext password recoverable.
 *
 * Both default to safe values for the 4,047 accounts that already exist:
 * must_change_password = 0, so no existing user is interrupted.
 */

const TABLE = "users";

module.exports = {

    async up(queryInterface, Sequelize) {

        const columns = await queryInterface.describeTable(TABLE);

        if (!columns.must_change_password) {
            await queryInterface.addColumn(TABLE, "must_change_password", {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: "Set when an admin issued this password; cleared once the user picks their own"
            });
        }

        if (!columns.credentials_issued_at) {
            await queryInterface.addColumn(TABLE, "credentials_issued_at", {
                type: Sequelize.DATE,
                allowNull: true,
                comment: "When admin-generated credentials were last issued for this account"
            });
        }

    },

    async down(queryInterface) {

        const columns = await queryInterface.describeTable(TABLE);

        if (columns.must_change_password) {
            await queryInterface.removeColumn(TABLE, "must_change_password");
        }

        if (columns.credentials_issued_at) {
            await queryInterface.removeColumn(TABLE, "credentials_issued_at");
        }

    }

};
