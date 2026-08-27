'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const programs = await queryInterface.sequelize.query(`SELECT program_id, program_name FROM programs;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const progId = (name) => programs.find((p) => p.program_name === name).program_id;

    const desired = [
      { program_id: progId('BS Computer Science'), semester_number: 1, start_date: '2023-09-01', end_date: '2024-01-15' },
      { program_id: progId('BS Computer Science'), semester_number: 2, start_date: '2024-02-01', end_date: '2024-06-15' },
      { program_id: progId('BS Electrical Engineering'), semester_number: 1, start_date: '2023-09-01', end_date: '2024-01-15' },
      { program_id: progId('BS Electrical Engineering'), semester_number: 2, start_date: '2024-02-01', end_date: '2024-06-15' },
      { program_id: progId('BS Software Engineering'), semester_number: 1, start_date: '2023-09-01', end_date: '2024-01-15' },
      { program_id: progId('BS Software Engineering'), semester_number: 2, start_date: '2024-02-01', end_date: '2024-06-15' },
    ];

    const existing = await queryInterface.sequelize.query(`SELECT program_id, semester_number FROM semesters;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const existingKeys = existing.map((s) => `${s.program_id}-${s.semester_number}`);
    const toInsert = desired.filter((s) => !existingKeys.includes(`${s.program_id}-${s.semester_number}`));

    if (toInsert.length) {
      await queryInterface.bulkInsert('semesters', toInsert);
    }
  },
  async down(queryInterface, Sequelize) {
    const programs = await queryInterface.sequelize.query(
      `SELECT program_id FROM programs WHERE program_name IN (
        'BS Computer Science','BS Electrical Engineering','BS Software Engineering'
      );`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const programIds = programs.map((p) => p.program_id);
    if (programIds.length) {
      await queryInterface.bulkDelete('semesters', { program_id: programIds });
    }
  },
};
