'use strict';

/*
 * Regenerates reference_data.sql from the LIVE database.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * schema.sql and constraints.sql describe the STRUCTURE of the database. They
 * are deliberately empty of rows. But a structurally-perfect AIMS database
 * still cannot be signed into or used, because four tables hold values the
 * source code treats as fixed:
 *
 *   roles             Role ids are hardcoded in backend/src/config/roles.js and
 *                     frontend/src/api/roles.js. Role 1 IS Super Admin. These
 *                     are facts about the source, not data somebody chose.
 *   permissions       Seeded for completeness and referenced by foreign keys.
 *   role_permissions  NOTE: nothing currently reads these two. authorize() in
 *                     middlewares/rbac.middleware.js compares role ids only, so
 *                     access is role-level rather than permission-level. They
 *                     are included so the schema is internally consistent and
 *                     so a future permission-level check has data to read - not
 *                     because the running system consults them.
 *   grades            The grading scale. vw_class_performance_summary reads
 *                     grades.min_percentage to decide what a pass is, so with
 *                     no rows results and GPA compute WRONGLY rather than
 *                     computing empty - which is the worse failure, because it
 *                     looks like an answer.
 *
 * plus one bookkeeping table:
 *
 *   SequelizeMeta     The migration ledger. schema.sql excludes it, so a
 *                     database rebuilt from schema.sql alone looks to
 *                     sequelize-cli like a database with ZERO migrations
 *                     applied - and the next `db:migrate` tries to re-apply
 *                     every one onto a schema that already has them. Stamping the
 *                     ledger is what stops that.
 *
 * These used to be copied out of the live server at rebuild time. That made
 * every rebuild depend on the live server still existing. This file removes
 * that dependency: schema.sql + constraints.sql + reference_data.sql is a
 * complete, self-contained AIMS database that anyone can stand up anywhere.
 *
 * It contains NO personal data - no students, staff, parents, marks, fees or
 * attendance. Only the fixed values above.
 *
 * Read-only against the server.
 *
 * Usage:
 *   DB_NAME=aims_db node scripts/generate_reference_data.js
 */

require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Order matters: role_permissions references both roles and permissions.
const TABLES = ['roles', 'permissions', 'role_permissions', 'grades'];

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

  const lit = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  };

  const stamp = new Date().toISOString();
  let out = `-- =====================================================================
-- AIMS - Reference data
-- Generated from the LIVE database (${process.env.DB_NAME}) on ${stamp}
--
-- Run this AFTER schema.sql and constraints.sql.
--
-- This is the fixed data an AIMS database needs before anybody can sign in:
-- the role table the source hardcodes ids against, the permission grants, the
-- grading scale the GPA views read, and the migration ledger.
--
-- It contains NO personal data. No students, staff, parents, marks, fees or
-- attendance - those are created through the application.
--
-- Do not hand-edit; re-run \`node scripts/generate_reference_data.js\` instead.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

`;

  for (const t of TABLES) {
    const cols = (await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`, [t]
    )).map(r => r.COLUMN_NAME || r.column_name);
    const rows = await q(`SELECT * FROM \`${t}\``);

    out += `-- ------------------------------------------------- ${t} (${rows.length} rows)\n`;
    out += `DELETE FROM \`${t}\`;\n`;
    if (rows.length) {
      const colList = cols.map(x => `\`${x}\``).join(', ');
      out += `INSERT INTO \`${t}\` (${colList}) VALUES\n`;
      out += rows.map(r => `  (${cols.map(x => lit(r[x])).join(', ')})`).join(',\n') + ';\n';
    }
    out += '\n';
  }

  // ------------------------------------------------------- migration ledger
  const meta = await q('SELECT name FROM `SequelizeMeta` ORDER BY name');
  out += `-- =====================================================================
-- Migration ledger (${meta.length} migrations)
--
-- schema.sql already contains everything these migrations produce, so they
-- must NOT be run again. Stamping them here makes
-- \`npx sequelize-cli db:migrate:status\` read all-\`up\`, and makes the next
-- new migration the only one that runs.
-- =====================================================================

CREATE TABLE IF NOT EXISTS \`SequelizeMeta\` (
  \`name\` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (\`name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM \`SequelizeMeta\`;
INSERT INTO \`SequelizeMeta\` (\`name\`) VALUES
${meta.map(r => `  (${lit(r.name || r.NAME)})`).join(',\n')};

SET FOREIGN_KEY_CHECKS = 1;
`;

  fs.writeFileSync(path.join(__dirname, '..', 'reference_data.sql'), out);
  console.log('reference_data.sql ->',
    TABLES.join(', '), '+', meta.length, 'migration ledger rows');

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
