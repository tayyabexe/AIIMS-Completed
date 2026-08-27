'use strict';

// Backfill migration: `performance_evaluations` was originally created
// directly from schema.sql rather than through Sequelize, so this brings it
// under migration tracking. Guards against re-creating it on databases
// (like this shared one) where the table already exists from that raw
// bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('performance_evaluations')) return;

    await queryInterface.createTable('performance_evaluations', {
      evaluation_id: {
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
      evaluation_period: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      rating: {
        type: Sequelize.ENUM('Excellent', 'Good', 'Average', 'Poor'),
        allowNull: false,
      },
      remarks: {
        type: Sequelize.STRING(255),
      },
      evaluated_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'employees', key: 'employee_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('performance_evaluations');
  },
};
