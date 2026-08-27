'use strict';

/*
 * Regenerates Live_DB_Schema_Reference.txt from the LIVE database.
 *
 * The previous edition of that document was maintained by hand (last dated
 * 2026-07-25, covering 45 tables) and had drifted: the fee consolidation and
 * the newer migrations left it describing tables that no longer exist and
 * omitting ones that do. Generating it removes the drift by construction.
 *
 * Read-only against the server: information_schema queries only, no DDL/DML.
 *
 * Usage: node scripts/generate_schema_reference.js
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'Live_DB_Schema_Reference.txt');
const RULE = '='.repeat(100);
const THIN = '-'.repeat(100);

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
  const col = (r, n) => r[n.toUpperCase()] ?? r[n];

  const tables = (await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_type='BASE TABLE'
        AND table_name NOT IN ('SequelizeMeta','SequelizeData')
      ORDER BY table_name`)).map(r => col(r, 'table_name'));

  const views = (await q(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema=DATABASE() ORDER BY table_name`)).map(r => col(r, 'table_name'));

  const routines = await q(
    `SELECT routine_name, routine_type FROM information_schema.routines
      WHERE routine_schema=DATABASE() ORDER BY routine_name`);

  const allFks = await q(
    `SELECT constraint_name, table_name, column_name,
            referenced_table_name, referenced_column_name
       FROM information_schema.key_column_usage
      WHERE table_schema=DATABASE() AND referenced_table_name IS NOT NULL
      ORDER BY table_name, constraint_name, ordinal_position`);

  let checks = [];
  try {
    checks = await q(
      `SELECT tc.table_name, cc.constraint_name, cc.check_clause
         FROM information_schema.check_constraints cc
         JOIN information_schema.table_constraints tc
           ON cc.constraint_name=tc.constraint_name
          AND cc.constraint_schema=tc.table_schema
        WHERE cc.constraint_schema=DATABASE()`);
  } catch { /* server too old for check_constraints */ }

  const now = new Date().toISOString().slice(0, 10);
  let out = '';
  out += RULE + '\n';
  out += 'AIMS DATABASE - FULL TABLE, FIELD, AND CONSTRAINT REFERENCE\n';
  out += RULE + '\n';
  out += `Generated: ${now}\n`;
  out += `Database : ${process.env.DB_NAME} (live)\n\n`;
  out += 'SOURCE OF THIS DOCUMENT:\n';
  out += '  Generated directly from the live database by\n';
  out += '  scripts/generate_schema_reference.js - every line below is read from\n';
  out += '  information_schema at generation time, so it cannot drift from what is\n';
  out += '  deployed.\n\n';
  out += '  Earlier editions of this file were maintained by hand and did drift.\n';
  out += '  Do not hand-edit; re-run the script instead.\n\n';
  out += 'SUMMARY:\n';
  out += `  Tables            : ${tables.length}\n`;
  out += `  Views             : ${views.length}\n`;
  out += `  Stored routines   : ${routines.length}\n`;
  out += `  Foreign keys      : ${new Set(allFks.map(f => col(f, 'constraint_name') + '|' + col(f, 'table_name'))).size}\n`;
  out += `  Check constraints : ${checks.length}\n\n`;

  out += RULE + '\nTABLES\n' + RULE + '\n\n';

  for (const t of tables) {
    const cols = await q(
      `SELECT column_name, column_type, is_nullable, column_key, column_default, extra
         FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name=?
        ORDER BY ordinal_position`, [t]);

    const idx = await q(
      `SELECT index_name, non_unique,
              GROUP_CONCAT(column_name ORDER BY seq_in_index) cols
         FROM information_schema.statistics
        WHERE table_schema=DATABASE() AND table_name=?
        GROUP BY index_name, non_unique ORDER BY index_name`, [t]);

    const [{ n: rowCount }] = await q(`SELECT COUNT(*) n FROM \`${t}\``);

    const pk = cols.filter(r => col(r, 'column_key') === 'PRI').map(r => col(r, 'column_name'));
    const auto = cols.some(r => String(col(r, 'extra') || '').includes('auto_increment'));

    out += `TABLE: ${t}\n${THIN}\n`;
    out += `Rows        : ${rowCount}\n`;
    out += `Primary Key : ${
      pk.length === 0 ? '(none)'
      : pk.length === 1 ? `${pk[0]} (single column${auto ? ', auto-increment' : ''})`
      : `(${pk.join(', ')})  [composite - no single ID column]`}\n\n`;

    out += `Columns (${cols.length}):\n`;
    for (const r of cols) {
      const name = col(r, 'column_name');
      const type = col(r, 'column_type');
      const nul = col(r, 'is_nullable') === 'YES' ? 'NULL' : 'NOT NULL';
      const def = col(r, 'column_default');
      const ex = col(r, 'extra');
      let line = `   ${String(name).padEnd(28)} ${String(type).padEnd(34)} ${nul.padEnd(9)}`;
      if (def !== null && def !== undefined) line += ` DEFAULT ${def}`;
      if (ex) line += ` ${ex}`;
      out += line.replace(/\s+$/, '') + '\n';
    }

    const tFks = allFks.filter(f => col(f, 'table_name') === t);
    if (tFks.length) {
      out += `\nForeign keys (${tFks.length}):\n`;
      for (const f of tFks) {
        out += `   ${col(f, 'constraint_name')}: ${col(f, 'column_name')} -> `
             + `${col(f, 'referenced_table_name')}.${col(f, 'referenced_column_name')}\n`;
      }
    }

    const tChecks = checks.filter(k => col(k, 'table_name') === t);
    if (tChecks.length) {
      out += `\nCheck constraints (${tChecks.length}):\n`;
      for (const k of tChecks) {
        out += `   ${col(k, 'constraint_name')}: ${col(k, 'check_clause')}\n`;
      }
    }

    if (idx.length) {
      out += `\nIndexes (${idx.length}):\n`;
      for (const i of idx) {
        const kind = String(col(i, 'index_name')) === 'PRIMARY' ? 'PRIMARY'
                   : Number(col(i, 'non_unique')) === 0 ? 'UNIQUE ' : 'INDEX  ';
        out += `   ${kind} ${String(col(i, 'index_name')).padEnd(46)} (${i.cols})\n`;
      }
    }

    out += '\n';
  }

  out += RULE + `\nVIEWS (${views.length})\n` + RULE + '\n\n';
  for (const v of views) {
    const cols = await q(
      `SELECT column_name, column_type FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`, [v]);
    out += `VIEW: ${v}\n${THIN}\nColumns (${cols.length}):\n`;
    for (const r of cols) {
      out += `   ${String(col(r, 'column_name')).padEnd(28)} ${col(r, 'column_type')}\n`;
    }
    out += '\n';
  }

  out += RULE + `\nSTORED ROUTINES (${routines.length})\n` + RULE + '\n\n';
  for (const r of routines) {
    const name = col(r, 'routine_name');
    const type = col(r, 'routine_type');
    const params = await q(
      `SELECT parameter_name, dtd_identifier, parameter_mode
         FROM information_schema.parameters
        WHERE specific_schema=DATABASE() AND specific_name=?
        ORDER BY ordinal_position`, [name]);
    out += `${type}: ${name}\n${THIN}\n`;
    if (params.length) {
      out += 'Parameters:\n';
      for (const p of params) {
        const pn = col(p, 'parameter_name');
        if (!pn) continue;
        out += `   ${String(col(p, 'parameter_mode') || '').padEnd(6)} ${String(pn).padEnd(24)} ${col(p, 'dtd_identifier')}\n`;
      }
    } else {
      out += '   (no parameters)\n';
    }
    out += '\n';
  }

  out += RULE + '\nEND OF REFERENCE\n' + RULE + '\n';

  fs.writeFileSync(OUT, out);
  console.log('Live_DB_Schema_Reference.txt ->',
    tables.length, 'tables,', views.length, 'views,', routines.length, 'routines,',
    out.split('\n').length, 'lines');

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
