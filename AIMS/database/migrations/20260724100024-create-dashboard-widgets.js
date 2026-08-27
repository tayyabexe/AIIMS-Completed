'use strict';

// Backfill migration: `dashboard_widgets` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('dashboard_widgets')) return;

    await queryInterface.createTable('dashboard_widgets', {
      widget_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      role_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'roles', key: 'role_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      widget_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      config_json: {
        type: Sequelize.JSON,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('dashboard_widgets');
  },
};
