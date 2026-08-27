'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const programs = await queryInterface.sequelize.query(`SELECT program_id, program_name FROM programs;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const programId = (name) => programs.find((p) => p.program_name === name).program_id;

    const batches = await queryInterface.sequelize.query(`SELECT batch_id, batch_name FROM batches;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const batchId = (name) => batches.find((b) => b.batch_name === name).batch_id;

    const sections = await queryInterface.sequelize.query(`SELECT section_id, batch_id, section_name FROM sections;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const sectionId = (batchName, sectionName) => {
      const bId = batchId(batchName);
      return sections.find((s) => s.batch_id === bId && s.section_name === sectionName).section_id;
    };

    const desired = [
      {
        registration_number: '2023-CS-001',
        first_name: 'Ahmed',
        last_name: 'Raza',
        cnic_bform: '3520112223331',
        phone: '03001234561',
        dob: '2005-03-14',
        program_id: programId('BS Computer Science'),
        batch_id: batchId('BSCS 2023-2027'),
        section_id: sectionId('BSCS 2023-2027', 'A'),
        academic_status: 'Active',
      },
      {
        registration_number: '2024-CS-002',
        first_name: 'Sara',
        last_name: 'Khan',
        cnic_bform: '3520112223332',
        phone: '03001234562',
        dob: '2006-07-22',
        program_id: programId('BS Computer Science'),
        batch_id: batchId('BSCS 2024-2028'),
        section_id: sectionId('BSCS 2024-2028', 'B'),
        academic_status: 'Pending Verification',
      },
      {
        registration_number: '2023-EE-001',
        first_name: 'Bilal',
        last_name: 'Ahmed',
        cnic_bform: '3520112223333',
        phone: '03001234563',
        dob: '2005-01-09',
        program_id: programId('BS Electrical Engineering'),
        batch_id: batchId('BSEE 2023-2027'),
        section_id: sectionId('BSEE 2023-2027', 'A'),
        academic_status: 'Suspended',
      },
      {
        registration_number: '2024-EE-002',
        first_name: 'Hina',
        last_name: 'Malik',
        cnic_bform: '3520112223334',
        phone: '03001234564',
        dob: '2006-11-30',
        program_id: programId('BS Electrical Engineering'),
        batch_id: batchId('BSEE 2024-2028'),
        section_id: sectionId('BSEE 2024-2028', 'B'),
        academic_status: 'Withdrawn',
      },
      {
        registration_number: '2023-SE-001',
        first_name: 'Usman',
        last_name: 'Tariq',
        cnic_bform: '3520112223335',
        phone: '03001234565',
        dob: '2005-05-18',
        program_id: programId('BS Software Engineering'),
        batch_id: batchId('BSSE 2023-2027'),
        section_id: sectionId('BSSE 2023-2027', 'A'),
        academic_status: 'Graduated',
      },
      {
        registration_number: '2024-SE-002',
        first_name: 'Ayesha',
        last_name: 'Siddiqui',
        cnic_bform: '3520112223336',
        phone: '03001234566',
        dob: '2006-09-25',
        program_id: programId('BS Software Engineering'),
        batch_id: batchId('BSSE 2024-2028'),
        section_id: sectionId('BSSE 2024-2028', 'B'),
        academic_status: 'Alumni',
      },
    ];

    const existing = await queryInterface.sequelize.query(`SELECT registration_number FROM students;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const existingRegNos = existing.map((s) => s.registration_number);
    const toInsert = desired
      .filter((s) => !existingRegNos.includes(s.registration_number))
      .map((s) => ({ ...s, is_deleted: false, created_at: new Date(), updated_at: new Date() }));

    if (toInsert.length) {
      await queryInterface.bulkInsert('students', toInsert);
    }
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('students', {
      registration_number: [
        '2023-CS-001', '2024-CS-002',
        '2023-EE-001', '2024-EE-002',
        '2023-SE-001', '2024-SE-002',
      ],
    });
  },
};
