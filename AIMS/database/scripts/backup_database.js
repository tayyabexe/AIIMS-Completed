'use strict';

// Full logical backup of the AIMS database (structure + data + views + stored
// procedures), written as a single portable .sql file. Built as a Node/mysql2
// script instead of shelling out to `mysqldump` because neither mysqldump
// binary available on this machine (MariaDB 10.4, MySQL 5.5) supports the
// `caching_sha2_password` auth plugin MySQL 8 uses - both fail to connect to
// the Aiven server. This produces the same result (a portable SQL dump) using
// the same mysql2 driver the rest of this project already depends on.
//
// Usage: node scripts/backup_database.js [output-path]
// Defaults to database/backups/aims_db_backup_<timestamp>.sql (gitignored -
// this file contains real student/staff PII and must never be committed).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const OUTPUT_DIR = path.join(__dirname, '..', 'backups');

function escapeValue(conn, value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return conn.escape(value);
  if (value instanceof Date) return conn.escape(value);
  if (typeof value === 'object') return conn.escape(JSON.stringify(value));
  return conn.escape(value);
}

async function main() {
  const outPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(OUTPUT_DIR, `aims_db_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true'
      ? { ca: fs.readFileSync(path.join(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true }
      : undefined,
  });

  const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  const write = (s) => out.write(s + '\n');

  write(`-- AIMS database backup`);
  write(`-- Source: ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  write(`-- Generated: ${new Date().toISOString()}`);
  write(`SET NAMES utf8mb4;`);
  write(`SET FOREIGN_KEY_CHECKS=0;`);
  write('');

  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    [process.env.DB_NAME]
  );

  let totalRows = 0;
  for (const { TABLE_NAME: table } of tables) {
    const [[createRow]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    write(`-- ---- table: ${table} ----`);
    write(`DROP TABLE IF EXISTS \`${table}\`;`);
    write(`${createRow['Create Table']};`);

    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    const colList = columns.map((c) => `\`${c}\``).join(', ');
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const valueRows = chunk.map(
        (r) => `(${columns.map((c) => escapeValue(conn, r[c])).join(', ')})`
      );
      write(`INSERT INTO \`${table}\` (${colList}) VALUES\n${valueRows.join(',\n')};`);
    }
    totalRows += rows.length;
    console.log(`  dumped ${table}: ${rows.length} rows`);
  }

  write('');
  const [views] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [process.env.DB_NAME]
  );
  for (const { TABLE_NAME: view } of views) {
    const [[createRow]] = await conn.query(`SHOW CREATE VIEW \`${view}\``);
    write(`-- ---- view: ${view} ----`);
    write(`DROP VIEW IF EXISTS \`${view}\`;`);
    write(`${createRow['Create View']};`);
  }
  console.log(`  dumped ${views.length} views`);

  write('');
  const [routines] = await conn.query(
    `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME`,
    [process.env.DB_NAME]
  );
  write(`-- (no DELIMITER directive needed - each CREATE PROCEDURE below is sent to the server as one statement)`);
  for (const { ROUTINE_NAME: proc } of routines) {
    const [[createRow]] = await conn.query(`SHOW CREATE PROCEDURE \`${proc}\``);
    write(`-- ---- procedure: ${proc} ----`);
    write(`DROP PROCEDURE IF EXISTS \`${proc}\`;`);
    write(`${createRow['Create Procedure']};`);
  }
  console.log(`  dumped ${routines.length} procedures`);

  write('');
  write(`SET FOREIGN_KEY_CHECKS=1;`);

  await new Promise((resolve) => out.end(resolve));
  await conn.end();

  const stats = fs.statSync(outPath);
  console.log(`\nBackup complete: ${outPath}`);
  console.log(`Tables: ${tables.length}, Views: ${views.length}, Procedures: ${routines.length}, Total data rows: ${totalRows}`);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error('BACKUP FAILED:', e.message);
  process.exit(1);
});
