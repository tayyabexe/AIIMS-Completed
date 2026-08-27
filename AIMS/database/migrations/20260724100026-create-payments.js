'use strict';

// Backfill migration: `payments` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
//
// Renamed from 20260722130001 to this later timestamp: this migration's FKs
// target `employees` and `student_fees`, but at its original Day 3 timestamp
// neither table had a migration yet (employees was backfilled on Day 4;
// student_fees only got one in this Day 5 batch). On a fresh database built
// purely via `sequelize db:migrate`, creating this table at its old position
// would have failed with an unresolvable FK reference. Safe to move on the
// shared Aiven DB - the guard above already no-ops here since `payments`
// exists from schema.sql's original bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('payments')) return;

    await queryInterface.createTable('payments', {
      payment_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_fee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'student_fees', key: 'student_fee_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      amount_paid: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      payment_method: {
        type: Sequelize.ENUM('Cash', 'Bank Transfer', 'Card', 'Mobile Wallet'),
        allowNull: false,
      },
      payment_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      receipt_number: {
        type: Sequelize.STRING(30),
        allowNull: false,
        unique: true,
      },
      recorded_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'employees', key: 'employee_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // Matches the live column added by 20260722130002-add-is-late-to-payments.js.
      // Included directly here too so a fresh `sequelize db:migrate` (where this
      // migration runs before that one ever gets a chance to ALTER an existing
      // table) still ends up with the correct final column set.
      is_late: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('payments');
  },
};
