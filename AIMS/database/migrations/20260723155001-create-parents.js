'use strict';

// Backfill migration: `parents` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
//
// Timestamped to run BEFORE 20260723160001-optimize-is-deleted-indexes-round2,
// which adds an is_deleted index to this table - on a fresh database built
// purely via `sequelize db:migrate`, that migration would otherwise fail
// because `parents` wouldn't exist yet at that point in the sequence.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('parents')) return;

    await queryInterface.createTable('parents', {
      parent_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      first_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(20),
      },
      occupation: {
        type: Sequelize.STRING(100),
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('parents');
  },
};
