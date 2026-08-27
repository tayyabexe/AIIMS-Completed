'use strict';

/*
 * Creates (or re-syncs) the MySQL account the AI assistant reads through.
 *
 * WHY THIS EXISTS
 * ---------------
 * The assistant's system prompt says it must never run INSERT/UPDATE/DELETE or
 * DDL. A prompt is a request, not a constraint — a model that is confused, or
 * successfully injected, can emit whatever SQL it likes, and the admin
 * text-to-SQL path is by design a channel for arbitrary generated statements.
 *
 * So the read-only property is enforced where it cannot be argued with: a
 * separate account holding nothing but SELECT. If every other guard in the
 * stack fails at once, the worst a generated statement can do is read.
 *
 * The application's own pool keeps using the full-privilege account. Nothing
 * about normal AIMS behaviour changes.
 *
 * WHAT IS DELIBERATELY WITHHELD
 * -----------------------------
 * SELECT is not granted uniformly. Some columns must not be reachable by a
 * generated query at all, because "the assistant will decline to show it" is
 * again only a request:
 *
 *   users.password_hash          - credential material
 *   users.profile_picture_data   - large binary, useless to a text model
 *   students.cnic_bform          - national identity number
 *   student_documents.file_data  - scanned identity documents
 *   employees.basic_salary       - HR compensation
 *   payroll (whole table)        - HR compensation
 *
 * These are excluded by granting SELECT on an explicit column list for those
 * tables, so the privilege system returns an error rather than relying on the
 * model's discretion.
 *
 * Usage:
 *   AI_DB_PASSWORD=<password> node scripts/create_ai_readonly_user.js
 *   AI_DB_PASSWORD=<password> node scripts/create_ai_readonly_user.js --keep-other-databases
 *
 * Idempotent: safe to re-run after adding a view or a table.
 *
 * ON --keep-other-databases
 * -------------------------
 * The default run DROPs the account, so it also drops whatever the account was
 * granted on every OTHER database on the server. That is the right thing when
 * there is one database, and the wrong thing the moment the backend is pointed
 * at a copy: granting the assistant on `aims_test1` would silently take its
 * access to `aims_db` away, and the failure only shows up the next time
 * somebody runs the other one.
 *
 * With this flag the account is kept and only THIS database's grants are
 * rebuilt — revoked table by table first, then re-granted — so the result for
 * `DB_NAME` is identical to a fresh account while other databases are left
 * alone. The revoke is what preserves the guarantee the DROP was there for: a
 * table that moves onto the denylist genuinely loses its grant, rather than
 * keeping a stale one a narrower re-grant would never remove.
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const AI_USER = process.env.AI_DB_USER || 'aims_ai_ro';
const AI_PASS = process.env.AI_DB_PASSWORD;
const KEEP_OTHERS = process.argv.includes('--keep-other-databases');

// Tables the assistant may never read, at any column.
const DENIED_TABLES = new Set([
  // HR compensation.
  'payroll',

  // The assistant's own storage. These hold every user's chat transcript, and
  // the arguments and SQL of every query anyone has ever run through it. If
  // the assistant could read them, one admin's text-to-SQL question could
  // return another user's private conversation, and any successful injection
  // would find the audit trail of its own earlier attempts sitting in the
  // same database it is querying. The application writes these through the
  // full-privilege pool; nothing needs to read them through this account.
  'assistant_conversations',
  'assistant_messages',
  'assistant_query_log',
]);

// Columns withheld from otherwise-readable tables.
const DENIED_COLUMNS = {
  users: ['password_hash', 'profile_picture_data'],
  students: ['cnic_bform'],
  student_documents: ['file_data'],
  employees: ['basic_salary'],
};

(async () => {
  if (!AI_PASS) {
    console.error('AI_DB_PASSWORD is not set. Refusing to create an account without one.');
    process.exit(1);
  }

  const db = process.env.DB_NAME;

  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 25000,
  });

  const q = async (sql, params) => (await c.query(sql, params))[0];

  // --- the account -------------------------------------------------------
  //
  // Dropped and recreated rather than ALTERed, so every run starts from no
  // privileges at all. A table that moves onto the denylist below then
  // actually loses its grant, instead of keeping a stale one that a
  // narrower re-grant would never remove.
  //
  // `REVOKE ALL PRIVILEGES ... FROM user` would be the tidier way to do that,
  // but it is a global operation and Aiven's avnadmin is explicitly revoked on
  // the mysql, sys and metrics_user_telegraf schemas, so the server rejects it
  // before it reaches aims_db. DROP + CREATE needs only CREATE USER, which
  // avnadmin does hold.
  //
  // The password is passed in from the environment, so recreating the account
  // reproduces the same credential the backend is already configured with.
  if (!KEEP_OTHERS) {
    await q(`DROP USER IF EXISTS ?@'%'`, [AI_USER]);
    await q(`CREATE USER ?@'%' IDENTIFIED BY ?`, [AI_USER, AI_PASS]);
  } else {
    // IF NOT EXISTS, so an existing account keeps the password the backend is
    // already using rather than having it silently reset out from under it.
    await q(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [AI_USER, AI_PASS]);

    /*
     * Clear this database's grants only.
     *
     * Each existing grant is revoked in exactly the form it was granted, by
     * turning the statement SHOW GRANTS reports back into its REVOKE. That
     * matters for the column-scoped tables: MySQL keeps column privileges in
     * their own table, and `REVOKE ALL PRIVILEGES ON db.tbl` does not touch
     * them — only `REVOKE SELECT (col, ...)` does. Echoing the statement back
     * also keeps the server's own quoting, so it parses under whatever
     * sql_mode is in force.
     *
     * Reading the grants rather than looping over information_schema also
     * catches a grant left behind by a table that has since been dropped,
     * which a table-driven revoke would never reach.
     */
    const existing = (await q(`SHOW GRANTS FOR ?@'%'`, [AI_USER]))
      .map((row) => Object.values(row)[0])
      .filter((statement) => new RegExp(`\\sON\\s+[\`"]?${db}[\`"]?\\.`, 'i').test(statement));

    for (const statement of existing) {
      const revoke = statement
        .replace(/^GRANT\s+/i, 'REVOKE ')
        .replace(/\s+WITH\s+GRANT\s+OPTION\s*$/i, '')
        .replace(/\sTO\s+(?=[^ ]+@)/i, ' FROM ');

      try {
        await q(revoke);
      } catch (error) {
        // 1147/1141: nothing there to revoke. Either is the state we wanted.
        if (error.errno !== 1147 && error.errno !== 1141) throw error;
      }
    }

    console.log(`revoked          : ${existing.length} existing grant(s) on ${db}`);
  }

  const tables = (await q(
    `SELECT table_name AS n, table_type AS t
       FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_name`,
    [db]
  )).map((r) => ({ name: r.n || r.N, type: r.t || r.T }));

  let grantedTables = 0;
  let grantedViews = 0;
  let columnScoped = 0;
  const skipped = [];

  for (const { name, type } of tables) {
    if (DENIED_TABLES.has(name)) {
      skipped.push(name);
      continue;
    }

    const denied = DENIED_COLUMNS[name];

    if (!denied) {
      // Identifiers cannot be parameterised, and these names come from
      // information_schema on this server rather than from any user input.
      await q(`GRANT SELECT ON \`${db}\`.\`${name}\` TO ?@'%'`, [AI_USER]);
    } else {
      const cols = (await q(
        `SELECT column_name AS c
           FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position`,
        [db, name]
      ))
        .map((r) => r.c || r.C)
        .filter((col) => !denied.includes(col));

      const list = cols.map((col) => `\`${col}\``).join(', ');
      await q(`GRANT SELECT (${list}) ON \`${db}\`.\`${name}\` TO ?@'%'`, [AI_USER]);
      columnScoped += 1;
    }

    if (type === 'VIEW') grantedViews += 1;
    else grantedTables += 1;
  }

  await q('FLUSH PRIVILEGES');

  console.log(`account          : ${AI_USER}@%`);
  console.log(`database         : ${db}${KEEP_OTHERS ? ' (other databases left untouched)' : ''}`);
  console.log(`base tables      : ${grantedTables} granted SELECT`);
  console.log(`views            : ${grantedViews} granted SELECT`);
  console.log(`column-scoped    : ${columnScoped} (${Object.keys(DENIED_COLUMNS).join(', ')})`);
  console.log(`withheld tables  : ${skipped.length ? skipped.join(', ') : 'none'}`);

  const grants = await q(`SHOW GRANTS FOR ?@'%'`, [AI_USER]);

  // Only the privilege list is checked, never the whole statement. A
  // column-scoped grant spells out its columns inline, and `created_at` /
  // `updated_at` / `last_password_change` contain the substrings CREATE,
  // UPDATE and CHANGE — matching against the raw text reports every correct
  // grant as a write privilege.
  const writes = grants
    .map((g) => Object.values(g)[0])
    .filter((statement) => {
      const privileges = statement
        .replace(/\([^)]*\)/g, '')                 // drop column lists
        .replace(/\s+ON\s+[\s\S]*$/i, '')          // keep only what precedes ON
        .replace(/^GRANT\s+/i, '');

      return /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT OPTION|ALL PRIVILEGES)\b/i
        .test(privileges);
    });

  if (writes.length) {
    console.error('\nFAILED: the account holds write privileges:\n', writes.join('\n'));
    process.exit(1);
  }

  console.log('\nverified: no write privilege present on the account');

  await c.end();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
