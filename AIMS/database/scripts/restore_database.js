'use strict';

// Restores a .sql backup produced by backup_database.js into a target
// database. Refuses to target the live `aims_db` directly - restore tests
// must go into a separate scratch database so a bad backup can never
// clobber the real data. Creates the target database if it doesn't exist.
//
// Usage: node scripts/restore_database.js <backup-file.sql> <target-db-name>

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const backupFile = process.argv[2];
  const targetDb = process.argv[3];

  if (!backupFile || !targetDb) {
    console.error('Usage: node scripts/restore_database.js <backup-file.sql> <target-db-name>');
    process.exit(1);
  }
  if (targetDb === process.env.DB_NAME) {
    console.error(`Refusing to restore into '${targetDb}' - that is the live database. Use a different (scratch/test) database name.`);
    process.exit(1);
  }

  const sql = fs.readFileSync(path.resolve(backupFile), 'utf8');

  const sslOptions = process.env.DB_SSL === 'true'
    ? { ca: fs.readFileSync(path.join(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true }
    : undefined;

  const admin = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: sslOptions,
  });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${targetDb}\``);
  await admin.end();
  console.log(`Target database '${targetDb}' ready.`);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: targetDb,
    ssl: sslOptions,
    multipleStatements: true,
  });

  console.log('Restoring... (this runs the whole dump as one multi-statement script)');
  await conn.query(sql);
  console.log('Restore finished.');

  const [[{ c: tableCount }]] = await conn.query(
    `SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE'`,
    [targetDb]
  );
  const [[{ c: viewCount }]] = await conn.query(
    `SELECT COUNT(*) c FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`,
    [targetDb]
  );
  const [[{ c: procCount }]] = await conn.query(
    `SELECT COUNT(*) c FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE='PROCEDURE'`,
    [targetDb]
  );
  console.log(`Restored: ${tableCount} tables, ${viewCount} views, ${procCount} procedures.`);

  await conn.end();
}

main().catch((e) => {
  console.error('RESTORE FAILED:', e.message);
  process.exit(1);
});
