/**
 * Fixes the three residual defects found by verify_final.js:
 *
 *  1. TIMEZONE OFF-BY-ONE  - the driver returned DATE columns as JS Date objects
 *     in local time (PKT = UTC+5), so 2024-02-01 arrived as 2024-01-31T19:00Z and
 *     the UTC formatter emitted 2024-01-31 - one day BEFORE term start. That put
 *     628 attendance and 813 enrolment rows outside their own semester, and made
 *     26 payments.is_late flags wrong. Fixed by running the connection with
 *     dateStrings:true so dates never round-trip through a timezone.
 *
 *  2. FACULTY SHORTAGE - department 1 (Computer Science) had only 3 teachers but
 *     serves programs 1 and 2 = 25 weekly slots, while department 4 had 8 teachers
 *     for 5 slots. The timetable builder ran out of same-department teachers and
 *     fell back across departments 3 times. Fixed by hiring 5 CS faculty so supply
 *     matches demand, then rebuilding the timetable with a least-loaded assigner.
 *
 *  3. REMAINING CONSTANT COLUMNS - due dates, login counters and result status
 *     given realistic spread.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

let _seed = 987654;
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const shuffle = (a0) => { const a = [...a0]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
const d2 = (n) => String(n).padStart(2, '0');
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// pure string date arithmetic - never touches a timezone
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${d2(dt.getUTCMonth() + 1)}-${d2(dt.getUTCDate())}`;
};
const dowOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

async function ins(conn, table, cols, rows, bs = 2000) {
  if (!rows.length) return 0;
  let total = 0;
  const cl = cols.map((c) => '`' + c + '`').join(',');
  for (let i = 0; i < rows.length; i += bs) {
    const ch = rows.slice(i, i + bs);
    const ph = ch.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
    const flat = [];
    for (const r of ch) for (const c of cols) flat.push(r[c]);
    const [res] = await conn.query(`INSERT INTO \`${table}\` (${cl}) VALUES ${ph}`, flat);
    total += res.affectedRows;
  }
  return total;
}

const CS_FACULTY = [
  ['Sohail', 'Anwar', 'Assistant Professor', 'Algorithms & Theory'],
  ['Rabia', 'Mahmood', 'Lecturer', 'Database Systems'],
  ['Adnan', 'Farooq', 'Associate Professor', 'Artificial Intelligence & Machine Learning'],
  ['Hina', 'Tanveer', 'Lecturer', 'Computer Networks'],
  ['Yasir', 'Bashir', 'Assistant Professor', 'Cyber Security'],
];
const PROG_DEPT = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };

(async () => {
  const t0 = Date.now();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000,
    dateStrings: true,          // <-- the actual fix for defect #1
  });
  const log = (t, n) => console.log(`  ${t.padEnd(32)} ${String(n).padStart(7)}`);

  try {
    // ================================================ 1. HIRE CS FACULTY
    console.log('\nSTEP 1 - Hire CS faculty so department supply matches timetable demand\n');
    const [[{ mu }]] = await conn.query('SELECT MAX(user_id) mu FROM users');
    const [[{ me }]] = await conn.query('SELECT MAX(employee_id) me FROM employees');
    const [[{ trid }]] = await conn.query("SELECT role_id trid FROM roles WHERE role_name='Teacher'");
    const [[{ hash }]] = await conn.query('SELECT password_hash hash FROM users WHERE role_id=? LIMIT 1', [trid]);

    let uid = mu, eid = me;
    const nu = [], ne = [], nt = [];
    for (const [fn, ln, desig, spec] of CS_FACULTY) {
      uid++; eid++;
      nu.push({
        user_id: uid, email: `${fn.toLowerCase()}.${ln.toLowerCase()}@aims.edu.pk`,
        password_hash: hash, role_id: trid, phone: `+92-3${ri(0, 4)}${ri(0, 9)}-${ri(1000000, 9999999)}`,
        profile_picture: `uploads/avatars/${uid}.jpg`, is_active: 1, email_verified: 1,
        failed_login_attempts: 0, last_login: null, last_password_change: null, is_deleted: 0,
        created_at: '2023-01-01 00:00:00', updated_at: '2023-01-01 00:00:00',
      });
      ne.push({
        employee_id: eid, user_id: uid, employee_code: `EMP-${1100 + eid}`,
        first_name: fn, last_name: ln, department_id: 1, designation: desig,
        basic_salary: (130000 + ri(0, 60) * 1000).toFixed(2), hire_date: `20${ri(19, 22)}-0${ri(1, 9)}-${d2(ri(1, 28))}`,
        employment_status: 'Active', is_deleted: 0,
      });
      nt.push({ employee_id: eid, specialization: spec, is_deleted: 0 });
    }
    log('users (CS faculty)', await ins(conn, 'users',
      ['user_id', 'email', 'password_hash', 'role_id', 'phone', 'profile_picture', 'is_active', 'email_verified',
        'failed_login_attempts', 'last_login', 'last_password_change', 'is_deleted', 'created_at', 'updated_at'], nu));
    log('employees (CS faculty)', await ins(conn, 'employees',
      ['employee_id', 'user_id', 'employee_code', 'first_name', 'last_name', 'department_id', 'designation',
        'basic_salary', 'hire_date', 'employment_status', 'is_deleted'], ne));
    log('teachers (CS faculty)', await ins(conn, 'teachers', ['employee_id', 'specialization', 'is_deleted'], nt));

    // payroll + attendance for the new hires so HR data stays complete
    const [newEmps] = await conn.query('SELECT employee_id,basic_salary FROM employees WHERE employee_id > ?', [me]);
    const prRows = [];
    for (const e of newEmps) {
      for (const m of ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06']) {
        const b = Number(e.basic_salary);
        const al = Math.round(b * (0.15 + rnd() * 0.15)), de = Math.round(b * (0.05 + rnd() * 0.07));
        prRows.push({ employee_id: e.employee_id, month: m, basic_salary: b.toFixed(2), allowances: al.toFixed(2), deductions: de.toFixed(2), net_salary: (b + al - de).toFixed(2), generated_at: `${m}-28 18:00:00` });
      }
    }
    log('payroll (new hires)', await ins(conn, 'payroll',
      ['employee_id', 'month', 'basic_salary', 'allowances', 'deductions', 'net_salary', 'generated_at'], prRows));

    // ================================================ 2. REBUILD TIMETABLE
    console.log('\nSTEP 2 - Rebuild timetable with least-loaded, department-matched assignment\n');
    const [teachers] = await conn.query(
      'SELECT t.teacher_id,e.department_id FROM teachers t JOIN employees e ON e.employee_id=t.employee_id');
    const byDept = {};
    for (const t of teachers) (byDept[t.department_id] ||= []).push(t.teacher_id);
    console.log('  teachers per department:', JSON.stringify(Object.fromEntries(Object.entries(byDept).map(([k, v]) => [k, v.length]))));

    const [sections] = await conn.query(
      'SELECT sec.section_id,sec.batch_id,b.program_id FROM sections sec JOIN batches b ON b.batch_id=sec.batch_id');
    const [roomsR] = await conn.query('SELECT classroom_id FROM classrooms');
    const rooms = roomsR.map((r) => r.classroom_id);
    const [secSem] = await conn.query(
      'SELECT section_id, MIN(current_semester_id) sem FROM students GROUP BY section_id');
    const sectionSemester = Object.fromEntries(secSem.map((r) => [r.section_id, r.sem]));
    const [subsAll] = await conn.query('SELECT subject_id,semester_id FROM subjects');
    const subsBySem = {};
    for (const s of subsAll) (subsBySem[s.semester_id] ||= []).push(s);

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE attendance');
    await conn.query('TRUNCATE TABLE timetables');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    // The institute's period grid, imported rather than restated. This used to
    // be a literal ending 14:00-15:30, which drifted from the grid the API and
    // the portals use: generated rows landed in a 4th period the application
    // did not recognise, so a subject scheduled there showed up at a time no
    // slot column matched. Single source of truth: backend/src/config/timetableSlots.js
    const SLOTS = require('../../backend/src/config/timetableSlots')
      .SLOTS.map((s) => [s.start_time, s.end_time]);
    const busyT = new Set(), busyR = new Set(), busyS = new Set();
    const load = {};
    for (const t of teachers) load[t.teacher_id] = 0;

    const ttRows = [];
    let unplaced = 0;
    for (const sec of sections) {
      const semId = sectionSemester[sec.section_id];
      const pool = byDept[PROG_DEPT[sec.program_id]] || [];
      for (const su of (subsBySem[semId] || [])) {
        let placed = false;
        for (const day of DAYS) {
          for (const [st, en] of SLOTS) {
            if (busyS.has(`${sec.section_id}|${day}|${st}`)) continue;
            const room = rooms.find((r) => !busyR.has(`${r}|${day}|${st}`));
            if (room === undefined) continue;
            // least-loaded free teacher FROM THE CORRECT DEPARTMENT ONLY
            const free = pool.filter((t) => !busyT.has(`${t}|${day}|${st}`));
            if (!free.length) continue;
            free.sort((a, b) => load[a] - load[b]);
            const teacher = free[0];
            busyT.add(`${teacher}|${day}|${st}`); busyR.add(`${room}|${day}|${st}`);
            busyS.add(`${sec.section_id}|${day}|${st}`); load[teacher]++;
            ttRows.push({ subject_id: su.subject_id, section_id: sec.section_id, teacher_id: teacher, classroom_id: room, day_of_week: day, start_time: st, end_time: en });
            placed = true; break;
          }
          if (placed) break;
        }
        if (!placed) unplaced++;
      }
    }
    log('timetables', await ins(conn, 'timetables',
      ['subject_id', 'section_id', 'teacher_id', 'classroom_id', 'day_of_week', 'start_time', 'end_time'], ttRows));
    if (unplaced) console.log(`  [!] ${unplaced} subject(s) could not be placed`);

    // ================================================ 3. REBUILD ATTENDANCE (correct dates)
    console.log('\nSTEP 3 - Rebuild attendance with timezone-safe dates\n');
    const [students] = await conn.query('SELECT student_id,section_id,current_semester_id FROM students');
    const [semsR] = await conn.query('SELECT semester_id,start_date,end_date FROM semesters');
    const semById = Object.fromEntries(semsR.map((s) => [s.semester_id, s]));   // dates are STRINGS now
    const [ttAll] = await conn.query('SELECT timetable_id,subject_id,section_id,teacher_id,day_of_week FROM timetables');
    const ttBySec = {};
    for (const t of ttAll) (ttBySec[t.section_id] ||= []).push(t);

    const dayCache = {};
    const attRows = [];
    for (const st of students) {
      const sem = semById[st.current_semester_id];
      if (!sem) continue;
      if (!dayCache[st.current_semester_id]) {
        const map = {};
        let d = sem.start_date;
        while (d <= sem.end_date) { (map[dowOf(d)] ||= []).push(d); d = addDays(d, 1); }
        dayCache[st.current_semester_id] = map;
      }
      for (const slot of (ttBySec[st.section_id] || [])) {
        for (const day of shuffle(dayCache[st.current_semester_id][slot.day_of_week] || []).slice(0, 6)) {
          const r = rnd();
          attRows.push({
            student_id: st.student_id, subject_id: slot.subject_id, timetable_id: slot.timetable_id,
            att_date: day, status: r < 0.82 ? 'Present' : r < 0.91 ? 'Absent' : r < 0.975 ? 'Late' : 'Leave',
            marked_by: slot.teacher_id, created_at: `${day} ${d2(ri(8, 15))}:${d2(ri(0, 59))}:00`,
          });
        }
      }
    }
    log('attendance', await ins(conn, 'attendance',
      ['student_id', 'subject_id', 'timetable_id', 'att_date', 'status', 'marked_by', 'created_at'], attRows));

    // ================================================ 4. SQL-SIDE DATE FIXES
    console.log('\nSTEP 4 - Repair dates and flags in SQL (no timezone round-trip)\n');
    const [e1] = await conn.query(
      `UPDATE enrollments e JOIN semesters s ON s.semester_id=e.semester_id
       SET e.enrollment_date = s.start_date WHERE e.enrollment_date < s.start_date`);
    log('enrollment dates corrected', e1.affectedRows);
    const [e2] = await conn.query(
      `UPDATE enrollments e JOIN semesters s ON s.semester_id=e.semester_id
       SET e.enrollment_date = s.end_date WHERE e.enrollment_date > s.end_date`);
    log('enrollment dates (late) fixed', e2.affectedRows);

    // spread due dates instead of one identical value for every student
    const [e3] = await conn.query(
      `UPDATE student_fees sf JOIN students s ON s.student_id=sf.student_id
       JOIN semesters se ON se.semester_id=s.current_semester_id
       SET sf.due_date = DATE_ADD(se.start_date, INTERVAL (20 + (sf.student_fee_id % 5) * 7) DAY)`);
    log('student_fees.due_date spread', e3.affectedRows);

    // recompute is_late from the stored values - exact, no JS dates involved
    const [e4] = await conn.query(
      `UPDATE payments p JOIN student_fees sf ON sf.student_fee_id=p.student_fee_id
       SET p.is_late = (p.payment_date > sf.due_date)`);
    log('payments.is_late recomputed', e4.affectedRows);

    // any payment now sitting before its (shifted) fee row is harmless, but keep
    // Unpaid rows genuinely empty
    const [e5] = await conn.query(
      `DELETE p FROM payments p JOIN student_fees sf ON sf.student_fee_id=p.student_fee_id WHERE sf.status='Unpaid'`);
    log('stray payments on Unpaid fees', e5.affectedRows);

    // ================================================ 5. REMAINING CONSTANT COLUMNS
    console.log('\nSTEP 5 - Realistic spread for remaining constant columns\n');
    const [e6] = await conn.query(
      'UPDATE users SET failed_login_attempts = MOD(user_id, 7) WHERE MOD(user_id, 11) = 0');
    log('users.failed_login_attempts', e6.affectedRows);
    const [e7] = await conn.query(
      "UPDATE results SET status='Pending', published_at=NULL WHERE MOD(result_id, 13) = 0");
    log('results.status -> Pending', e7.affectedRows);
    const [e8] = await conn.query(
      'UPDATE books SET is_deleted=1 WHERE MOD(book_id, 17) = 0');
    log('books soft-deleted (withdrawn)', e8.affectedRows);

    // teacher_subjects must follow the rebuilt timetable
    await conn.query('TRUNCATE TABLE teacher_subjects');
    const tsSeen = new Set(); const tsRows = [];
    for (const sec of sections) {
      for (const slot of (ttBySec[sec.section_id] || [])) {
        const k = `${slot.teacher_id}|${slot.subject_id}|${sec.batch_id}`;
        if (tsSeen.has(k)) continue;
        tsSeen.add(k);
        tsRows.push({ teacher_id: slot.teacher_id, subject_id: slot.subject_id, batch_id: sec.batch_id });
      }
    }
    log('teacher_subjects', await ins(conn, 'teacher_subjects', ['teacher_id', 'subject_id', 'batch_id'], tsRows));

    console.log('\n' + '='.repeat(64));
    console.log('FIXES COMPLETE in', ((Date.now() - t0) / 1000).toFixed(1), 's');
    console.log('='.repeat(64));
  } catch (err) {
    console.error('\n*** FAILED ***\n', err.message);
    if (err.sql) console.error('SQL:', String(err.sql).slice(0, 400));
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
