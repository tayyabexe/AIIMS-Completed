'use strict';

const bcrypt = require('bcrypt');

module.exports = {
  async up(queryInterface, Sequelize) {
    const [role] = await queryInterface.sequelize.query(
      `SELECT role_id FROM roles WHERE role_name = 'Super Admin';`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    // CHANGE THIS PASSWORD immediately after first login in any real deployment.
    const hashedPassword = await bcrypt.hash('ChangeMe@123', 10);

    await queryInterface.bulkInsert('users', [
      {
        email: 'admin@aims.edu.pk',
        password_hash: hashedPassword,
        role_id: role.role_id,

        /*
         * Set explicitly rather than left NULL, because an admin account has
         * no role record to backfill a name from. Leaving it out is what made
         * the frontend derive one from the email and greet this account as
         * "Admin".
         */
        full_name: 'System Administrator',

        is_active: true,
        email_verified: true,
        failed_login_attempts: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: 'admin@aims.edu.pk' }, {});
  },
};
