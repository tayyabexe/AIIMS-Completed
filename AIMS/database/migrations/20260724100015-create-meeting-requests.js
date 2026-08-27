'use strict';

// Backfill migration: `meeting_requests` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('meeting_requests')) return;

    await queryInterface.createTable('meeting_requests', {
      request_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      parent_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'parents', key: 'parent_id' },
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
      requested_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('Pending', 'Approved', 'Rejected', 'Completed'),
        defaultValue: 'Pending',
      },
      notes: {
        type: Sequelize.STRING(255),
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('meeting_requests');
  },
};
