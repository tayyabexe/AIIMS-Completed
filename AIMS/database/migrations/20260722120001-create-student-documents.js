'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_documents', {
      doc_id: {
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
      doc_type: {
        type: Sequelize.ENUM('CNIC', 'B-Form', 'Photo', 'Certificate', 'Transcript', 'Medical', 'Other'),
        allowNull: false,
      },
      file_url: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      uploaded_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('student_documents');
  },
};
