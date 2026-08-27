'use strict';

// Backfill migration: `teachers` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('teachers')) return;

    await queryInterface.createTable('teachers', {
      teacher_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'employees', key: 'employee_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      specialization: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });

    await queryInterface.addIndex('teachers', ['is_deleted'], { name: 'idx_teachers_deleted' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('teachers');
  },
};
