'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('student_documents', 'doc_type', {
      type: Sequelize.ENUM(
        'CNIC',
        'B-Form',
        'Photo',
        'Certificate',
        'Transcript',
        'Medical',
        'Admission Form',
        'Fee Challan',
        'Result Card',
        'Other'
      ),
      allowNull: false,
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('student_documents', 'doc_type', {
      type: Sequelize.ENUM('CNIC', 'B-Form', 'Photo', 'Certificate', 'Transcript', 'Medical', 'Other'),
      allowNull: false,
    });
  },
};
