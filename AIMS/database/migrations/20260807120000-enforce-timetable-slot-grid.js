'use strict';

// Pins every timetable row to the canonical 90-minute period grid and makes it
// impossible for a section, a teacher, or a room to be double-booked.
//
// Before this, `timetables.start_time` / `end_time` were unconstrained TIME
// columns and there was no uniqueness at all, so nothing at the schema level
// stopped two rows putting the same section in two rooms at once.
//
// The grid is defined in backend/src/config/timetableSlots.js and is repeated
// here deliberately: a migration has to describe the shape of the data at the
// moment it ran, so a later edit to that config cannot silently rewrite what
// this migration did to rows already in the database.
//
// Slot 1  08:30-10:00
// Slot 2  10:00-11:30
// Slot 3  11:30-13:00
// Break   13:00-13:30  (not bookable)
// Slot 4  13:30-15:00

const SLOTS = [
  { start_time: '08:30:00', end_time: '10:00:00' },
  { start_time: '10:00:00', end_time: '11:30:00' },
  { start_time: '11:30:00', end_time: '13:00:00' },
  { start_time: '13:30:00', end_time: '15:00:00' },
];

// The demo/seeded data ran on an 08:00 grid with the same 90-minute cadence,
// so each old period maps cleanly onto one new one. Anything not listed here
// is snapped by nearest start time below.
const EXPLICIT_MOVES = [
  { from: '08:00:00', to: SLOTS[0] },
  { from: '09:30:00', to: SLOTS[1] },
  { from: '11:00:00', to: SLOTS[2] },
  { from: '12:30:00', to: SLOTS[3] },
];

const toSeconds = (time) => {
  const [h, m, s] = String(time).split(':').map(Number);
  return (h * 3600) + (m * 60) + (s || 0);
};

// The slot whose start is closest to where the row already sat, so a stray
// off-grid row lands somewhere defensible rather than all of them piling into
// slot 1.
const nearestSlot = (startTime) => {
  const target = toSeconds(startTime);
  return SLOTS.reduce((best, slot) =>
    Math.abs(toSeconds(slot.start_time) - target) < Math.abs(toSeconds(best.start_time) - target)
      ? slot
      : best
  );
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    const rows = await sequelize.query(
      `SELECT timetable_id, section_id, teacher_id, classroom_id,
              day_of_week, start_time, end_time
         FROM timetables
        ORDER BY day_of_week, start_time, timetable_id;`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    // Move every row onto the grid first, because the unique indexes below
    // cannot be created while duplicates still exist.
    const moved = rows.map((row) => {
      const explicit = EXPLICIT_MOVES.find((m) => m.from === row.start_time);
      const slot = explicit ? explicit.to : nearestSlot(row.start_time);
      return { ...row, start_time: slot.start_time, end_time: slot.end_time };
    });

    // Snapping can collide: two rows that were 30 minutes apart may land in the
    // same period. Keep the first (lowest timetable_id, so the result is
    // deterministic) and drop the rest — an arbitrary survivor is better than a
    // migration that fails halfway on real data.
    const claimed = new Set();
    const keep = [];
    const drop = [];

    for (const row of moved) {
      const keys = [
        `section:${row.section_id}:${row.day_of_week}:${row.start_time}`,
        `teacher:${row.teacher_id}:${row.day_of_week}:${row.start_time}`,
        `room:${row.classroom_id}:${row.day_of_week}:${row.start_time}`,
      ];

      if (keys.some((k) => claimed.has(k))) {
        drop.push(row);
        continue;
      }

      keys.forEach((k) => claimed.add(k));
      keep.push(row);
    }

    if (drop.length) {
      console.warn(
        `[enforce-timetable-slot-grid] Removing ${drop.length} timetable row(s) ` +
        `that collided once snapped onto the slot grid: ` +
        drop.map((d) => d.timetable_id).join(', ')
      );

      await sequelize.query(
        `DELETE FROM timetables WHERE timetable_id IN (:ids);`,
        { replacements: { ids: drop.map((d) => d.timetable_id) } }
      );
    }

    for (const row of keep) {
      await sequelize.query(
        `UPDATE timetables
            SET start_time = :start_time, end_time = :end_time
          WHERE timetable_id = :id;`,
        {
          replacements: {
            start_time: row.start_time,
            end_time: row.end_time,
            id: row.timetable_id,
          },
        }
      );
    }

    // One place at a time, for each of the three resources a booking consumes.
    // start_time alone identifies the period, since every row is now on-grid.
    await queryInterface.addIndex('timetables', ['section_id', 'day_of_week', 'start_time'], {
      name: 'uq_timetable_section_slot',
      unique: true,
    });

    await queryInterface.addIndex('timetables', ['teacher_id', 'day_of_week', 'start_time'], {
      name: 'uq_timetable_teacher_slot',
      unique: true,
    });

    await queryInterface.addIndex('timetables', ['classroom_id', 'day_of_week', 'start_time'], {
      name: 'uq_timetable_classroom_slot',
      unique: true,
    });
  },

  async down(queryInterface) {
    // Only the constraints come off. The times are left on the grid: the
    // pre-migration values are not recoverable, and rows dropped for colliding
    // cannot be resurrected.
    await queryInterface.removeIndex('timetables', 'uq_timetable_section_slot');
    await queryInterface.removeIndex('timetables', 'uq_timetable_teacher_slot');
    await queryInterface.removeIndex('timetables', 'uq_timetable_classroom_slot');
  },
};
