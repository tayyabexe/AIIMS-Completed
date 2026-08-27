/**
 * Moves any timetable row that is off the canonical period grid onto the
 * nearest slot. UPDATE only - this never deletes a row.
 *
 * The generator scripts each used to carry their own copy of the slot list,
 * and one of them ended 14:00-15:30 instead of 13:30-15:00, so rows were
 * written to periods the API and the portals had no column for. The scripts now
 * share backend/src/config/timetableSlots.js; this repairs the rows they left
 * behind, without regenerating (and truncating) anything.
 *
 * It runs inside a transaction and verifies before committing that no section,
 * teacher or classroom ends up double-booked in a period. If the move would
 * create a clash it rolls back and reports, rather than leaving the table in a
 * state the application considers invalid.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const { SLOTS } = require('../../backend/src/config/timetableSlots');

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

const onGrid = (st, en) =>
  SLOTS.some((s) => s.start_time === String(st) && s.end_time === String(en));

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
       FROM timetables ORDER BY timetable_id`
  );

  const offGrid = rows.filter((r) => !onGrid(r.start_time, r.end_time));

  console.log(`Total rows: ${rows.length}`);
  console.log(`Off-grid rows to move: ${offGrid.length}\n`);

  if (!offGrid.length) {
    console.log('Nothing to do - every row already sits on a slot.');
    await conn.end();
    return;
  }

  for (const r of offGrid) {
    const to = nearestSlot(r.start_time);
    console.log(`  id ${String(r.timetable_id).padEnd(5)} ${String(r.day_of_week).padEnd(10)} ` +
      `${String(r.start_time)}-${String(r.end_time)}  ->  ${to.start_time}-${to.end_time}`);
  }

  await conn.beginTransaction();

  try {
    let updated = 0;

    for (const r of offGrid) {
      const to = nearestSlot(r.start_time);
      const [res] = await conn.query(
        `UPDATE timetables SET start_time = ?, end_time = ? WHERE timetable_id = ?`,
        [to.start_time, to.end_time, r.timetable_id]
      );
      updated += res.affectedRows;
    }

    // Nothing may share a period with itself on any of the three resources.
    const clashSql = (col) =>
      `SELECT ${col} AS id, day_of_week, start_time, COUNT(*) n
         FROM timetables GROUP BY ${col}, day_of_week, start_time HAVING n > 1`;

    const clashes = [];
    for (const col of ['section_id', 'teacher_id', 'classroom_id']) {
      const [bad] = await conn.query(clashSql(col));
      bad.forEach((b) => clashes.push({ resource: col, ...b }));
    }

    if (clashes.length) {
      await conn.rollback();
      console.log(`\nROLLED BACK - the move would double-book ${clashes.length} period(s):`);
      clashes.slice(0, 20).forEach((c) =>
        console.log(`  ${c.resource}=${c.id} ${c.day_of_week} ${c.start_time} x${c.n}`));
      await conn.end();
      process.exit(1);
    }

    await conn.commit();
    console.log(`\nCommitted. ${updated} row(s) updated, 0 deleted, no clashes.`);

  } catch (e) {
    await conn.rollback();
    console.error('\nROLLED BACK:', e.message);
    await conn.end();
    process.exit(1);
  }

  const [after] = await conn.query(
    `SELECT start_time, end_time, COUNT(*) n
       FROM timetables GROUP BY start_time, end_time ORDER BY start_time`
  );

  console.log('\nPeriods now in the database:');
  for (const a of after) {
    console.log(`  ${String(a.start_time)}-${String(a.end_time)}  ${String(a.n).padStart(4)} rows   ` +
      (onGrid(a.start_time, a.end_time) ? 'on-grid' : '<-- STILL OFF-GRID'));
  }

  await conn.end();
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
