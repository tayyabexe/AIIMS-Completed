require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000,
  });

  // ---- 1. row counts for every table ----
  const [tbls] = await conn.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
  );
  console.log('=== FINAL ROW COUNTS (all 47 tables) ===');
  const loaded = [], empty = [];
  for (const { TABLE_NAME: t } of tbls) {
    const [c] = await conn.query('SELECT COUNT(*) AS c FROM `' + t + '`');
    (c[0].c > 0 ? loaded : empty).push([t, c[0].c]);
  }
  console.log('\nPOPULATED:');
  for (const [t, c] of loaded) console.log(`  ${t.padEnd(24)} ${String(c).padStart(6)}`);
  console.log('\nEMPTY (no data in the dump for these):');
  console.log('  ' + empty.map(([t]) => t).join(', '));

  // ---- 2. orphan / FK integrity check ----
  console.log('\n=== FK INTEGRITY (orphan row check) ===');
  const fkChecks = [
    ['users', 'role_id', 'roles', 'role_id'],
    ['role_permissions', 'role_id', 'roles', 'role_id'],
    ['role_permissions', 'permission_id', 'permissions', 'permission_id'],
    ['programs', 'department_id', 'departments', 'department_id'],
    ['departments', 'head_employee_id', 'employees', 'employee_id'],
    ['batches', 'program_id', 'programs', 'program_id'],
    ['sections', 'batch_id', 'batches', 'batch_id'],
    ['semesters', 'program_id', 'programs', 'program_id'],
    ['subjects', 'semester_id', 'semesters', 'semester_id'],
    ['subjects', 'prerequisite_subject_id', 'subjects', 'subject_id'],
    ['employees', 'user_id', 'users', 'user_id'],
    ['employees', 'department_id', 'departments', 'department_id'],
    ['teachers', 'employee_id', 'employees', 'employee_id'],
    ['timetables', 'subject_id', 'subjects', 'subject_id'],
    ['timetables', 'section_id', 'sections', 'section_id'],
    ['timetables', 'teacher_id', 'teachers', 'teacher_id'],
    ['timetables', 'classroom_id', 'classrooms', 'classroom_id'],
    ['students', 'user_id', 'users', 'user_id'],
    ['students', 'program_id', 'programs', 'program_id'],
    ['students', 'batch_id', 'batches', 'batch_id'],
    ['students', 'section_id', 'sections', 'section_id'],
    ['students', 'current_semester_id', 'semesters', 'semester_id'],
    ['parents', 'user_id', 'users', 'user_id'],
    ['student_guardians', 'student_id', 'students', 'student_id'],
    ['student_guardians', 'parent_id', 'parents', 'parent_id'],
    ['enrollments', 'student_id', 'students', 'student_id'],
    ['enrollments', 'subject_id', 'subjects', 'subject_id'],
    ['enrollments', 'semester_id', 'semesters', 'semester_id'],
    ['attendance', 'student_id', 'students', 'student_id'],
    ['attendance', 'subject_id', 'subjects', 'subject_id'],
    ['attendance', 'timetable_id', 'timetables', 'timetable_id'],
    ['attendance', 'marked_by', 'teachers', 'teacher_id'],
    ['exams', 'semester_id', 'semesters', 'semester_id'],
    ['exams', 'subject_id', 'subjects', 'subject_id'],
    ['exams', 'classroom_id', 'classrooms', 'classroom_id'],
    ['exams', 'invigilator_id', 'teachers', 'teacher_id'],
    ['marks', 'exam_id', 'exams', 'exam_id'],
    ['marks', 'student_id', 'students', 'student_id'],
    ['marks', 'entered_by', 'teachers', 'teacher_id'],
    ['marks', 'verified_by', 'teachers', 'teacher_id'],
    ['results', 'student_id', 'students', 'student_id'],
    ['results', 'semester_id', 'semesters', 'semester_id'],
    ['fee_structures', 'program_id', 'programs', 'program_id'],
    ['fee_structures', 'semester_id', 'semesters', 'semester_id'],
    ['student_fees', 'student_id', 'students', 'student_id'],
    ['student_fees', 'fee_structure_id', 'fee_structures', 'fee_structure_id'],
    ['payments', 'student_fee_id', 'student_fees', 'student_fee_id'],
    ['payments', 'recorded_by', 'employees', 'employee_id'],
  ];
  let orphanTotal = 0;
  for (const [ct, cc, pt, pc] of fkChecks) {
    const [r] = await conn.query(
      `SELECT COUNT(*) AS c FROM \`${ct}\` c LEFT JOIN \`${pt}\` p ON c.\`${cc}\` = p.\`${pc}\`
       WHERE c.\`${cc}\` IS NOT NULL AND p.\`${pc}\` IS NULL`
    );
    if (r[0].c > 0) { console.log(`  [X] ${ct}.${cc} -> ${pt}.${pc}: ${r[0].c} ORPHANS`); orphanTotal += r[0].c; }
  }
  console.log(orphanTotal === 0 ? '  [OK] Zero orphan rows across all 48 relationships.' : `  TOTAL ORPHANS: ${orphanTotal}`);

  // ---- 3. role distribution ----
  console.log('\n=== USERS BY ROLE ===');
  const [rd] = await conn.query(
    'SELECT r.role_id, r.role_name, COUNT(u.user_id) AS n FROM roles r LEFT JOIN users u ON u.role_id=r.role_id GROUP BY r.role_id, r.role_name ORDER BY r.role_id'
  );
  for (const r of rd) console.log(`  ${String(r.role_id).padStart(2)}. ${r.role_name.padEnd(16)} ${String(r.n).padStart(5)} users`);

  // ---- 4. password hash verification ----
  console.log('\n=== PASSWORD HASH CHECK (fake placeholders replaced?) ===');
  const [fake] = await conn.query("SELECT COUNT(*) AS c FROM users WHERE password_hash NOT LIKE '$2%'");
  console.log(`  users with non-bcrypt hash: ${fake[0].c}`);
  const [sample] = await conn.query(
    "SELECT u.email, u.password_hash, r.role_name FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_name='Student' LIMIT 1"
  );
  const ok = await bcrypt.compare('Student@1234', sample[0].password_hash);
  console.log(`  bcrypt verify for ${sample[0].email} with 'Student@1234': ${ok ? 'PASS' : 'FAIL'}`);

  // ---- 5. spot checks ----
  console.log('\n=== SPOT CHECKS ===');
  const [s1] = await conn.query(
    `SELECT s.student_id, s.registration_number, CONCAT(s.first_name,' ',s.last_name) AS name,
            p.program_name, b.batch_name, sec.section_name, sem.semester_number, u.email
     FROM students s
     JOIN programs p ON p.program_id=s.program_id
     JOIN batches b ON b.batch_id=s.batch_id
     LEFT JOIN sections sec ON sec.section_id=s.section_id
     LEFT JOIN semesters sem ON sem.semester_id=s.current_semester_id
     LEFT JOIN users u ON u.user_id=s.user_id
     WHERE s.student_id=1`
  );
  console.log('  student 1 joined:', JSON.stringify(s1[0]));

  const [g1] = await conn.query(
    `SELECT sg.student_id, sg.relationship, pa.first_name, pa.last_name, u.email
     FROM student_guardians sg JOIN parents pa ON pa.parent_id=sg.parent_id
     JOIN users u ON u.user_id=pa.user_id LIMIT 1`
  );
  console.log('  guardian link  :', JSON.stringify(g1[0]));

  const [f1] = await conn.query(
    `SELECT sf.voucher_number, sf.total_payable, sf.status, COUNT(p.payment_id) AS payments,
            COALESCE(SUM(p.amount_paid),0) AS paid
     FROM student_fees sf LEFT JOIN payments p ON p.student_fee_id=sf.student_fee_id
     WHERE sf.student_fee_id=1 GROUP BY sf.student_fee_id`
  );
  console.log('  fee + payment  :', JSON.stringify(f1[0]));

  // ---- 6. unique constraint sanity ----
  console.log('\n=== UNIQUE CONSTRAINT SANITY ===');
  for (const [t, c] of [['users', 'email'], ['students', 'cnic_bform'], ['students', 'registration_number'],
    ['employees', 'employee_code'], ['student_fees', 'voucher_number'], ['payments', 'receipt_number']]) {
    const [d] = await conn.query(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT \`${c}\`) AS distinct_vals FROM \`${t}\``
    );
    const flag = d[0].total === d[0].distinct_vals ? 'OK' : 'DUPLICATES!';
    console.log(`  ${t}.${c}: ${d[0].total} rows / ${d[0].distinct_vals} distinct -> ${flag}`);
  }

  await conn.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
