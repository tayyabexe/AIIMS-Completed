'use strict';

// Backfill migration: `teacher_attendance` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('teacher_attendance')) return;

    await queryInterface.createTable('teacher_attendance', {
      teacher_attendance_id: {
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
      att_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      check_in: {
        type: Sequelize.TIME,
      },
      check_out: {
        type: Sequelize.TIME,
      },
      status: {
        type: Sequelize.ENUM('Present', 'Absent', 'Late', 'Leave'),
        defaultValue: 'Present',
      },
    });

    await queryInterface.addConstraint('teacher_attendance', {
      fields: ['employee_id', 'att_date'],
      type: 'unique',
      name: 'uq_teacher_attendance_once',
    });

    await queryInterface.addIndex('teacher_attendance', ['att_date'], {
      name: 'idx_teacher_attendance_dt',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('teacher_attendance');
  },
};
