'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      user_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      role_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'roles', key: 'role_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      phone: { type: Sequelize.STRING(20) },
      profile_picture: { type: Sequelize.STRING(255) },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      email_verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      failed_login_attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
      last_login: { type: Sequelize.DATE, allowNull: true },
      last_password_change: { type: Sequelize.DATE, allowNull: true },
      is_deleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
