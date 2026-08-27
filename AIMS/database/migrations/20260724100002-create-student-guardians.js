'use strict';

// Backfill migration: `student_guardians` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('student_guardians')) return;

    await queryInterface.createTable('student_guardians', {
      student_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'students', key: 'student_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      parent_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'parents', key: 'parent_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      relationship: {
        type: Sequelize.ENUM('Father', 'Mother', 'Guardian'),
        allowNull: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('student_guardians');
  },
};
