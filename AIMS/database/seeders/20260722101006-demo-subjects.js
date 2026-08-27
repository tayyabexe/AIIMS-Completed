'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const semesters = await queryInterface.sequelize.query(
      `SELECT s.semester_id, s.semester_number, p.program_name
       FROM semesters s
       JOIN programs p ON s.program_id = p.program_id;`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const semId = (programName, semesterNumber) =>
      semesters.find((s) => s.program_name === programName && s.semester_number === semesterNumber).semester_id;

    await queryInterface.bulkInsert(
      'subjects',
      [
        { subject_code: 'CS-101', subject_name: 'Programming Fundamentals', credit_hours: 3, semester_id: semId('BS Computer Science', 1) },
        { subject_code: 'CS-102', subject_name: 'Discrete Structures', credit_hours: 3, semester_id: semId('BS Computer Science', 1) },
        { subject_code: 'CS-201', subject_name: 'Object Oriented Programming', credit_hours: 3, semester_id: semId('BS Computer Science', 2) },
        { subject_code: 'CS-202', subject_name: 'Data Structures', credit_hours: 3, semester_id: semId('BS Computer Science', 2) },
        { subject_code: 'EE-101', subject_name: 'Circuit Analysis', credit_hours: 3, semester_id: semId('BS Electrical Engineering', 1) },
        { subject_code: 'EE-102', subject_name: 'Engineering Drawing', credit_hours: 2, semester_id: semId('BS Electrical Engineering', 1) },
        { subject_code: 'EE-201', subject_name: 'Digital Logic Design', credit_hours: 3, semester_id: semId('BS Electrical Engineering', 2) },
        { subject_code: 'EE-202', subject_name: 'Electromagnetic Theory', credit_hours: 3, semester_id: semId('BS Electrical Engineering', 2) },
        { subject_code: 'SE-101', subject_name: 'Introduction to Software Engineering', credit_hours: 3, semester_id: semId('BS Software Engineering', 1) },
        { subject_code: 'SE-102', subject_name: 'Programming Fundamentals', credit_hours: 3, semester_id: semId('BS Software Engineering', 1) },
        { subject_code: 'SE-201', subject_name: 'Requirements Engineering', credit_hours: 3, semester_id: semId('BS Software Engineering', 2) },
        { subject_code: 'SE-202', subject_name: 'Object Oriented Programming', credit_hours: 3, semester_id: semId('BS Software Engineering', 2) },
      ],
      { ignoreDuplicates: true } // subject_code is UNIQUE
    );

    // Wire up two prerequisite links now that every subject exists,
    // to prove the self-referencing FK works end to end.
    await queryInterface.sequelize.query(`
      UPDATE subjects child
      JOIN subjects parent ON parent.subject_code = 'CS-101'
      SET child.prerequisite_subject_id = parent.subject_id
      WHERE child.subject_code = 'CS-201';
    `);
    await queryInterface.sequelize.query(`
      UPDATE subjects child
      JOIN subjects parent ON parent.subject_code = 'SE-101'
      SET child.prerequisite_subject_id = parent.subject_id
      WHERE child.subject_code = 'SE-201';
    `);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('subjects', {
      subject_code: [
        'CS-101', 'CS-102', 'CS-201', 'CS-202',
        'EE-101', 'EE-102', 'EE-201', 'EE-202',
        'SE-101', 'SE-102', 'SE-201', 'SE-202',
      ],
    });
  },
};
