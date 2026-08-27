'use strict';

// Backfill migration: `announcements` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('announcements')) return;

    await queryInterface.createTable('announcements', {
      announcement_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      target_role: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      posted_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('announcements', ['target_role'], {
      name: 'idx_announcements_role',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('announcements');
  },
};
