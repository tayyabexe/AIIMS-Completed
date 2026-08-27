'use strict';

/*
 * Regenerates schema.sql and constraints.sql from the LIVE database, so both
 * files describe what is actually deployed rather than what the migrations were
 * believed to produce.
 *
 * Read-only against the server: it issues SHOW CREATE / information_schema
 * queries only, and never any DDL or DML.
 *
 *   schema.sql      - tables (structure only, no rows), then views, then
 *                     routines. Foreign keys are stripped out of the CREATE
 *                     TABLE statements and moved to constraints.sql, so the
 *                     file can be replayed top-to-bottom without ordering
 *                     failures.
 *   constraints.sql - every foreign key as an ALTER TABLE, plus the unique and
 *                     check constraints, applied after the tables exist.
 *
 * Usage: node scripts/generate_schema_from_live.js
 *
 * The database is chosen by DB_NAME in database/.env, which is routinely
 * pointed at the small test database. Override it for a one-off run without
 * editing the file:
 *
 *   DB_NAME=aims_db node scripts/generate_schema_from_live.js
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const c = await mysql.createConnection({
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
  const q = async (sql, p) => (await c.query(sql, p))[0];

  // The Aiven server runs with ANSI_QUOTES, which makes SHOW CREATE TABLE quote
  // every identifier with " instead of a backtick. Replayed on a stock MySQL
  // server those double quotes parse as string literals and the whole file
  // fails. Drop the session into a plain mode so the DDL we capture is portable.
  await c.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'");

  const dbName = process.env.DB_NAME;
  const stamp = new Date().toISOString();

  const tables = (await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name`
  )).map(r => r.TABLE_NAME || r.table_name);

  const viewRows = await q(
    `SELECT table_name, view_definition FROM information_schema.views
      WHERE table_schema=DATABASE() ORDER BY table_name`);

  // Some views select from other views, so alphabetical order fails to replay.
  // Sort them so a view is always created after everything it reads. Depth-first
  // over "does A's definition name B", which is enough here: MySQL forbids
  // circular view references, so this always terminates.
  const views = (() => {
    const names = viewRows.map(r => r.TABLE_NAME || r.table_name);
    const defOf = new Map(viewRows.map(r =>
      [r.TABLE_NAME || r.table_name, r.VIEW_DEFINITION || r.view_definition || '']));
    const deps = (v) => names.filter(o =>
      o !== v && new RegExp(`[\`"]${o}[\`"]|\\b${o}\\b`).test(defOf.get(v)));
    const out = [], seen = new Set(), stack = new Set();
    const visit = (v) => {
      if (seen.has(v) || stack.has(v)) return;   // stack guard: tolerate a cycle
      stack.add(v);
      for (const d of deps(v)) visit(d);
      stack.delete(v);
      seen.add(v);
      out.push(v);
    };
    names.forEach(visit);
    return out;
  })();

  // SQL_MODE is stored per routine and its body is quoted the way that mode
  // demands. The live server runs ANSI_QUOTES, so bodies come back with
  // double-quoted identifiers. Replay each routine under its own mode rather
  // than rewriting a body we do not fully parse.
  const routines = await q(
    `SELECT routine_name, routine_type, sql_mode FROM information_schema.routines
      WHERE routine_schema=DATABASE() ORDER BY routine_name`);

  // ------------------------------------------------------------- schema.sql
  const head = (what) => `-- =====================================================================
-- AIMS - ${what}
-- Generated from the LIVE database (${dbName}) on ${stamp}
-- Source of truth: the deployed schema, not the migration history.
-- Do not hand-edit; re-run \`node scripts/generate_schema_from_live.js\` instead.
-- =====================================================================

`;

  let schema = head('Database Schema (structure only)');

  /*
   * Tables that exist here and are reachable from nothing.
   *
   * Each was designed and never built: no route, no controller, no service
   * reads or writes them. They are listed because the schema alone cannot say
   * so, and a reader who assumes a table implies a feature will be wrong about
   * every one of these. Verified by searching backend/src for each name.
   *
   * Maintained by hand. If one of these grows an interface, or another table
   * loses its last caller, edit this list in
   * scripts/generate_schema_from_live.js - not in the generated schema.sql.
   */
  const UNREACHABLE = [
    ['books, book_issues', 'library circulation; sp_calculate_book_fines is written for it and never called'],
    ['payroll', 'salary processing'],
    ['employee_documents', 'staff document storage'],
    ['leave_requests', 'staff leave'],
    ['performance_evaluations', 'staff appraisal'],
    ['teacher_attendance', 'staff attendance'],
    ['scholarships', 'fee concessions; referenced only by a delete-guard count'],
    ['meeting_requests', 'parent-teacher meetings'],
    ['ai_predictions, prediction_models, prediction_history', 'an ML feature that was never wired up'],
    ['dashboard_widgets', 'configurable dashboards; the live pinned-card system uses analytics_dashboard_cards instead']
  ];

  schema += `-- ---------------------------------------------------------------------\n`;
  schema += `-- TABLES WITH NO APPLICATION CODE BEHIND THEM\n`;
  schema += `--\n`;
  schema += `-- These are part of the schema but are not read or written by any\n`;
  schema += `-- route, controller or service. A table here does NOT indicate a\n`;
  schema += `-- working feature. See docs/GAPS_AND_LIMITATIONS.md section 3.\n`;
  schema += `--\n`;
  for (const [names, purpose] of UNREACHABLE) {
    schema += `--   ${names}\n--       ${purpose}\n`;
  }
  schema += `--\n`;
  schema += `-- Two further tables, \`permissions\` and \`role_permissions\`, ARE\n`;
  schema += `-- populated but are never consulted: authorisation compares role ids\n`;
  schema += `-- only. Each carries a table COMMENT saying so.\n`;
  schema += `-- ---------------------------------------------------------------------\n\n`;

  schema += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

  const fkLines = [];

  for (const t of tables) {
    if (t === 'SequelizeMeta' || t === 'SequelizeData') continue;
    const [row] = await q(`SHOW CREATE TABLE \`${t}\``);
    let ddl = row['Create Table'];

    // Pull the CONSTRAINT ... FOREIGN KEY lines out into constraints.sql so
    // schema.sql replays cleanly regardless of table order.
    const kept = [];
    for (const line of ddl.split('\n')) {
      // The server runs in ANSI_QUOTES mode, so SHOW CREATE TABLE quotes
      // identifiers with " rather than the backticks the MySQL docs show.
      // Accept either, so this keeps working if that mode is ever turned off.
      const m = line.match(/^\s*CONSTRAINT\s+[`"]([^`"]+)[`"]\s+FOREIGN KEY\s+(.+?),?\s*$/);
      if (m) {
        // Normalise the clause back to backticks so the emitted SQL does not
        // depend on the server running in ANSI_QUOTES mode to parse.
        const clause = m[2].replace(/,$/, '').replace(/"([^"]+)"/g, '`$1`');
        fkLines.push(`ALTER TABLE \`${t}\`\n  ADD CONSTRAINT \`${m[1]}\` FOREIGN KEY ${clause};`);
      } else {
        kept.push(line);
      }
    }
    // Repair any dangling comma left on the line before the closing paren.
    for (let i = kept.length - 1; i >= 0; i--) {
      if (/^\)/.test(kept[i])) continue;
      kept[i] = kept[i].replace(/,\s*$/, '');
      break;
    }
    ddl = kept.join('\n');

    schema += `-- ------------------------------------------------- ${t}\n`;
    schema += `DROP TABLE IF EXISTS \`${t}\`;\n${ddl};\n\n`;
  }

  if (views.length) {
    schema += `\n-- =====================================================================\n`;
    schema += `-- Views (${views.length})\n`;
    schema += `-- =====================================================================\n\n`;
    for (const v of views) {
      const [row] = await q(`SHOW CREATE VIEW \`${v}\``);
      // Strip the DEFINER clause: it names an account that will not exist on
      // another server and would make the file fail to replay there.
      const ddl = row['Create View'].replace(/DEFINER=(`[^`]*`|"[^"]*")@(`[^`]*`|"[^"]*")\s*/i, '');
      schema += `DROP VIEW IF EXISTS \`${v}\`;\n${ddl};\n\n`;
    }
  }

  if (routines.length) {
    schema += `\n-- =====================================================================\n`;
    schema += `-- Stored routines (${routines.length})\n`;
    schema += `-- =====================================================================\n\n`;
    schema += `-- Each routine is replayed under the sql_mode it was created with:\n`;
    schema += `-- the bodies below are quoted the way that mode requires.\n`;
    schema += `SET @saved_sql_mode = @@session.sql_mode;\n\n`;
    for (const r of routines) {
      const name = r.ROUTINE_NAME || r.routine_name;
      const type = r.ROUTINE_TYPE || r.routine_type;
      const mode = r.SQL_MODE || r.sql_mode || '';
      const [row] = await q(`SHOW CREATE ${type} \`${name}\``);
      const ddl = (row[`Create ${type[0] + type.slice(1).toLowerCase()}`] || row['Create Procedure'] || row['Create Function'])
        .replace(/DEFINER=(`[^`]*`|"[^"]*")@(`[^`]*`|"[^"]*")\s*/i, '');
      schema += `SET SESSION sql_mode = '${mode.replace(/'/g, "''")}';\n`;
      schema += `DROP ${type} IF EXISTS \`${name}\`;\nDELIMITER $$\n${ddl}$$\nDELIMITER ;\n\n`;
    }
    schema += `SET SESSION sql_mode = @saved_sql_mode;\n\n`;
  }

  schema += `SET FOREIGN_KEY_CHECKS = 1;\n`;

  // -------------------------------------------------------- constraints.sql
  const uniques = await q(
    `SELECT tc.table_name, tc.constraint_name,
            GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position) cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
                                                   AND tc.table_name=kcu.table_name
      WHERE tc.table_schema=DATABASE() AND tc.constraint_type='UNIQUE'
      GROUP BY tc.table_name, tc.constraint_name
      ORDER BY tc.table_name, tc.constraint_name`);

  let checks = [];
  try {
    checks = await q(
      `SELECT cc.constraint_name, tc.table_name, cc.check_clause
         FROM information_schema.check_constraints cc
         JOIN information_schema.table_constraints tc
           ON cc.constraint_name=tc.constraint_name AND cc.constraint_schema=tc.table_schema
        WHERE cc.constraint_schema=DATABASE()
        ORDER BY tc.table_name, cc.constraint_name`);
  } catch { /* older servers have no check_constraints view */ }

  let cons = head('Constraints (foreign keys, unique keys, checks)');
  cons += `-- Run AFTER schema.sql. Foreign keys are kept out of the CREATE TABLE\n`;
  cons += `-- statements so tables can be created in any order.\n\n`;
  cons += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;
  cons += `-- ---------------------------------------------------------------------\n`;
  cons += `-- Foreign keys (${fkLines.length})\n`;
  cons += `-- ---------------------------------------------------------------------\n\n`;
  cons += fkLines.join('\n\n') + '\n\n';
  cons += `-- ---------------------------------------------------------------------\n`;
  cons += `-- Unique constraints (${uniques.length}) - declared inline in schema.sql,\n`;
  cons += `-- listed here for reference.\n`;
  cons += `-- ---------------------------------------------------------------------\n\n`;
  for (const u of uniques) {
    const tn = u.TABLE_NAME || u.table_name;
    const cn = u.CONSTRAINT_NAME || u.constraint_name;
    cons += `--   ${tn}.${cn} (${u.cols})\n`;
  }
  cons += `\n-- ---------------------------------------------------------------------\n`;
  cons += `-- Check constraints (${checks.length}) - SHOW CREATE TABLE already emits\n`;
  cons += `-- these inline, so schema.sql creates them. Re-adding them here would\n`;
  cons += `-- fail with "Duplicate check constraint name". Listed for reference.\n`;
  cons += `-- ---------------------------------------------------------------------\n\n`;
  if (checks.length) {
    for (const ck of checks) {
      const tn = ck.TABLE_NAME || ck.table_name;
      const cn = ck.CONSTRAINT_NAME || ck.constraint_name;
      const cl = (ck.CHECK_CLAUSE || ck.check_clause).replace(/\s+/g, ' ');
      cons += `--   ${tn}.${cn}\n--     CHECK ${cl}\n`;
    }
  } else {
    cons += `-- (none defined on the live database)\n`;
  }
  cons += `\n`;
  cons += `SET FOREIGN_KEY_CHECKS = 1;\n`;

  fs.writeFileSync(path.join(__dirname, '..', 'schema.sql'), schema);
  fs.writeFileSync(path.join(__dirname, '..', 'constraints.sql'), cons);

  console.log('schema.sql      ->', tables.length - 2, 'tables,', views.length, 'views,', routines.length, 'routines');
  console.log('constraints.sql ->', fkLines.length, 'foreign keys,', uniques.length, 'unique,', checks.length, 'checks');

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
