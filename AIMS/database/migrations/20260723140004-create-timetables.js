'use strict';

// Backfill migration: `timetables` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('timetables')) return;

    await queryInterface.createTable('timetables', {
      timetable_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'subjects', key: 'subject_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      section_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sections', key: 'section_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'teacher_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      classroom_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'classrooms', key: 'classroom_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      day_of_week: {
        type: Sequelize.ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        allowNull: false,
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('timetables');
  },
};
