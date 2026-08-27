'use strict';

/*
 * Record, in the schema itself, that the permission tables are not read.
 *
 * WHAT IS ACTUALLY TRUE
 * ---------------------
 * `permissions` (18 rows) and `role_permissions` (35 rows) are seeded, carry
 * foreign keys, and look exactly like a working permission system. They are
 * not one.
 *
 * Authorisation is decided entirely by role id:
 *
 *     // backend/src/middlewares/rbac.middleware.js
 *     if (!allowedRoles.includes(req.user.role_id)) return 403;
 *
 * `authorize(...roleIds)` compares numbers. Nothing in backend/src reads either
 * table — not the middleware, not a service, not a controller. A grep for
 * `role_permissions` across the backend returns no hits outside test fixtures.
 *
 * WHY A COMMENT RATHER THAN A DROP
 * --------------------------------
 * Dropping them would be the other defensible choice, but it throws away the
 * only description of the intended permission model, and `role_permissions`
 * carries foreign keys into `roles` and `permissions` that a future
 * permission-level check would want back.
 *
 * The failure this prevents is a reader — human or AI — inferring from the
 * schema that permissions are enforced per permission, and writing a feature
 * or a security assessment on that assumption. The seeder previously described
 * these as "read by the RBAC layer", which was simply wrong.
 *
 * A table comment travels with the database. It survives a dump and restore, it
 * appears in `SHOW CREATE TABLE`, and it is therefore reproduced in the
 * generated schema.sql without anyone having to remember to add it.
 *
 * SAFETY
 * ------
 * Comments only. No column, index, constraint or row is touched, so there is
 * nothing to lose and nothing to reindex. Idempotent: re-running sets the same
 * comment again.
 */

const UNUSED_NOTE =
    'NOT READ BY THE APPLICATION. Authorisation is role-id only, in '
    + 'middlewares/rbac.middleware.js. Seeded and kept for referential '
    + 'completeness and for a future permission-level check. See '
    + 'GAPS_AND_LIMITATIONS.md section 6.';

module.exports = {

    async up(queryInterface) {
        // ALTER TABLE ... COMMENT is the only portable way to set one; there is
        // no queryInterface helper for a table-level comment in this version.
        await queryInterface.sequelize.query(
            `ALTER TABLE \`permissions\` COMMENT = ${queryInterface.sequelize.escape(UNUSED_NOTE)}`
        );
        await queryInterface.sequelize.query(
            `ALTER TABLE \`role_permissions\` COMMENT = ${queryInterface.sequelize.escape(UNUSED_NOTE)}`
        );
    },

    async down(queryInterface) {
        // Restore the absence of a comment, not some earlier text: neither
        // table carried one before this migration.
        await queryInterface.sequelize.query(
            "ALTER TABLE `permissions` COMMENT = ''"
        );
        await queryInterface.sequelize.query(
            "ALTER TABLE `role_permissions` COMMENT = ''"
        );
    }

};
