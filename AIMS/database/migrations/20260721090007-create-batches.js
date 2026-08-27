'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('batches', {
      batch_id: {
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
      batch_name: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      start_year: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      end_year: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('batches');
  },
};
