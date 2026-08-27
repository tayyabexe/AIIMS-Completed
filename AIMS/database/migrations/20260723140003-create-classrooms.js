'use strict';

// Backfill migration: `classrooms` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('classrooms')) return;

    await queryInterface.createTable('classrooms', {
      classroom_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      room_name: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      building: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      capacity: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });

    await queryInterface.addConstraint('classrooms', {
      fields: ['room_name', 'building'],
      type: 'unique',
      name: 'uq_room_per_building',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('classrooms');
  },
};
