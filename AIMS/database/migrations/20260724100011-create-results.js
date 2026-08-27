'use strict';

// Backfill migration: `results` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('results')) return;

    await queryInterface.createTable('results', {
      result_id: {
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
      semester_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'semesters', key: 'semester_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      gpa: {
        type: Sequelize.DECIMAL(3, 2),
      },
      cgpa: {
        type: Sequelize.DECIMAL(3, 2),
      },
      published_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('Pending', 'Published'),
        defaultValue: 'Pending',
      },
    });

    await queryInterface.addConstraint('results', {
      fields: ['student_id', 'semester_id'],
      type: 'unique',
      name: 'uq_result_once',
    });

    await queryInterface.addIndex('results', ['status'], { name: 'idx_results_status' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('results');
  },
};
