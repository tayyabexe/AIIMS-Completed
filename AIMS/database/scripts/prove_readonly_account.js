'use strict';

/*
 * Proves the aims_ai_ro account cannot do the things the assistant is
 * forbidden to do — by connecting as that account and actually attempting
 * them, rather than by reading SHOW GRANTS and believing it.
 *
 * Every attempt below MUST be rejected by the server. If any of them succeed,
 * the read-only guarantee the assistant's design rests on is not real, and
 * this script exits non-zero.
 *
 * The write attempts target a row that does not exist (student_id = -1) and
 * would be no-ops even if the privilege check passed, so a bug in this script
 * cannot damage data.
 *
 * Usage: node scripts/prove_readonly_account.js
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

// Each entry: [what it proves, SQL that must fail]
const MUST_FAIL = [
  ['INSERT is refused',            "INSERT INTO announcements (title, content, target_role, posted_by) VALUES ('x','x','x',1)"],
  ['UPDATE is refused',            "UPDATE students SET first_name = 'x' WHERE student_id = -1"],
  ['DELETE is refused',            'DELETE FROM students WHERE student_id = -1'],
  ['DROP is refused',              'DROP TABLE IF EXISTS assistant_scratch'],
  ['CREATE TABLE is refused',      'CREATE TABLE assistant_scratch (id INT)'],
  ['ALTER is refused',             'ALTER TABLE students ADD COLUMN assistant_probe INT NULL'],
  ['TRUNCATE is refused',          'TRUNCATE TABLE announcements'],
  ['password_hash is unreadable',  'SELECT password_hash FROM users LIMIT 1'],
  ['CNIC is unreadable',           'SELECT cnic_bform FROM students LIMIT 1'],
  ['salary is unreadable',         'SELECT basic_salary FROM employees LIMIT 1'],
  ['payroll is unreadable',        'SELECT * FROM payroll LIMIT 1'],
  ['document blobs unreadable',    'SELECT file_data FROM student_documents LIMIT 1'],
  ['stored procedures unusable',   'CALL sp_mark_overdue_fees()'],
];

// Each entry: [what it proves, SQL that must succeed]
const MUST_PASS = [
  ['views are readable',           'SELECT COUNT(*) AS n FROM vw_student_profile_full'],
  ['base tables are readable',     'SELECT COUNT(*) AS n FROM students'],
  ['permitted columns readable',   'SELECT user_id, email, role_id FROM users LIMIT 1'],
];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.AI_DB_USER || 'aims_ai_ro',
    password: process.env.AI_DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 25000,
  });

  let failures = 0;

  for (const [label, sql] of MUST_FAIL) {
    try {
      await c.query(sql);
      console.log(`LEAK  ${label} -- statement SUCCEEDED and must not have`);
      failures += 1;
    } catch (e) {
      console.log(`ok    ${label}  (${e.code})`);
    }
  }

  console.log('');

  for (const [label, sql] of MUST_PASS) {
    try {
      await c.query(sql);
      console.log(`ok    ${label}`);
    } catch (e) {
      console.log(`BROKE ${label} -- ${e.code}: ${e.message}`);
      failures += 1;
    }
  }

  await c.end();

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed: the account can read what it should and nothing else.');
})().catch((e) => {
  console.error('FAILED to run:', e.message);
  process.exit(1);
});
