'use strict';

// Backfill migration: `attendance` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('attendance')) return;

    await queryInterface.createTable('attendance', {
      attendance_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'student_id' },
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
      timetable_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'timetables', key: 'timetable_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      att_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('Present', 'Absent', 'Late', 'Leave', 'Holiday'),
        allowNull: false,
      },
      marked_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'teacher_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('attendance', {
      fields: ['student_id', 'timetable_id', 'att_date'],
      type: 'unique',
      name: 'uq_attendance_once',
    });

    await queryInterface.addIndex('attendance', ['att_date'], { name: 'idx_attendance_date' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('attendance');
  },
};
