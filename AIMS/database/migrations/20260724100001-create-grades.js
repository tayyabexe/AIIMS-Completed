'use strict';

// Backfill migration: `grades` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('grades')) return;

    await queryInterface.createTable('grades', {
      grade_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      grade_letter: {
        type: Sequelize.STRING(5),
        allowNull: false,
        unique: true,
      },
      min_percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      max_percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      grade_point: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('grades');
  },
};
