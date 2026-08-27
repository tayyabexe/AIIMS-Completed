'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('students', {
      student_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        unique: true,
        references: { model: 'users', key: 'user_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      registration_number: {
        type: Sequelize.STRING(30),
        allowNull: false,
        unique: true,
      },
      first_name: { type: Sequelize.STRING(100), allowNull: false },
      last_name: { type: Sequelize.STRING(100), allowNull: false },
      cnic_bform: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
      },
      phone: { type: Sequelize.STRING(20) },
      dob: { type: Sequelize.DATEONLY },
      program_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'programs', key: 'program_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      batch_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'batches', key: 'batch_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      section_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'sections', key: 'section_id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      academic_status: {
        type: Sequelize.ENUM(
          'Pending Verification',
          'Active',
          'Suspended',
          'Withdrawn',
          'Graduated',
          'Alumni'
        ),
        defaultValue: 'Pending Verification',
      },
      is_deleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('students');
  },
};
