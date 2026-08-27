'use strict';

// Backfill migration: `exams` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('exams')) return;

    await queryInterface.createTable('exams', {
      exam_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      exam_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      exam_type: {
        type: Sequelize.ENUM('Quiz', 'Assignment', 'Mid-Term', 'Final', 'Practical', 'Viva'),
        allowNull: false,
      },
      semester_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'semesters', key: 'semester_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'subjects', key: 'subject_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      exam_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      total_marks: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      classroom_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'classrooms', key: 'classroom_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      invigilator_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'teachers', key: 'teacher_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE exams ADD CONSTRAINT chk_exams_total_marks CHECK (total_marks > 0);'
    );

    await queryInterface.addIndex('exams', ['exam_date'], { name: 'idx_exams_date' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('exams');
  },
};
