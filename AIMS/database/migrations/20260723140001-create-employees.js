'use strict';

// Backfill migration: `employees` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('employees')) return;

    await queryInterface.createTable('employees', {
      employee_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      employee_code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
      },
      first_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      department_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'departments', key: 'department_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      designation: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      basic_salary: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      hire_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      employment_status: {
        type: Sequelize.ENUM('Active', 'On Leave', 'Terminated', 'Retired'),
        defaultValue: 'Active',
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });

    await queryInterface.addIndex('employees', ['employment_status'], { name: 'idx_employees_status' });
    await queryInterface.addIndex('employees', ['is_deleted'], { name: 'idx_employees_deleted' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('employees');
  },
};
