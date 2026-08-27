'use strict';

/*
 * Creates the FIRST Super Admin account in a freshly-built AIMS database.
 *
 * WHY THIS EXISTS SEPARATELY FROM seed_test_baseline.js
 * -----------------------------------------------------
 * seed_test_baseline.js copies its reference tables (roles, permissions,
 * role_permissions, grades) out of an existing live database with `--source`.
 * That is fine while a live database exists, and useless the moment one does
 * not - which is the situation anybody rebuilding AIMS from the repository is
 * in.
 *
 * The rebuild path does not need a source database at all:
 *
 *   1. schema.sql          structure
 *   2. constraints.sql     foreign keys
 *   3. reference_data.sql  roles, permissions, grades, migration ledger
 *   4. THIS SCRIPT         one account to sign in with
 *
 * A database with no user cannot be signed into, and the admin screens are the
 * only way to create the second account. So exactly one account is made here,
 * and every other account is created through the application.
 *
 * The password is bcrypt-hashed here. It is never stored in plaintext, never
 * written to the repository, and printed once to this console so you can record
 * it in whatever the organisation uses to hold secrets.
 *
 * Usage:
 *   DB_NAME=aims_db node scripts/create_first_admin.js --password '<plaintext>'
 *                                                      [--email <address>]
 *
 * Refuses to run against a database that already holds a user, so it can never
 * quietly add a second administrator to a working system.
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const BCRYPT_ROUNDS = 10;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
};

const EMAIL = arg('email', 'superadmin@aims.edu.pk');
const PASSWORD = arg('password', null);

(async () => {
  if (!PASSWORD) {
    console.error("A password is required:  --password '<plaintext>'");
    console.error('');
    console.error('The application enforces only a minimum of 8 characters - there is no');
    console.error('complexity or reuse check. Use a long random password from a manager.');
    process.exit(1);
  }
  if (!process.env.DB_NAME) {
    console.error('DB_NAME is not set. Name the database explicitly, e.g.');
    console.error("  DB_NAME=aims_db node scripts/create_first_admin.js --password '...'");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true'
      ? { ca: fs.readFileSync(path.join(__dirname, '..', 'config/ca.pem')) }
      : undefined,
    connectTimeout: 20000,
  });

  console.log(`Target database: ${process.env.DB_NAME}\n`);

  // ---- refuse to touch a database that already has accounts ---------------
  const [[{ n: existingUsers }]] = await conn.query('SELECT COUNT(*) n FROM users');
  if (existingUsers > 0) {
    console.error(`This database already holds ${existingUsers} user(s). Refusing.`);
    console.error('Create further accounts through the admin screens, not this script.');
    await conn.end();
    process.exit(1);
  }

  // ---- the roles table must have been loaded first ------------------------
  const [[role]] = await conn.query(
    "SELECT role_id FROM roles WHERE role_name = 'Super Admin'");
  if (!role) {
    console.error("No 'Super Admin' row in `roles`.");
    console.error('Run reference_data.sql before this script.');
    await conn.end();
    process.exit(1);
  }

  const hash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  /*
   * Columns are listed explicitly rather than relying on defaults, because
   * full_name has no role record to be backfilled from for an administrator -
   * leaving it NULL makes the portal derive a display name from the email
   * address and greet the account as "Superadmin".
   *
   * must_change_password is 1: whoever runs this is handing the account to
   * somebody else, and the password typed on a command line has been in a
   * shell history.
   */
  const [res] = await conn.query(
    `INSERT INTO users
        (email, password_hash, role_id, full_name, is_active,
         must_change_password, failed_login_attempts, is_deleted,
         created_at, updated_at, last_password_change)
     VALUES (?, ?, ?, ?, 1, 1, 0, 0, NOW(), NOW(), NOW())`,
    [EMAIL, hash, role.role_id, 'Super Admin']
  );

  // Prove the hash verifies rather than assuming bcrypt did its job - a wrong
  // hash here locks you out of a database that has no other way in.
  const [[stored]] = await conn.query(
    'SELECT password_hash FROM users WHERE user_id = ?', [res.insertId]);
  const verifies = await bcrypt.compare(PASSWORD, stored.password_hash);

  console.log(`Super admin created (user_id ${res.insertId}, role_id ${role.role_id})`);
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password verifies against the stored hash: ${verifies ? 'yes' : 'NO - STOP'}`);
  console.log(`\n  The account must change its password at first sign-in.`);
  console.log(`  Record these credentials in your secret store now; they are not written anywhere.`);

  if (!verifies) process.exitCode = 1;
  await conn.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
