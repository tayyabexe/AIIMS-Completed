'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sections', {
      section_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      batch_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'batches', key: 'batch_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      section_name: {
        type: Sequelize.STRING(10),
        allowNull: false,
      },
      capacity: {
        type: Sequelize.INTEGER,
        defaultValue: 40,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('sections');
  },
};
