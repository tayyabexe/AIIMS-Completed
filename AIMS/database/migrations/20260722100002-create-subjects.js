'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('subjects', {
      subject_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      subject_code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
      },
      subject_name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      credit_hours: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      semester_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'semesters', key: 'semester_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Self-referencing FK: a subject can name another subject (in the
      // same table) as its prerequisite. Valid within a single
      // CREATE TABLE statement - MySQL resolves it after the table
      // definition is complete.
      prerequisite_subject_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'subjects', key: 'subject_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('subjects');
  },
};
