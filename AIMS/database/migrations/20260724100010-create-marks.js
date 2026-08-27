'use strict';

// Backfill migration: `marks` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('marks')) return;

    await queryInterface.createTable('marks', {
      mark_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      exam_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'exams', key: 'exam_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'student_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      obtained_marks: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: false,
      },
      entered_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'teacher_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      verified_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'teachers', key: 'teacher_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('Draft', 'Verified', 'Published'),
        defaultValue: 'Draft',
      },
    });

    await queryInterface.addConstraint('marks', {
      fields: ['exam_id', 'student_id'],
      type: 'unique',
      name: 'uq_marks_once',
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE marks ADD CONSTRAINT chk_marks_obtained CHECK (obtained_marks >= 0);'
    );

    await queryInterface.addIndex('marks', ['status'], { name: 'idx_marks_status' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('marks');
  },
};
