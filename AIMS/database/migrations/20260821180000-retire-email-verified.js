"use strict";

/*
 * `users.email_verified` — retired as a signal, backfilled to 1.
 *
 * WHAT THE FLAG WAS
 * -----------------
 * A tinyint on `users`, defaulting to 0, added with the original table. That
 * was the entire feature. There was never anything behind it:
 *
 *   - No mailer. Nothing in AIMS sends email. The password-reset handler in
 *     authController says so in its own comment: resets are done by the admin
 *     office because mail delivery does not exist.
 *   - No token table, no /verify route, no link for anyone to click.
 *   - No writer. Nothing in the entire codebase ever set the column back to 1
 *     after insert. `updateUser` does not accept it. So a row created at 0
 *     stayed at 0 for the life of the account.
 *   - No reader that mattered. Login never checked it. No route guard, no
 *     scope resolver, no authorize() call consulted it. It gated nothing.
 *
 * WHY THAT WAS WORSE THAN USELESS
 * --------------------------------
 * `provisioningService.createLogin` is the single path behind every account
 * this institute issues — every student admitted, every teacher onboarded,
 * every staff login created from Staff Accounts. It wrote 0. So User
 * Management showed an orange "Email unverified" badge on every account in the
 * system, and its "Healthy" state required email_verified to be true, which
 * meant no account could ever display as healthy.
 *
 * The writes were not even consistent about it: parentController wrote `true`,
 * everything else wrote `false`, and the seed generator rolled it at random
 * (`chance(0.8) ? 1 : 0`), which is why the existing data is a coin flip with
 * no meaning attached.
 *
 * WHY VERIFICATION DOES NOT APPLY TO THIS PROVISIONING MODEL ANYWAY
 * -----------------------------------------------------------------
 * Verifying an address proves you can reach it. That is a real concern when
 * users self-register with an address nobody has checked. AIMS does not work
 * that way: the admin office enters the address, the system generates the
 * password, and the office hands both to the person, who then signs in. A
 * successful first sign-in already proves the address reached its owner — and
 * `users.last_login` records exactly that, and is already displayed.
 *
 * WHY THE COLUMN SURVIVES
 * ------------------------
 * Dropping it would rewrite the `users` table and invalidate the schema dump
 * and the backups, for no gain — nothing reads it any more. Backfilling to 1
 * and defaulting to 1 makes every existing and future row consistent, so the
 * column is inert rather than actively wrong. It can be dropped later in a
 * migration whose only job is that.
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        // Every live account. The badge claimed something untrue about all of
        // them; this is the correction, not a grant of anything.
        await queryInterface.sequelize.query(
            "UPDATE users SET email_verified = 1 WHERE email_verified = 0"
        );

        // So a raw INSERT that omits the column no longer recreates the flag.
        await queryInterface.changeColumn("users", "email_verified", {
            type: Sequelize.BOOLEAN,
            allowNull: true,
            defaultValue: true
        });
    },

    async down(queryInterface, Sequelize) {
        /*
         * Restores the column default only. The per-row values are NOT reverted:
         * the pre-migration 0/1 spread carried no information — it was the seed
         * generator's coin flip plus provisioning's hardcoded 0 — so there is
         * nothing to restore it to. Writing 0 across the table on a rollback
         * would invent a claim about every account rather than undo one.
         */
        await queryInterface.changeColumn("users", "email_verified", {
            type: Sequelize.BOOLEAN,
            allowNull: true,
            defaultValue: false
        });
    }
};
