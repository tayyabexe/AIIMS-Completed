'use strict';

/*
 * A room estate that can actually hold the student body.
 *
 * WHY THIS WAS NEEDED
 * -------------------
 * The demo database had five rooms, the largest seating 100, against sections
 * of 81 to 405 students. Every section was also several times its own declared
 * `sections.capacity` - a section marked capacity 40 held 398 people.
 *
 * None of that was visible before, because nothing compared the two numbers.
 * The old timetable had 405 students assigned to Lab-1, which seats 50, and
 * was perfectly happy about it. Once course_offerings started checking room
 * capacity against class size, every class in the institute became unplaceable
 * at once - correctly, and unhelpfully.
 *
 * WHY ROOMS RATHER THAN SMALLER SECTIONS
 * --------------------------------------
 * Splitting the oversized sections is the other repair, and in a real
 * institution it is the right one. It is not done here because it is
 * destructive in a way this is not: the sections are referenced by 40 course
 * offerings and 40 timetable rows, and those timetable rows carry 60,078
 * attendance records that would cascade away with them. Trading a working
 * demo dataset for a tidier one is a bad trade to make silently.
 *
 * So the estate grows to fit the cohorts instead. Large first-year lecture
 * halls seating 200-450 are ordinary university infrastructure, and adding
 * rows breaks nothing that already exists.
 *
 * WHY THE SIZES ARE WHAT THEY ARE
 * -------------------------------
 * The two 450-seat halls exist because four sections are just under 400 and
 * every one of them has to be placeable somewhere. Below those, the mix is
 * ordinary: 60-seat classrooms in bulk, labs at 30-50 because bench space is
 * what limits a practical, and a couple of seminar rooms for small groups.
 * Buildings reuse the names already in the data so the estate reads as one
 * campus rather than two.
 */

// (room_name, building) is UNIQUE, and the existing five rooms - Lab-1, Lab-2,
// Hall-A, Room-101, Room-202 - are deliberately not repeated here.
const ROOMS = [
  // --- Main Academic Block: the big shared teaching space ----------------
  { room_name: 'Hall-1', building: 'Main Academic Block', capacity: 450, room_type: 'Auditorium' },
  { room_name: 'Hall-2', building: 'Main Academic Block', capacity: 450, room_type: 'Auditorium' },
  { room_name: 'Hall-3', building: 'Main Academic Block', capacity: 250, room_type: 'Auditorium' },
  { room_name: 'Room-301', building: 'Main Academic Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-302', building: 'Main Academic Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-303', building: 'Main Academic Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-304', building: 'Main Academic Block', capacity: 45, room_type: 'Lecture' },
  { room_name: 'Seminar-1', building: 'Main Academic Block', capacity: 25, room_type: 'Seminar' },

  // --- CS Block ----------------------------------------------------------
  { room_name: 'Lab-3', building: 'CS Block', capacity: 50, room_type: 'Lab' },
  { room_name: 'Lab-4', building: 'CS Block', capacity: 50, room_type: 'Lab' },
  { room_name: 'Lab-5', building: 'CS Block', capacity: 40, room_type: 'Lab' },
  { room_name: 'Room-401', building: 'CS Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-402', building: 'CS Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-403', building: 'CS Block', capacity: 130, room_type: 'Lecture' },
  { room_name: 'Seminar-2', building: 'CS Block', capacity: 25, room_type: 'Seminar' },

  // --- EE Block ----------------------------------------------------------
  { room_name: 'Lab-EE-1', building: 'EE Block', capacity: 40, room_type: 'Lab' },
  { room_name: 'Lab-EE-2', building: 'EE Block', capacity: 40, room_type: 'Lab' },
  { room_name: 'Lab-EE-3', building: 'EE Block', capacity: 30, room_type: 'Lab' },
  { room_name: 'Room-501', building: 'EE Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-502', building: 'EE Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-503', building: 'EE Block', capacity: 130, room_type: 'Lecture' },

  // --- BBA Block ---------------------------------------------------------
  { room_name: 'Hall-B', building: 'BBA Block', capacity: 250, room_type: 'Auditorium' },
  { room_name: 'Room-601', building: 'BBA Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-602', building: 'BBA Block', capacity: 60, room_type: 'Lecture' },
  { room_name: 'Room-603', building: 'BBA Block', capacity: 130, room_type: 'Lecture' },
  { room_name: 'Seminar-3', building: 'BBA Block', capacity: 25, room_type: 'Seminar' },
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert(
      'classrooms',
      ROOMS.map((room) => ({ ...room, is_deleted: false })),
      // (room_name, building) is UNIQUE, so re-running is a no-op rather than
      // a failure.
      { ignoreDuplicates: true }
    );
  },

  async down(queryInterface) {
    const { Op } = require('sequelize');

    /*
     * Only rooms nothing is timetabled into come out. A room that has been
     * booked cannot be deleted without taking the booking - and its attendance
     * - with it, and an undo that quietly destroys teaching records is worse
     * than an undo that leaves a few rows behind.
     */
    const [inUse] = await queryInterface.sequelize.query(
      `SELECT DISTINCT c.room_name, c.building
         FROM classrooms c
         JOIN timetables t ON t.classroom_id = c.classroom_id`
    );

    const booked = new Set(inUse.map((r) => `${r.room_name}|${r.building}`));

    const removable = ROOMS.filter(
      (r) => !booked.has(`${r.room_name}|${r.building}`)
    );

    if (removable.length < ROOMS.length) {
      console.warn(
        `[demo-room-estate] Keeping ${ROOMS.length - removable.length} room(s) ` +
          'that have classes timetabled into them.'
      );
    }

    if (!removable.length) return;

    await queryInterface.bulkDelete('classrooms', {
      [Op.or]: removable.map((r) => ({
        room_name: r.room_name,
        building: r.building,
      })),
    });
  },
};
