/**
 * READ-ONLY preflight for 20260807120000-enforce-timetable-slot-grid.
 *
 * Reports exactly what that migration would do - how many rows move, and which
 * rows would be deleted for colliding once snapped - without writing anything.
 * Run this before the migration on any database whose contents matter.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const SLOTS = require('../../backend/src/config/timetableSlots').SLOTS;

const toSeconds = (t) => {
  const [h, m, s] = String(t).split(':').map(Number);
  return (h * 3600) + ((m || 0) * 60) + (s || 0);
};

const nearestSlot = (startTime) => {
  const target = toSeconds(startTime);
  return SLOTS.reduce((best, slot) =>
    Math.abs(toSeconds(slot.start_time) - target) < Math.abs(toSeconds(best.start_time) - target)
      ? slot
      : best
  );
};

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 30000,
  });

  console.log(`Connected to ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

  const [rows] = await conn.query(
    `SELECT timetable_id, section_id, teacher_id, classroom_id,
            day_of_week, start_time, end_time
       FROM timetables
      ORDER BY day_of_week, start_time, timetable_id`
  );

  console.log(`Total timetable rows: ${rows.length}\n`);

  const [dist] = await conn.query(
    `SELECT start_time, end_time, COUNT(*) n
       FROM timetables GROUP BY start_time, end_time ORDER BY start_time`
  );

  const onGrid = (st, en) =>
    SLOTS.some((s) => s.start_time === String(st) && s.end_time === String(en));

  console.log('Current periods in the database:');
  for (const d of dist) {
    const ok = onGrid(d.start_time, d.end_time);
    console.log(`  ${String(d.start_time)}-${String(d.end_time)}  ${String(d.n).padStart(5)} rows   ${ok ? 'on-grid' : '<-- OFF-GRID, will move'}`);
  }

  // Replay the migration's snap + collision logic, without writing.
  const claimed = new Set();
  const drop = [];
  let movedCount = 0;

  for (const row of rows) {
    const slot = nearestSlot(row.start_time);
    if (String(row.start_time) !== slot.start_time || String(row.end_time) !== slot.end_time) movedCount++;

    const keys = [
      `section:${row.section_id}:${row.day_of_week}:${slot.start_time}`,
      `teacher:${row.teacher_id}:${row.day_of_week}:${slot.start_time}`,
      `room:${row.classroom_id}:${row.day_of_week}:${slot.start_time}`,
    ];

    if (keys.some((k) => claimed.has(k))) { drop.push({ ...row, to: slot }); continue; }
    keys.forEach((k) => claimed.add(k));
  }

  console.log(`\nRows whose times would change: ${movedCount}`);
  console.log(`Rows that would be DELETED (collide once snapped): ${drop.length}`);

  if (drop.length) {
    console.log('\n  id      day         from                 -> slot');
    for (const d of drop.slice(0, 40)) {
      console.log(`  ${String(d.timetable_id).padEnd(7)} ${String(d.day_of_week).padEnd(11)} ` +
        `${String(d.start_time)}-${String(d.end_time)}  -> ${d.to.start_time}`);
    }
    if (drop.length > 40) console.log(`  ... and ${drop.length - 40} more`);

    const [att] = await conn.query(
      `SELECT COUNT(*) n FROM attendance WHERE timetable_id IN (?)`,
      [drop.map((d) => d.timetable_id)]
    );
    console.log(`\n  Attendance rows referencing those timetables: ${att[0].n} (deleted by ON DELETE CASCADE)`);
  }

  // Has the migration already been applied?
  const [idx] = await conn.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'timetables'
        AND INDEX_NAME LIKE 'uq_timetable_%'`,
    [process.env.DB_NAME]
  );
  console.log(`\nUnique slot indexes already present: ${idx.length ? idx.map((i) => i.INDEX_NAME).join(', ') : 'none'}`);

  const [meta] = await conn.query(
    `SELECT name FROM SequelizeMeta WHERE name LIKE '%enforce-timetable-slot-grid%'`
  ).catch(() => [[]]);
  console.log(`Migration recorded in SequelizeMeta: ${meta && meta.length ? 'YES' : 'no'}`);

  await conn.end();
})().catch((e) => { console.error('\nPREFLIGHT FAILED:', e.message); process.exit(1); });
