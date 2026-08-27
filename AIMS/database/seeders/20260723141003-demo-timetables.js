'use strict';

// One timetable slot per subject (12 total) on the canonical period grid,
// scheduled so no teacher, classroom, or section is double-booked in a slot.
module.exports = {
  async up(queryInterface, Sequelize) {
    const subjects = await queryInterface.sequelize.query(`SELECT subject_id, subject_code FROM subjects;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const subjectId = (code) => subjects.find((s) => s.subject_code === code).subject_id;

    const sections = await queryInterface.sequelize.query(
      `SELECT sec.section_id, sec.section_name, b.batch_name
       FROM sections sec JOIN batches b ON sec.batch_id = b.batch_id;`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const sectionId = (batchName, sectionName) =>
      sections.find((s) => s.batch_name === batchName && s.section_name === sectionName).section_id;

    const teachers = await queryInterface.sequelize.query(
      `SELECT t.teacher_id, e.employee_code
       FROM teachers t JOIN employees e ON t.employee_id = e.employee_id;`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const teacherId = (code) => teachers.find((t) => t.employee_code === code).teacher_id;

    const classrooms = await queryInterface.sequelize.query(`SELECT classroom_id, room_name, building FROM classrooms;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const classroomId = (roomName, building) =>
      classrooms.find((c) => c.room_name === roomName && c.building === building).classroom_id;

    const MAIN_101 = classroomId('Room 101', 'Main Building');
    const MAIN_102 = classroomId('Room 102', 'Main Building');
    const CS_LAB_201 = classroomId('Lab 201', 'CS Block');
    const EE_301 = classroomId('Room 301', 'EE Block');

    const desired = [
      { subject_code: 'CS-101', batch_name: 'BSCS 2024-2028', section_name: 'A', employee_code: 'EMP-001', classroom_id: MAIN_101, day_of_week: 'Monday', start_time: '08:30:00', end_time: '10:00:00' },
      { subject_code: 'CS-102', batch_name: 'BSCS 2024-2028', section_name: 'A', employee_code: 'EMP-001', classroom_id: MAIN_101, day_of_week: 'Wednesday', start_time: '08:30:00', end_time: '10:00:00' },
      { subject_code: 'CS-201', batch_name: 'BSCS 2023-2027', section_name: 'A', employee_code: 'EMP-002', classroom_id: CS_LAB_201, day_of_week: 'Monday', start_time: '10:00:00', end_time: '11:30:00' },
      { subject_code: 'CS-202', batch_name: 'BSCS 2023-2027', section_name: 'A', employee_code: 'EMP-002', classroom_id: CS_LAB_201, day_of_week: 'Wednesday', start_time: '10:00:00', end_time: '11:30:00' },
      { subject_code: 'EE-101', batch_name: 'BSEE 2024-2028', section_name: 'A', employee_code: 'EMP-003', classroom_id: EE_301, day_of_week: 'Tuesday', start_time: '08:30:00', end_time: '10:00:00' },
      { subject_code: 'EE-102', batch_name: 'BSEE 2024-2028', section_name: 'A', employee_code: 'EMP-003', classroom_id: EE_301, day_of_week: 'Thursday', start_time: '08:30:00', end_time: '10:00:00' },
      { subject_code: 'EE-201', batch_name: 'BSEE 2023-2027', section_name: 'A', employee_code: 'EMP-004', classroom_id: EE_301, day_of_week: 'Tuesday', start_time: '10:00:00', end_time: '11:30:00' },
      { subject_code: 'EE-202', batch_name: 'BSEE 2023-2027', section_name: 'A', employee_code: 'EMP-004', classroom_id: EE_301, day_of_week: 'Thursday', start_time: '10:00:00', end_time: '11:30:00' },
      { subject_code: 'SE-101', batch_name: 'BSSE 2024-2028', section_name: 'A', employee_code: 'EMP-005', classroom_id: MAIN_102, day_of_week: 'Monday', start_time: '11:30:00', end_time: '13:00:00' },
      { subject_code: 'SE-102', batch_name: 'BSSE 2024-2028', section_name: 'A', employee_code: 'EMP-005', classroom_id: MAIN_102, day_of_week: 'Wednesday', start_time: '11:30:00', end_time: '13:00:00' },
      { subject_code: 'SE-201', batch_name: 'BSSE 2023-2027', section_name: 'A', employee_code: 'EMP-006', classroom_id: MAIN_102, day_of_week: 'Tuesday', start_time: '11:30:00', end_time: '13:00:00' },
      { subject_code: 'SE-202', batch_name: 'BSSE 2023-2027', section_name: 'A', employee_code: 'EMP-006', classroom_id: MAIN_102, day_of_week: 'Thursday', start_time: '11:30:00', end_time: '13:00:00' },
    ];

    const rows = desired.map((d) => ({
      subject_id: subjectId(d.subject_code),
      section_id: sectionId(d.batch_name, d.section_name),
      teacher_id: teacherId(d.employee_code),
      classroom_id: d.classroom_id,
      day_of_week: d.day_of_week,
      start_time: d.start_time,
      end_time: d.end_time,
    }));

    // timetables now carries unique indexes on (section|teacher|classroom,
    // day_of_week, start_time), so a re-run would raise rather than duplicate.
    // Skipping subjects that already have a slot keeps the seeder idempotent
    // and, unlike relying on the constraint, does not abort the whole insert.
    const existing = await queryInterface.sequelize.query(`SELECT subject_id FROM timetables;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const existingSubjectIds = existing.map((r) => r.subject_id);
    const toInsert = rows.filter((r) => !existingSubjectIds.includes(r.subject_id));

    if (toInsert.length) {
      await queryInterface.bulkInsert('timetables', toInsert);
    }
  },
  async down(queryInterface, Sequelize) {
    const codes = ['CS-101', 'CS-102', 'CS-201', 'CS-202', 'EE-101', 'EE-102', 'EE-201', 'EE-202', 'SE-101', 'SE-102', 'SE-201', 'SE-202'];
    const subjects = await queryInterface.sequelize.query(
      `SELECT subject_id FROM subjects WHERE subject_code IN (:codes);`,
      { replacements: { codes }, type: Sequelize.QueryTypes.SELECT }
    );
    await queryInterface.bulkDelete('timetables', { subject_id: subjects.map((s) => s.subject_id) });
  },
};
