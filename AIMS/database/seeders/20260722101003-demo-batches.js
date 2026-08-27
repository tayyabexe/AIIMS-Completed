'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const programs = await queryInterface.sequelize.query(`SELECT program_id, program_name FROM programs;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const progId = (name) => programs.find((p) => p.program_name === name).program_id;

    const desired = [
      { program_id: progId('BS Computer Science'), batch_name: 'BSCS 2023-2027', start_year: 2023, end_year: 2027 },
      { program_id: progId('BS Computer Science'), batch_name: 'BSCS 2024-2028', start_year: 2024, end_year: 2028 },
      { program_id: progId('BS Electrical Engineering'), batch_name: 'BSEE 2023-2027', start_year: 2023, end_year: 2027 },
      { program_id: progId('BS Electrical Engineering'), batch_name: 'BSEE 2024-2028', start_year: 2024, end_year: 2028 },
      { program_id: progId('BS Software Engineering'), batch_name: 'BSSE 2023-2027', start_year: 2023, end_year: 2027 },
      { program_id: progId('BS Software Engineering'), batch_name: 'BSSE 2024-2028', start_year: 2024, end_year: 2028 },
    ];

    // batches has no unique constraint, so check manually to keep this re-runnable
    const existing = await queryInterface.sequelize.query(`SELECT batch_name FROM batches;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const existingNames = existing.map((b) => b.batch_name);
    const toInsert = desired.filter((b) => !existingNames.includes(b.batch_name));

    if (toInsert.length) {
      await queryInterface.bulkInsert('batches', toInsert);
    }
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('batches', {
      batch_name: [
        'BSCS 2023-2027', 'BSCS 2024-2028',
        'BSEE 2023-2027', 'BSEE 2024-2028',
        'BSSE 2023-2027', 'BSSE 2024-2028',
      ],
    });
  },
};
