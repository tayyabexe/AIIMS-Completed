'use strict';

/*
 * Regenerates AIMS_ERD.dbml.txt from the LIVE database.
 *
 * The previous ERD was maintained by hand and had drifted: it used PascalCase
 * table names that do not exist on the server, and predated roughly half the
 * schema. Generating it means the diagram cannot disagree with the database.
 *
 * Read-only: information_schema queries only, no DDL and no DML.
 *
 * Output is DBML (dbdiagram.io), NOT Mermaid. Paste the file's contents into
 * https://dbdiagram.io to render the diagram.
 *
 * Usage:
 *   DB_NAME=aims_db node scripts/generate_erd_dbml.js
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Sequelize's own bookkeeping - not part of the data model.
const SKIP = new Set(['SequelizeMeta', 'SequelizeData']);

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
  await c.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'");
  const q = async (sql, p) => (await c.query(sql, p))[0];
  const dbName = process.env.DB_NAME;
  const lc = (r, k) => r[k.toUpperCase()] ?? r[k];

  const tables = (await q(
    `SELECT table_name, table_comment FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name`
  )).filter(r => !SKIP.has(lc(r, 'table_name')));

  const columns = await q(
    `SELECT table_name, column_name, column_type, is_nullable, column_key,
            extra, column_default, column_comment, ordinal_position
       FROM information_schema.columns
      WHERE table_schema=DATABASE()
      ORDER BY table_name, ordinal_position`);

  const fks = await q(
    `SELECT kcu.table_name, kcu.column_name,
            kcu.referenced_table_name, kcu.referenced_column_name,
            rc.delete_rule, rc.update_rule, kcu.constraint_name
       FROM information_schema.key_column_usage kcu
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = kcu.constraint_name
        AND rc.constraint_schema = kcu.table_schema
      WHERE kcu.table_schema=DATABASE() AND kcu.referenced_table_name IS NOT NULL
      ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position`);

  // Multi-column and composite indexes, so the diagram carries the real keys.
  const idx = await q(
    `SELECT table_name, index_name, non_unique,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) cols
       FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND index_name <> 'PRIMARY'
      GROUP BY table_name, index_name, non_unique
      ORDER BY table_name, index_name`);

  const views = await q(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema=DATABASE() ORDER BY table_name`);
  const routines = await q(
    `SELECT routine_name, routine_type FROM information_schema.routines
      WHERE routine_schema=DATABASE() ORDER BY routine_name`);

  // ------------------------------------------------------------------ enums
  // DBML cannot express MySQL's inline enum(...) as a column type, so each one
  // becomes a named Enum block and the column refers to it.
  const enums = new Map();      // "table.column" -> enum type name
  const enumBlocks = [];
  for (const col of columns) {
    const t = lc(col, 'table_name'), n = lc(col, 'column_name');
    const ct = lc(col, 'column_type');
    if (SKIP.has(t) || !/^enum\(/i.test(ct)) continue;
    const name = `${t}_${n}_enum`;
    const values = [...ct.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));
    enums.set(`${t}.${n}`, name);
    enumBlocks.push(`Enum ${name} {\n${values.map(v => `  "${v}"`).join('\n')}\n}`);
  }

  // ------------------------------------------------------------- dbml types
  const dbmlType = (col) => {
    const t = lc(col, 'table_name'), n = lc(col, 'column_name');
    const key = `${t}.${n}`;
    if (enums.has(key)) return enums.get(key);
    const ct = lc(col, 'column_type');
    // Strip display widths and attributes DBML has no use for; keep precision.
    return ct
      .replace(/\s+unsigned/gi, '')
      .replace(/\s+zerofill/gi, '')
      .replace(/^tinyint\(1\)$/i, 'boolean')
      .replace(/^int\(\d+\)$/i, 'int')
      .replace(/^bigint\(\d+\)$/i, 'bigint')
      .replace(/\s+CHARACTER SET .*/i, '')
      .replace(/\s+COLLATE .*/i, '')
      .trim();
  };

  const colsByTable = new Map();
  for (const col of columns) {
    const t = lc(col, 'table_name');
    if (SKIP.has(t)) continue;
    if (!colsByTable.has(t)) colsByTable.set(t, []);
    colsByTable.get(t).push(col);
  }

  const stamp = new Date().toISOString();
  let out = `// ============================================================
// AIMS - Entity Relationship Diagram
//
// Format: DBML (Database Markup Language) - NOT Mermaid, NOT SQL.
//
// HOW TO VIEW THIS:
//   1. Open https://dbdiagram.io
//   2. Paste the entire contents of this file into the left-hand editor
//   3. The diagram renders on the right; drag tables to rearrange,
//      and use Export to save a PNG or PDF
//
// Generated from the LIVE database (${dbName}) on ${stamp}
// Do not hand-edit: re-run \`node scripts/generate_erd_dbml.js\` instead,
// otherwise the diagram drifts away from the real schema.
//
// Contents: ${tables.length} tables, ${fks.length} foreign keys, ${enumBlocks.length} enums.
// The database also has ${views.length} views and ${routines.length} stored routines,
// which DBML cannot represent; they are listed as a note at the end.
// ============================================================

`;

  // ----------------------------------------------------------------- tables
  for (const tr of tables) {
    const t = lc(tr, 'table_name');
    const comment = (lc(tr, 'table_comment') || '').trim();
    out += `Table ${t} {\n`;
    for (const col of colsByTable.get(t) || []) {
      const n = lc(col, 'column_name');
      const settings = [];
      if (lc(col, 'column_key') === 'PRI') settings.push('pk');
      if (/auto_increment/i.test(lc(col, 'extra') || '')) settings.push('increment');
      if (lc(col, 'column_key') === 'UNI') settings.push('unique');
      if (lc(col, 'is_nullable') === 'NO' && lc(col, 'column_key') !== 'PRI') settings.push('not null');
      const def = lc(col, 'column_default');
      if (def !== null && def !== undefined && !/auto_increment/i.test(lc(col, 'extra') || '')) {
        const d = String(def);
        if (dbmlType(col) === 'boolean' && (d === '0' || d === '1')) {
          settings.push(`default: ${d === '1'}`);
        } else if (/^(CURRENT_TIMESTAMP|NULL|\()/i.test(d)) {
          // DBML wants backticks around an expression, quotes around a literal.
          settings.push(`default: \`${d}\``);
        } else {
          settings.push(`default: '${d.replace(/'/g, "\\'")}'`);
        }
      }
      const note = (lc(col, 'column_comment') || '').trim();
      if (note) settings.push(`note: '${note.replace(/'/g, "\\'")}'`);
      out += `  ${n} ${dbmlType(col)}${settings.length ? ` [${settings.join(', ')}]` : ''}\n`;
    }

    // cols is NULL for a functional index, whose expression lives in
    // statistics.expression rather than column_name. Skip those: DBML has no
    // way to express them, and schema.sql already carries the real definition.
    const myIdx = idx.filter(i =>
      lc(i, 'table_name') === t && (lc(i, 'cols') || '').includes(','));
    if (myIdx.length) {
      out += `\n  indexes {\n`;
      for (const i of myIdx) {
        const cols = lc(i, 'cols').split(',').join(', ');
        const uniq = String(lc(i, 'non_unique')) === '0' ? ' [unique]' : '';
        out += `    (${cols})${uniq}\n`;
      }
      out += `  }\n`;
    }

    if (comment) out += `\n  Note: '${comment.replace(/'/g, "\\'")}'\n`;
    out += `}\n\n`;
  }

  // ------------------------------------------------------------------ enums
  if (enumBlocks.length) {
    out += `// ============================================================\n`;
    out += `// Enums (${enumBlocks.length})\n`;
    out += `// ============================================================\n\n`;
    out += enumBlocks.join('\n\n') + '\n\n';
  }

  // --------------------------------------------------------- relationships
  out += `// ============================================================\n`;
  out += `// Relationships (${fks.length} foreign keys)\n`;
  out += `//   >  many-to-one   (the child side holds the key)\n`;
  out += `// ============================================================\n\n`;
  for (const f of fks) {
    const t = lc(f, 'table_name');
    if (SKIP.has(t)) continue;
    const col = lc(f, 'column_name');
    const rt = lc(f, 'referenced_table_name');
    const rc = lc(f, 'referenced_column_name');
    const del = lc(f, 'delete_rule');
    const upd = lc(f, 'update_rule');
    const acts = [];
    if (del && del !== 'NO ACTION') acts.push(`delete: ${del.toLowerCase()}`);
    if (upd && upd !== 'NO ACTION') acts.push(`update: ${upd.toLowerCase()}`);
    out += `Ref: ${t}.${col} > ${rt}.${rc}${acts.length ? ` [${acts.join(', ')}]` : ''}\n`;
  }

  // ------------------------------------------------------- what DBML omits
  out += `\n// ============================================================\n`;
  out += `// Not shown above - DBML has no syntax for these.\n`;
  out += `// See schema.sql for their full definitions.\n`;
  out += `// ============================================================\n//\n`;
  out += `// Views (${views.length}):\n`;
  for (const v of views) out += `//   ${lc(v, 'table_name')}\n`;
  out += `//\n// Stored routines (${routines.length}):\n`;
  for (const r of routines) out += `//   ${lc(r, 'routine_type')} ${lc(r, 'routine_name')}\n`;

  fs.writeFileSync(path.join(__dirname, '..', 'AIMS_ERD.dbml.txt'), out);
  console.log('AIMS_ERD.dbml.txt ->',
    tables.length, 'tables,', fks.length, 'refs,', enumBlocks.length, 'enums,',
    views.length, 'views listed,', routines.length, 'routines listed');

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
