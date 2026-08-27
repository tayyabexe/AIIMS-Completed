'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const batches = await queryInterface.sequelize.query(
      `SELECT batch_id, batch_name FROM batches WHERE batch_name IN (
        'BSCS 2023-2027','BSCS 2024-2028','BSEE 2023-2027','BSEE 2024-2028','BSSE 2023-2027','BSSE 2024-2028'
      );`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    const desired = [];
    batches.forEach((b) => {
      ['A', 'B'].forEach((sectionName) => {
        desired.push({ batch_id: b.batch_id, section_name: sectionName, capacity: 40 });
      });
    });

    const existing = await queryInterface.sequelize.query(`SELECT batch_id, section_name FROM sections;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const existingKeys = existing.map((s) => `${s.batch_id}-${s.section_name}`);
    const toInsert = desired.filter((s) => !existingKeys.includes(`${s.batch_id}-${s.section_name}`));

    if (toInsert.length) {
      await queryInterface.bulkInsert('sections', toInsert);
    }
  },
  async down(queryInterface, Sequelize) {
    const batches = await queryInterface.sequelize.query(
      `SELECT batch_id FROM batches WHERE batch_name IN (
        'BSCS 2023-2027','BSCS 2024-2028','BSEE 2023-2027','BSEE 2024-2028','BSSE 2023-2027','BSSE 2024-2028'
      );`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const batchIds = batches.map((b) => b.batch_id);
    if (batchIds.length) {
      await queryInterface.bulkDelete('sections', { batch_id: batchIds });
    }
  },
};
