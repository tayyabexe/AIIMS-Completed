'use strict';

// Backfill migration: `fee_structures` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('fee_structures')) return;

    await queryInterface.createTable('fee_structures', {
      fee_structure_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      program_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'programs', key: 'program_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      semester_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'semesters', key: 'semester_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      fee_category: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('fee_structures');
  },
};
