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
  const chk = async (label, sql) => {
    const n = (await one(sql))[0].bad;
    console.log(`  ${n === 0 || n === '0' ? '[OK]' : '[XX]'} ${label.padEnd(58)} bad=${n}`);
    return Number(n);
  };

  console.log('='.repeat(80));
  console.log('A. ROOT-CAUSE FIXES - are the original blockers structurally gone?');
  console.log('='.repeat(80));
  const cur = (await one(
    `SELECT p.program_id,p.duration_semesters claimed,COUNT(s.semester_id) actual
     FROM programs p LEFT JOIN semesters s ON s.program_id=p.program_id GROUP BY p.program_id`));
  console.log('  program semester completeness:');
  for (const r of cur) console.log(`     program ${r.program_id}: declares ${r.claimed}, has ${r.actual}  ${r.claimed === r.actual ? 'OK' : 'MISMATCH'}`);
  const subjPer = (await one(
    'SELECT MIN(c) mn, MAX(c) mx, AVG(c) av FROM (SELECT COUNT(*) c FROM subjects GROUP BY semester_id) x'))[0];
  console.log(`  subjects per semester: min=${subjPer.mn} max=${subjPer.mx} avg=${Number(subjPer.av).toFixed(1)}`);
  await chk('every section has a timetable', 'SELECT COUNT(*) bad FROM sections sec WHERE NOT EXISTS(SELECT 1 FROM timetables t WHERE t.section_id=sec.section_id)');
  await chk('every semester holding students has exams', 'SELECT COUNT(*) bad FROM (SELECT DISTINCT current_semester_id sid FROM students WHERE current_semester_id IS NOT NULL) s WHERE NOT EXISTS(SELECT 1 FROM exams e WHERE e.semester_id=s.sid)');
  await chk('every section sits in exactly ONE semester', 'SELECT COUNT(*) bad FROM (SELECT section_id FROM students GROUP BY section_id HAVING COUNT(DISTINCT current_semester_id)>1) x');
  await chk('every enrolled subject has a timetable slot for that section', `SELECT COUNT(*) bad FROM students s JOIN enrollments e ON e.student_id=s.student_id WHERE NOT EXISTS(SELECT 1 FROM timetables t WHERE t.section_id=s.section_id AND t.subject_id=e.subject_id)`);

  console.log('\n' + '='.repeat(80));
  console.log('B. TEMPORAL COHERENCE - everything inside its own semester term');
  console.log('='.repeat(80));
  await chk('attendance date inside student\'s semester term', `SELECT COUNT(*) bad FROM attendance a JOIN students s ON s.student_id=a.student_id JOIN semesters se ON se.semester_id=s.current_semester_id WHERE a.att_date < se.start_date OR a.att_date > se.end_date`);
  await chk('attendance weekday matches its timetable slot', 'SELECT COUNT(*) bad FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id WHERE DAYNAME(a.att_date) <> t.day_of_week');
  await chk('exam date inside its semester term', 'SELECT COUNT(*) bad FROM exams e JOIN semesters s ON s.semester_id=e.semester_id WHERE e.exam_date < s.start_date OR e.exam_date > s.end_date');
  await chk('enrollment date inside its semester term', 'SELECT COUNT(*) bad FROM enrollments e JOIN semesters s ON s.semester_id=e.semester_id WHERE e.enrollment_date < s.start_date OR e.enrollment_date > s.end_date');
  await chk('exam subject belongs to the exam semester', 'SELECT COUNT(*) bad FROM exams e JOIN subjects su ON su.subject_id=e.subject_id WHERE su.semester_id <> e.semester_id');

  console.log('\n' + '='.repeat(80));
  console.log('C. RELATIONAL COHERENCE');
  console.log('='.repeat(80));
  await chk('attendance: student section = timetable section', 'SELECT COUNT(*) bad FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id JOIN students s ON s.student_id=a.student_id WHERE s.section_id<>t.section_id');
  await chk('attendance: subject = timetable subject', 'SELECT COUNT(*) bad FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id WHERE a.subject_id<>t.subject_id');
  await chk('attendance: marked_by = slot teacher', 'SELECT COUNT(*) bad FROM attendance a JOIN timetables t ON t.timetable_id=a.timetable_id WHERE a.marked_by<>t.teacher_id');
  await chk('marks: exam semester = student semester', 'SELECT COUNT(*) bad FROM marks m JOIN exams e ON e.exam_id=m.exam_id JOIN students s ON s.student_id=m.student_id WHERE e.semester_id<>s.current_semester_id');
  await chk('marks: obtained <= exam total', 'SELECT COUNT(*) bad FROM marks m JOIN exams e ON e.exam_id=m.exam_id WHERE m.obtained_marks>e.total_marks');
  await chk('enrollments: subject belongs to that semester', 'SELECT COUNT(*) bad FROM enrollments e JOIN subjects su ON su.subject_id=e.subject_id WHERE su.semester_id<>e.semester_id');
  await chk('results: semester = student semester', 'SELECT COUNT(*) bad FROM results r JOIN students s ON s.student_id=r.student_id WHERE r.semester_id<>s.current_semester_id');
  await chk('scholarships: semester = student semester', 'SELECT COUNT(*) bad FROM scholarships sc JOIN students s ON s.student_id=sc.student_id WHERE sc.semester_id<>s.current_semester_id');
  await chk('timetable: no teacher double-booking', 'SELECT COUNT(*) bad FROM timetables a JOIN timetables b ON a.timetable_id<b.timetable_id AND a.day_of_week=b.day_of_week AND a.start_time=b.start_time WHERE a.teacher_id=b.teacher_id');
  await chk('timetable: no classroom double-booking', 'SELECT COUNT(*) bad FROM timetables a JOIN timetables b ON a.timetable_id<b.timetable_id AND a.day_of_week=b.day_of_week AND a.start_time=b.start_time WHERE a.classroom_id=b.classroom_id');
  await chk('timetable: no section double-booking', 'SELECT COUNT(*) bad FROM timetables a JOIN timetables b ON a.timetable_id<b.timetable_id AND a.day_of_week=b.day_of_week AND a.start_time=b.start_time WHERE a.section_id=b.section_id');
  await chk('timetable: teacher dept matches subject program dept', `SELECT COUNT(*) bad FROM timetables t JOIN teachers te ON te.teacher_id=t.teacher_id JOIN employees emp ON emp.employee_id=te.employee_id JOIN subjects su ON su.subject_id=t.subject_id JOIN semesters se ON se.semester_id=su.semester_id WHERE emp.department_id <> CASE se.program_id WHEN 1 THEN 1 WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 4 END`);
  await chk('subject prerequisite is in an earlier semester', 'SELECT COUNT(*) bad FROM subjects a JOIN subjects b ON b.subject_id=a.prerequisite_subject_id JOIN semesters sa ON sa.semester_id=a.semester_id JOIN semesters sb ON sb.semester_id=b.semester_id WHERE sb.semester_number >= sa.semester_number');
  await chk('teacher_subjects: subject & batch share a program', 'SELECT COUNT(*) bad FROM teacher_subjects ts JOIN subjects su ON su.subject_id=ts.subject_id JOIN semesters se ON se.semester_id=su.semester_id JOIN batches b ON b.batch_id=ts.batch_id WHERE se.program_id<>b.program_id');

  console.log('\n' + '='.repeat(80));
  console.log('D. FINANCE COHERENCE (previously all-identical)');
  console.log('='.repeat(80));
  await chk('fee structure matches student program', 'SELECT COUNT(*) bad FROM student_fees sf JOIN fee_structures fs ON fs.fee_structure_id=sf.fee_structure_id JOIN students s ON s.student_id=sf.student_id WHERE fs.program_id<>s.program_id');
  await chk('fee structure semester = student semester', 'SELECT COUNT(*) bad FROM student_fees sf JOIN fee_structures fs ON fs.fee_structure_id=sf.fee_structure_id JOIN students s ON s.student_id=sf.student_id WHERE fs.semester_id<>s.current_semester_id');
  await chk('is_late correctly reflects payment_date vs due_date', 'SELECT COUNT(*) bad FROM payments p JOIN student_fees sf ON sf.student_fee_id=p.student_fee_id WHERE p.is_late <> (p.payment_date > sf.due_date)');
  await chk('Unpaid fees have no payments', "SELECT COUNT(*) bad FROM student_fees sf WHERE sf.status='Unpaid' AND EXISTS(SELECT 1 FROM payments p WHERE p.student_fee_id=sf.student_fee_id)");
  await chk('Paid fees are fully covered by payments', "SELECT COUNT(*) bad FROM (SELECT sf.student_fee_id, sf.total_payable, COALESCE(SUM(p.amount_paid),0) paid FROM student_fees sf LEFT JOIN payments p ON p.student_fee_id=sf.student_fee_id WHERE sf.status='Paid' GROUP BY sf.student_fee_id) x WHERE ABS(paid-total_payable)>0.05");
  await chk('no payment exceeds its fee total', 'SELECT COUNT(*) bad FROM (SELECT sf.student_fee_id,sf.total_payable,SUM(p.amount_paid) paid FROM student_fees sf JOIN payments p ON p.student_fee_id=sf.student_fee_id GROUP BY sf.student_fee_id) x WHERE paid > total_payable + 0.05');
  const fv = (await one('SELECT COUNT(DISTINCT total_payable) n, MIN(total_payable) mn, MAX(total_payable) mx FROM student_fees'))[0];
  console.log(`  fee amount variety: ${fv.n} distinct values, range ${fv.mn} .. ${fv.mx}`);
  const rb = (await one('SELECT COUNT(DISTINCT recorded_by) n FROM payments'))[0];
  console.log(`  payments.recorded_by distinct employees: ${rb.n}  (was 1)`);
  const pd = (await one('SELECT COUNT(DISTINCT payment_date) n FROM payments'))[0];
  console.log(`  payments.payment_date distinct dates: ${pd.n}  (was 1)`);
  const il = (await one('SELECT SUM(is_late=1) late, SUM(is_late=0) ontime FROM payments'))[0];
  console.log(`  payments is_late split: late=${il.late} on-time=${il.ontime}  (was 0 late)`);

  console.log('\n' + '='.repeat(80));
  console.log('E. CHECK CONSTRAINTS + COVERAGE');
  console.log('='.repeat(80));
  for (const [l, q] of [
    ['books.available <= total', 'SELECT COUNT(*) bad FROM books WHERE available_copies>total_copies OR available_copies<0'],
    ['scholarship discount 0<x<=100', 'SELECT COUNT(*) bad FROM scholarships WHERE discount_percentage<=0 OR discount_percentage>100'],
    ['marks.obtained >= 0', 'SELECT COUNT(*) bad FROM marks WHERE obtained_marks<0'],
    ['exams.total_marks > 0', 'SELECT COUNT(*) bad FROM exams WHERE total_marks<=0'],
    ['payments.amount_paid > 0', 'SELECT COUNT(*) bad FROM payments WHERE amount_paid<=0'],
    ['student_fees.total_payable >= 0', 'SELECT COUNT(*) bad FROM student_fees WHERE total_payable<0'],
  ]) await chk(l, q);

  console.log('\n  student coverage (target 2000):');
  for (const [l, q] of [
    ['guardians', 'SELECT COUNT(DISTINCT student_id) n FROM student_guardians'],
    ['results', 'SELECT COUNT(DISTINCT student_id) n FROM results'],
    ['attendance', 'SELECT COUNT(DISTINCT student_id) n FROM attendance'],
    ['marks', 'SELECT COUNT(DISTINCT student_id) n FROM marks'],
    ['enrollments', 'SELECT COUNT(DISTINCT student_id) n FROM enrollments'],
    ['student_fees', 'SELECT COUNT(DISTINCT student_id) n FROM student_fees'],
    ['student_documents', 'SELECT COUNT(DISTINCT student_id) n FROM student_documents'],
  ]) {
    const n = (await one(q))[0].n;
    console.log(`     ${l.padEnd(20)} ${String(n).padStart(5)} / 2000  ${n === 2000 ? 'FULL' : 'partial'}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('F. FK INTEGRITY (all foreign keys)');
  console.log('='.repeat(80));
  const [fks] = await conn.query(
    'SELECT TABLE_NAME ct,COLUMN_NAME cc,REFERENCED_TABLE_NAME pt,REFERENCED_COLUMN_NAME pc FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
  let orph = 0;
  for (const f of fks) {
    const n = (await one(`SELECT COUNT(*) n FROM \`${f.ct}\` c LEFT JOIN \`${f.pt}\` p ON c.\`${f.cc}\`=p.\`${f.pc}\` WHERE c.\`${f.cc}\` IS NOT NULL AND p.\`${f.pc}\` IS NULL`))[0].n;
    if (n > 0) { console.log(`  [XX] ${f.ct}.${f.cc} -> ${f.pt}.${f.pc}: ${n}`); orph += n; }
  }
  console.log(`  Checked ${fks.length} foreign keys -> total orphans: ${orph}`);

  console.log('\n' + '='.repeat(80));
  console.log('G. MISSING-FIELD AUDIT');
  console.log('='.repeat(80));
  const [tbls] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME NOT IN ('SequelizeMeta','SequelizeData') ORDER BY TABLE_NAME");
  const empty = [], allNull = [], constant = [];
  // Soft-delete/status flags are meaningful even on tiny tables (a lookup table
  // with 4 rows and is_deleted=0 on all of them is still a real signal that
  // nothing has ever been soft-deleted there) - the n>5 noise filter below exists
  // to skip small tables where a coincidentally-constant *descriptive* column
  // (e.g. a category name) isn't informative, and would wrongly swallow these too.
  const GOVERNANCE_FLAGS = new Set(['is_deleted', 'is_active', 'is_archived']);
  let grand = 0;
  const counts = [];
  for (const { TABLE_NAME: t } of tbls) {
    const n = (await one(`SELECT COUNT(*) n FROM \`${t}\``))[0].n;
    counts.push([t, n]); grand += n;
    if (n === 0) { empty.push(t); continue; }
    const [cols] = await conn.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t]);
    for (const c of cols) {
      const r = (await one(`SELECT COUNT(\`${c.COLUMN_NAME}\`) nn, COUNT(DISTINCT \`${c.COLUMN_NAME}\`) dv FROM \`${t}\``))[0];
      if (r.nn === 0) allNull.push(`${t}.${c.COLUMN_NAME}`);
      else if (r.dv === 1 && (n > 5 || GOVERNANCE_FLAGS.has(c.COLUMN_NAME))) constant.push(`${t}.${c.COLUMN_NAME}`);
    }
  }
  console.log('  Empty tables      :', empty.length ? empty.join(', ') : '(none)');
  console.log('  All-NULL columns  :', allNull.length ? allNull.join(', ') : '(none)');
  console.log('  Constant columns  :', constant.length ? constant.join(', ') : '(none)');

  console.log('\n' + '='.repeat(80));
  console.log('H. FINAL ROW COUNTS');
  console.log('='.repeat(80));
  for (const [t, n] of counts) console.log(`  ${t.padEnd(26)} ${String(n).padStart(7)}`);
  console.log(`  ${'TOTAL'.padEnd(26)} ${String(grand).padStart(7)}`);

  await conn.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
