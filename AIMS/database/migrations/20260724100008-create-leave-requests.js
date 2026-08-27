'use strict';

// Backfill migration: `leave_requests` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('leave_requests')) return;

    await queryInterface.createTable('leave_requests', {
      leave_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      leave_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('Pending', 'Approved', 'Rejected'),
        defaultValue: 'Pending',
      },
      approved_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
    });

    await queryInterface.addIndex('leave_requests', ['status'], {
      name: 'idx_leave_status',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('leave_requests');
  },
};
