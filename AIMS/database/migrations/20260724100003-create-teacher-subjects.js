'use strict';

// Backfill migration: `teacher_subjects` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('teacher_subjects')) return;

    await queryInterface.createTable('teacher_subjects', {
      teacher_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'teachers', key: 'teacher_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'subjects', key: 'subject_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      batch_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: 'batches', key: 'batch_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('teacher_subjects');
  },
};
