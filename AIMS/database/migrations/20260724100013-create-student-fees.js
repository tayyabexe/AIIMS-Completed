'use strict';

// Backfill migration: `student_fees` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('student_fees')) return;

    await queryInterface.createTable('student_fees', {
      student_fee_id: {
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
      fee_structure_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'fee_structures', key: 'fee_structure_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      voucher_number: {
        type: Sequelize.STRING(30),
        allowNull: false,
        unique: true,
      },
      total_payable: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('Unpaid', 'Partially Paid', 'Paid', 'Overdue'),
        defaultValue: 'Unpaid',
      },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE student_fees ADD CONSTRAINT chk_fees_total_payable CHECK (total_payable >= 0);'
    );

    await queryInterface.addIndex('student_fees', ['status'], { name: 'idx_student_fees_status' });
    await queryInterface.addIndex('student_fees', ['due_date'], { name: 'idx_student_fees_due' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('student_fees');
  },
};
