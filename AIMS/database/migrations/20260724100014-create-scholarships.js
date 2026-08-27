'use strict';

// Backfill migration: `scholarships` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('scholarships')) return;

    await queryInterface.createTable('scholarships', {
      scholarship_id: {
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
      scholarship_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      discount_percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      approved_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'employees', key: 'employee_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE scholarships ADD CONSTRAINT chk_scholarship_discount CHECK (discount_percentage > 0 AND discount_percentage <= 100);'
    );
  },
  async down(queryInterface) {
    await queryInterface.dropTable('scholarships');
  },
};
