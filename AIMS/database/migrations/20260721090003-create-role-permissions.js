'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('role_permissions', {
      role_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'roles', key: 'role_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      permission_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'permissions', key: 'permission_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('role_permissions');
  },
};
