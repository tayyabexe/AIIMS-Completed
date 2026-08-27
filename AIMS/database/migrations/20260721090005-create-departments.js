'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('departments', {
      department_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      department_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      head_employee_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('departments');
  },
};
