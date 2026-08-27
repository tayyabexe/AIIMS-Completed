'use strict';

/*
 * `users.locked_at` - when this account was locked out by repeated failed
 * sign-ins, or NULL when it is not locked.
 *
 * A column of its own rather than reusing `is_active`, because the two mean
 * different things and are undone by different people. `is_active = 0` is an
 * administrator's decision to take a login out of service; `locked_at` is the
 * system reacting to five wrong passwords. Folding them together would have
 * made "deactivated by the office" and "somebody was guessing at this account
 * last night" the same row, and unlocking would silently re-enable a login an
 * admin had deliberately switched off.
 *
 * `failed_login_attempts` already existed and already counted; nothing ever
 * read it. It is now the counter behind this column.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');

    if (!table.locked_at) {
      await queryInterface.addColumn('users', 'locked_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');

    if (table.locked_at) {
      await queryInterface.removeColumn('users', 'locked_at');
    }
  },
};
