'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('programs', {
      program_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      department_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'departments', key: 'department_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      program_name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      duration_semesters: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
    });

    await queryInterface.addConstraint('programs', {
      fields: ['department_id', 'program_name'],
      type: 'unique',
      name: 'uq_program_per_department',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('programs');
  },
};
