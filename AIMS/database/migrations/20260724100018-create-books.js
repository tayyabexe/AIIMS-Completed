'use strict';

// Backfill migration: `books` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('books')) return;

    await queryInterface.createTable('books', {
      book_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      isbn: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      author: {
        type: Sequelize.STRING(150),
      },
      category: {
        type: Sequelize.STRING(80),
      },
      total_copies: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      available_copies: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE books ADD CONSTRAINT chk_books_total_copies CHECK (total_copies >= 0);'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE books ADD CONSTRAINT chk_books_available_copies CHECK (available_copies >= 0 AND available_copies <= total_copies);'
    );

    await queryInterface.addIndex('books', ['is_deleted'], { name: 'idx_books_deleted' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('books');
  },
};
