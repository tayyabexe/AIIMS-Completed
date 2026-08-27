'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('enrollments', {
      enrollment_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'student_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'subjects', key: 'subject_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      semester_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'semesters', key: 'semester_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      enrollment_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('Active', 'Completed', 'Dropped'),
        defaultValue: 'Active',
      },
    });

    await queryInterface.addConstraint('enrollments', {
      fields: ['student_id', 'subject_id', 'semester_id'],
      type: 'unique',
      name: 'uq_enrollment_once',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('enrollments');
  },
};
