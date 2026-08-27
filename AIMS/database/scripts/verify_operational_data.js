require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000,
  });
  const one = async (s, p) => (await conn.query(s, p))[0];

  console.log('='.repeat(78));
  console.log('1. STUDENT COVERAGE (target: 2000 / 2000)');
  console.log('='.repeat(78));
  const cov = [
    ['guardians', 'SELECT COUNT(DISTINCT student_id) n FROM student_guardians'],
    ['results', 'SELECT COUNT(DISTINCT student_id) n FROM results'],
    ['attendance', 'SELECT COUNT(DISTINCT student_id) n FROM attendance'],
    ['marks', 'SELECT COUNT(DISTINCT student_id) n FROM marks'],
    ['enrollments', 'SELECT COUNT(DISTINCT student_id) n FROM enrollments'],
    ['student_fees', 'SELECT COUNT(DISTINCT student_id) n FROM student_fees'],
    ['student_documents', 'SELECT COUNT(DISTINCT student_id) n FROM student_documents'],
  ];
  for (const [label, q] of cov) {
    const n = (await one(q))[0].n;
    console.log(`  ${label.padEnd(20)} ${String(n).padStart(5)} / 2000   ${n === 2000 ? 'FULL' : 'partial'}`);
  }

  console.log('\n' + '='.repeat(78));
  console.log('2. RELATIONSHIP COHERENCE (were the 479 / 450 bad rows fixed?)');
  console.log('='.repeat(78));
  const c1 = (await one(
    `SELECT SUM(s.section_id=t.section_id) ok, SUM(s.section_id<>t.section_id) bad
     FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id
     JOIN students s ON s.student_id=a.student_id`))[0];
  console.log(`  attendance: student's section matches timetable's section -> ok=${c1.ok} bad=${c1.bad}`);
  const c2 = (await one(
    `SELECT SUM(a.subject_id=t.subject_id) ok, SUM(a.subject_id<>t.subject_id) bad
     FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id`))[0];
  console.log(`  attendance: subject matches timetable's subject      -> ok=${c2.ok} bad=${c2.bad}`);
  const c2b = (await one(
    `SELECT SUM(a.marked_by=t.teacher_id) ok, SUM(a.marked_by<>t.teacher_id) bad
     FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id`))[0];
  console.log(`  attendance: marked_by is the slot's teacher           -> ok=${c2b.ok} bad=${c2b.bad}`);
  const c2c = (await one(
    `SELECT COUNT(*) bad FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id
     WHERE DAYNAME(a.att_date) <> t.day_of_week`))[0];
  console.log(`  attendance: att_date weekday matches slot's day       -> bad=${c2c.bad}`);
  const c3 = (await one(
    `SELECT SUM(e.semester_id=s.current_semester_id) ok, SUM(e.semester_id<>s.current_semester_id) bad
     FROM marks m JOIN exams e ON e.exam_id=m.exam_id JOIN students s ON s.student_id=m.student_id`))[0];
  console.log(`  marks: exam's semester matches student's semester     -> ok=${c3.ok} bad=${c3.bad}`);
  const c4 = (await one(
    `SELECT COUNT(*) bad FROM marks m JOIN exams e ON e.exam_id=m.exam_id WHERE m.obtained_marks > e.total_marks`))[0];
  console.log(`  marks: obtained never exceeds exam total             -> bad=${c4.bad}`);
  const c5 = (await one(
    `SELECT COUNT(*) bad FROM results r JOIN students s ON s.student_id=r.student_id
     WHERE r.semester_id <> s.current_semester_id`))[0];
  console.log(`  results: semester matches student's semester          -> bad=${c5.bad}`);
  const c6 = (await one(
    `SELECT COUNT(*) bad FROM teacher_subjects ts
     JOIN subjects su ON su.subject_id=ts.subject_id
     JOIN semesters se ON se.semester_id=su.semester_id
     JOIN batches b ON b.batch_id=ts.batch_id
     WHERE se.program_id <> b.program_id`))[0];
  console.log(`  teacher_subjects: subject & batch share a program     -> bad=${c6.bad}`);
  const c7 = (await one(
    `SELECT COUNT(*) bad FROM scholarships sc JOIN students s ON s.student_id=sc.student_id
     WHERE sc.semester_id <> s.current_semester_id`))[0];
  console.log(`  scholarships: semester matches student's semester     -> bad=${c7.bad}`);
  const c8 = (await one(
    `SELECT COUNT(*) bad FROM performance_evaluations WHERE employee_id = evaluated_by`))[0];
  console.log(`  performance_evaluations: nobody evaluates themselves  -> bad=${c8.bad}`);
  const c9 = (await one(
    `SELECT COUNT(*) bad FROM timetables t1 JOIN timetables t2
       ON t1.timetable_id < t2.timetable_id AND t1.day_of_week=t2.day_of_week AND t1.start_time=t2.start_time
     WHERE t1.teacher_id=t2.teacher_id OR t1.classroom_id=t2.classroom_id`))[0];
  console.log(`  timetables: no teacher/classroom double-booking       -> bad=${c9.bad}`);
  const c10 = (await one(
    `SELECT COUNT(*) bad FROM book_issues WHERE return_date IS NOT NULL AND return_date < issue_date`))[0];
  console.log(`  book_issues: return never precedes issue              -> bad=${c10.bad}`);
  const c11 = (await one(
    `SELECT COUNT(*) bad FROM leave_requests WHERE end_date < start_date`))[0];
  console.log(`  leave_requests: end never precedes start             -> bad=${c11.bad}`);
  const c12 = (await one(
    `SELECT COUNT(*) bad FROM payroll WHERE ABS(net_salary - (basic_salary + allowances - deductions)) > 0.01`))[0];
  console.log(`  payroll: net = basic + allowances - deductions        -> bad=${c12.bad}`);

  console.log('\n' + '='.repeat(78));
  console.log('3. CHECK CONSTRAINTS');
  console.log('='.repeat(78));
  const checks = [
    ['books.available <= total', 'SELECT COUNT(*) n FROM books WHERE available_copies > total_copies OR available_copies < 0 OR total_copies < 0'],
    ['scholarships.discount 0<x<=100', 'SELECT COUNT(*) n FROM scholarships WHERE discount_percentage <= 0 OR discount_percentage > 100'],
    ['marks.obtained >= 0', 'SELECT COUNT(*) n FROM marks WHERE obtained_marks < 0'],
    ['exams.total_marks > 0', 'SELECT COUNT(*) n FROM exams WHERE total_marks <= 0'],
    ['payments.amount_paid > 0', 'SELECT COUNT(*) n FROM payments WHERE amount_paid <= 0'],
    ['student_fees.total_payable >= 0', 'SELECT COUNT(*) n FROM student_fees WHERE total_payable < 0'],
    ['users.failed_logins >= 0', 'SELECT COUNT(*) n FROM users WHERE failed_login_attempts < 0'],
  ];
  for (const [label, q] of checks) {
    const n = (await one(q))[0].n;
    console.log(`  ${label.padEnd(34)} violations: ${n}`);
  }

  console.log('\n' + '='.repeat(78));
  console.log('4. FK INTEGRITY - every relationship in the database');
  console.log('='.repeat(78));
  const [fks] = await conn.query(
    `SELECT k.TABLE_NAME ct, k.COLUMN_NAME cc, k.REFERENCED_TABLE_NAME pt, k.REFERENCED_COLUMN_NAME pc
     FROM information_schema.KEY_COLUMN_USAGE k
     WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
  let orphans = 0;
  for (const f of fks) {
    const r = (await one(
      `SELECT COUNT(*) n FROM \`${f.ct}\` c LEFT JOIN \`${f.pt}\` p ON c.\`${f.cc}\`=p.\`${f.pc}\`
       WHERE c.\`${f.cc}\` IS NOT NULL AND p.\`${f.pc}\` IS NULL`))[0].n;
    if (r > 0) { console.log(`  [X] ${f.ct}.${f.cc} -> ${f.pt}.${f.pc}: ${r} orphans`); orphans += r; }
  }
  console.log(`  Checked ${fks.length} foreign keys. Total orphan rows: ${orphans}`);

  console.log('\n' + '='.repeat(78));
  console.log('5. MISSING-FIELD AUDIT - columns that exist but hold no data');
  console.log('='.repeat(78));
  const [tbls] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
     AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME NOT IN ('SequelizeMeta','SequelizeData') ORDER BY TABLE_NAME`);
  const emptyTables = [], allNullCols = [], constantCols = [];
  for (const { TABLE_NAME: t } of tbls) {
    const total = (await one(`SELECT COUNT(*) n FROM \`${t}\``))[0].n;
    if (total === 0) { emptyTables.push(t); continue; }
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [t]);
    for (const c of cols) {
      const r = (await one(
        `SELECT COUNT(\`${c.COLUMN_NAME}\`) nonnull, COUNT(DISTINCT \`${c.COLUMN_NAME}\`) distinctv FROM \`${t}\``))[0];
      if (r.nonnull === 0) allNullCols.push(`${t}.${c.COLUMN_NAME}`);
      else if (r.distinctv === 1 && total > 5) constantCols.push(`${t}.${c.COLUMN_NAME}`);
    }
  }
  console.log('\n  Tables still completely EMPTY:');
  console.log(emptyTables.length ? '    ' + emptyTables.join(', ') : '    (none)');
  console.log('\n  Columns where EVERY row is NULL (field exists but never populated):');
  console.log(allNullCols.length ? allNullCols.map((c) => '    ' + c).join('\n') : '    (none)');
  console.log('\n  Columns holding a single constant value (informational, not an error):');
  console.log(constantCols.length ? constantCols.map((c) => '    ' + c).join('\n') : '    (none)');

  console.log('\n' + '='.repeat(78));
  console.log('6. FINAL ROW COUNTS');
  console.log('='.repeat(78));
  let grand = 0;
  for (const { TABLE_NAME: t } of tbls) {
    const n = (await one(`SELECT COUNT(*) n FROM \`${t}\``))[0].n;
    grand += n;
    console.log(`  ${t.padEnd(26)} ${String(n).padStart(7)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(26)} ${String(grand).padStart(7)}`);

  await conn.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
