'use strict';

// Backfill migration: `payroll` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('payroll')) return;

    await queryInterface.createTable('payroll', {
      payroll_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'employees', key: 'employee_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      month: {
        type: Sequelize.CHAR(7),
        allowNull: false,
      },
      basic_salary: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      allowances: {
        type: Sequelize.DECIMAL(12, 2),
        defaultValue: 0,
      },
      deductions: {
        type: Sequelize.DECIMAL(12, 2),
        defaultValue: 0,
      },
      net_salary: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('payroll', {
      fields: ['employee_id', 'month'],
      type: 'unique',
      name: 'uq_payroll_once',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('payroll');
  },
};
