'use strict';

// Not explicitly requested on its own, but a required prerequisite for the
// Timetables seeder - timetables.classroom_id is NOT NULL, and no classrooms
// existed yet (0 rows live).
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert(
      'classrooms',
      [
        { room_name: 'Room 101', building: 'Main Building', capacity: 60 },
        { room_name: 'Room 102', building: 'Main Building', capacity: 60 },
        { room_name: 'Lab 201', building: 'CS Block', capacity: 30 },
        { room_name: 'Room 301', building: 'EE Block', capacity: 40 },
      ],
      { ignoreDuplicates: true } // (room_name, building) is UNIQUE
    );
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('classrooms', {
      room_name: ['Room 101', 'Room 102', 'Lab 201', 'Room 301'],
    });
  },
};
