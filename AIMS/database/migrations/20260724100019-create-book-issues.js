'use strict';

// Backfill migration: `book_issues` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('book_issues')) return;

    await queryInterface.createTable('book_issues', {
      issue_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      book_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'books', key: 'book_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      borrower_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      issue_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      return_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      fine_amount: {
        type: Sequelize.DECIMAL(8, 2),
        defaultValue: 0,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('book_issues');
  },
};
