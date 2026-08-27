'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert(
      'departments',
      [
        { department_name: 'Computer Science' },
        { department_name: 'Electrical Engineering' },
        { department_name: 'Software Engineering' },
      ],
      { ignoreDuplicates: true } // department_name is UNIQUE, safe to re-run
    );
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('departments', {
      department_name: ['Computer Science', 'Electrical Engineering', 'Software Engineering'],
    });
  },
};
