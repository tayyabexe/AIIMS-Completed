'use strict';

// Backfill migration: `reports` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('reports')) return;

    await queryInterface.createTable('reports', {
      report_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      report_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      generated_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      file_url: {
        type: Sequelize.STRING(255),
      },
      format: {
        type: Sequelize.ENUM('PDF', 'Excel', 'CSV'),
        allowNull: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('reports');
  },
};
