// Audit the live AIMS database against the repo's migrations / models /
// seeders, and report every mismatch. Read-only: issues no DDL or DML.
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Resolved relative to this file, so the script survives the project folder
// being renamed or moved.
const DB = path.join(__dirname, '..');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { ca: fs.readFileSync(path.join(DB, 'config/ca.pem')) } : undefined,
    connectTimeout: 20000,
  });

  const q = async (sql, p) => (await c.query(sql, p))[0];

  // ---------- live inventory ----------
  const tables = (await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name`
  )).map(r => r.TABLE_NAME || r.table_name);

  const views = (await q(
    `SELECT table_name FROM information_schema.views
      WHERE table_schema=DATABASE() ORDER BY table_name`
  )).map(r => r.TABLE_NAME || r.table_name);

  const procs = await q(
    `SELECT routine_name, routine_type FROM information_schema.routines
      WHERE routine_schema=DATABASE() ORDER BY routine_name`);

  const fks = await q(
    `SELECT constraint_name, table_name, column_name, referenced_table_name, referenced_column_name
       FROM information_schema.key_column_usage
      WHERE table_schema=DATABASE() AND referenced_table_name IS NOT NULL
      ORDER BY table_name, constraint_name`);

  console.log('==================== LIVE DATABASE ====================');
  console.log('Tables     :', tables.length);
  console.log('Views      :', views.length);
  console.log('Routines   :', procs.length, procs.map(p => `${p.ROUTINE_NAME || p.routine_name}(${p.ROUTINE_TYPE || p.routine_type})`).join(', '));
  console.log('Foreign keys:', fks.length);
  console.log('\nTables:', tables.join(', '));
  console.log('\nViews :', views.join(', '));

  // ---------- migration tracking ----------
  let applied = [];
  try {
    applied = (await q('SELECT name FROM SequelizeMeta ORDER BY name')).map(r => r.name);
  } catch { console.log('\n(no SequelizeMeta table)'); }
  const onDisk = fs.readdirSync(path.join(DB, 'migrations')).filter(f => f.endsWith('.js')).sort();

  console.log('\n==================== MIGRATIONS ====================');
  console.log('On disk :', onDisk.length);
  console.log('Applied :', applied.length);
  const notApplied = onDisk.filter(m => !applied.includes(m));
  const notOnDisk = applied.filter(m => !onDisk.includes(m));
  console.log('\nOn disk but NOT applied to live DB (' + notApplied.length + '):');
  notApplied.forEach(m => console.log('   -', m));
  console.log('\nApplied to live DB but MISSING from disk (' + notOnDisk.length + '):');
  notOnDisk.forEach(m => console.log('   -', m));

  // ---------- seeders ----------
  let seeded = [];
  try { seeded = (await q('SELECT name FROM SequelizeData ORDER BY name')).map(r => r.name); } catch {}
  const seedersOnDisk = fs.readdirSync(path.join(DB, 'seeders')).filter(f => f.endsWith('.js')).sort();
  console.log('\n==================== SEEDERS ====================');
  console.log('On disk:', seedersOnDisk.length, '| tracked in DB:', seeded.length);

  // ---------- models vs tables ----------
  const modelFiles = fs.readdirSync(path.join(DB, 'models')).filter(f => f.endsWith('.js') && f !== 'index.js');
  console.log('\n==================== MODELS vs LIVE TABLES ====================');
  console.log('Model files:', modelFiles.length);

  const { Sequelize, DataTypes } = require(path.join(DB, 'node_modules/sequelize'));
  const sq = new Sequelize('x', 'y', 'z', { dialect: 'mysql', logging: false });
  const problems = [];
  for (const f of modelFiles) {
    let m;
    try { m = require(path.join(DB, 'models', f))(sq, DataTypes); }
    catch (e) { problems.push(`${f}: FAILED TO LOAD - ${e.message}`); continue; }
    const tn = m.getTableName();
    if (!tables.includes(tn)) { problems.push(`${f}: table '${tn}' NOT in live DB`); continue; }
    const live = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name=?`, [tn]);
    const liveCols = new Set(live.map(r => (r.COLUMN_NAME || r.column_name)));
    const modelCols = Object.values(m.rawAttributes).map(a => a.field || a.fieldName);
    const missing = modelCols.filter(col => !liveCols.has(col));
    if (missing.length) problems.push(`${f} (${tn}): model declares columns absent from live DB -> ${missing.join(', ')}`);
  }
  console.log(problems.length ? problems.map(p => '   ! ' + p).join('\n') : '   All models map onto live tables with matching columns.');

  // ---------- tables with no model ----------
  const modelTables = new Set();
  for (const f of modelFiles) {
    try { modelTables.add(require(path.join(DB, 'models', f))(sq, DataTypes).getTableName()); } catch {}
  }
  const noModel = tables.filter(t => !modelTables.has(t) && t !== 'SequelizeMeta' && t !== 'SequelizeData');
  console.log('\nLive tables with NO Sequelize model (' + noModel.length + '):');
  console.log('   ' + (noModel.join(', ') || '(none)'));

  // ---------- row counts ----------
  console.log('\n==================== ROW COUNTS ====================');
  for (const t of tables) {
    const [r] = await q(`SELECT COUNT(*) n FROM \`${t}\``);
    console.log('   ' + t.padEnd(32) + String(r.n).padStart(8));
  }

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
