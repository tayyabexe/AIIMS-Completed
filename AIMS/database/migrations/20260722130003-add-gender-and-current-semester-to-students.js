'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('students', 'gender', {
      type: Sequelize.ENUM('Male', 'Female', 'Other'),
      allowNull: true,
    });
    await queryInterface.addColumn('students', 'current_semester_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'semesters', key: 'semester_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('students', 'current_semester_id');
    await queryInterface.removeColumn('students', 'gender');
  },
};
