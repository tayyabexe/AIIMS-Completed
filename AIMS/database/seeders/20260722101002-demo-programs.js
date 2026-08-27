'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const departments = await queryInterface.sequelize.query(`SELECT department_id, department_name FROM departments;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const deptId = (name) => departments.find((d) => d.department_name === name).department_id;

    await queryInterface.bulkInsert(
      'programs',
      [
        { department_id: deptId('Computer Science'), program_name: 'BS Computer Science', duration_semesters: 8 },
        { department_id: deptId('Electrical Engineering'), program_name: 'BS Electrical Engineering', duration_semesters: 8 },
        { department_id: deptId('Software Engineering'), program_name: 'BS Software Engineering', duration_semesters: 8 },
      ],
      { ignoreDuplicates: true } // covered by uq_program_per_department
    );
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('programs', {
      program_name: ['BS Computer Science', 'BS Electrical Engineering', 'BS Software Engineering'],
    });
  },
};
