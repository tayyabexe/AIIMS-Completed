'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('semesters', {
      semester_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      program_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'programs', key: 'program_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      semester_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      is_archived: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('semesters');
  },
};
