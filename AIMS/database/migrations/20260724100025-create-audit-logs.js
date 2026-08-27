'use strict';

// Backfill migration: `audit_logs` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('audit_logs')) return;

    await queryInterface.createTable('audit_logs', {
      log_id: {
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
      action: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      module: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      entity_affected: {
        type: Sequelize.STRING(100),
      },
      old_value: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      new_value: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      action_timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      ip_address: {
        type: Sequelize.STRING(45),
      },
    });

    await queryInterface.addIndex('audit_logs', ['action_timestamp'], {
      name: 'idx_audit_logs_time',
    });
    await queryInterface.addIndex('audit_logs', ['module'], {
      name: 'idx_audit_logs_module',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
