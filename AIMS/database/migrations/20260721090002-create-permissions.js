'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('permissions', {
      permission_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      permission_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      module: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('permissions');
  },
};
