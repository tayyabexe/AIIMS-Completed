'use strict';

// Backfill migration: `employee_documents` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('employee_documents')) return;

    await queryInterface.createTable('employee_documents', {
      doc_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'employees', key: 'employee_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      doc_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      file_url: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('employee_documents');
  },
};
