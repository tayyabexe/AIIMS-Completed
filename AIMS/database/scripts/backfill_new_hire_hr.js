/**
 * The 5 CS faculty hired in fix_residual_issues.js received payroll, but the
 * other HR tables were populated before they existed. This backfills them so
 * every employee has a complete HR record.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let _seed = 5150;
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const shuffle = (a0) => { const a = [...a0]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
const d2 = (n) => String(n).padStart(2, '0');

async function ins(conn, table, cols, rows, bs = 1000) {
  if (!rows.length) return 0;
  let total = 0;
  const cl = cols.map((c) => '`' + c + '`').join(',');
  for (let i = 0; i < rows.length; i += bs) {
    const ch = rows.slice(i, i + bs);
    const ph = ch.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
    const flat = [];
    for (const r of ch) for (const c of cols) flat.push(r[c]);
    const [res] = await conn.query(`INSERT INTO \`${table}\` (${cl}) VALUES ${ph}`, flat);
    total += res.affectedRows;
  }
  return total;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000, dateStrings: true,
  });
  const log = (t, n) => console.log(`  ${t.padEnd(30)} ${String(n).padStart(6)}`);

  try {
    const [missing] = await conn.query(
      `SELECT employee_id FROM employees e
       WHERE NOT EXISTS(SELECT 1 FROM teacher_attendance ta WHERE ta.employee_id=e.employee_id)`);
    console.log('\nBackfilling HR records for', missing.length, 'employee(s)\n');
    if (!missing.length) { await conn.end(); return; }
    const ids = missing.map((m) => m.employee_id);

    // teacher_attendance - same Mar-May 2024 window as the rest of the staff
    const [range] = await conn.query(
      'SELECT MIN(att_date) mn, MAX(att_date) mx FROM teacher_attendance');
    const days = [];
    let d = range[0].mn;
    while (d <= range[0].mx) {
      const [y, m, dd] = d.split('-').map(Number);
      const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
      if (wd !== 0 && wd !== 6) days.push(d);
      const nx = new Date(Date.UTC(y, m - 1, dd + 1));
      d = `${nx.getUTCFullYear()}-${d2(nx.getUTCMonth() + 1)}-${d2(nx.getUTCDate())}`;
    }
    const taRows = [];
    for (const id of ids) {
      for (const day of days) {
        const r = rnd();
        const status = r > 0.94 ? 'Absent' : r > 0.90 ? 'Leave' : r > 0.82 ? 'Late' : 'Present';
        const off = status === 'Absent' || status === 'Leave';
        taRows.push({
          employee_id: id, att_date: day,
          check_in: off ? null : `${d2(status === 'Late' ? ri(9, 10) : 8)}:${d2(ri(0, 59))}:00`,
          check_out: off ? null : `${d2(ri(15, 17))}:${d2(ri(0, 59))}:00`,
          status,
        });
      }
    }
    log('teacher_attendance', await ins(conn, 'teacher_attendance',
      ['employee_id', 'att_date', 'check_in', 'check_out', 'status'], taRows));

    const EDOC = ['CNIC Copy', 'Degree Certificate', 'Experience Letter', 'Appointment Letter',
      'Domicile Certificate', 'Medical Certificate', 'Police Verification'];
    const edRows = [];
    for (const id of ids) {
      for (const dt of shuffle(EDOC).slice(0, ri(3, 5))) {
        edRows.push({
          employee_id: id, doc_type: dt,
          file_url: `uploads/employees/${id}/${dt.toLowerCase().replace(/\s+/g, '_')}.pdf`,
          verified: chance(0.8) ? 1 : 0,
        });
      }
    }
    log('employee_documents', await ins(conn, 'employee_documents',
      ['employee_id', 'doc_type', 'file_url', 'verified'], edRows));

    const [evalR] = await conn.query(
      "SELECT employee_id FROM employees WHERE designation REGEXP 'HR|Administrator|Chief'");
    const evaluators = evalR.length ? evalR.map((e) => e.employee_id) : [1];
    const REMARKS = {
      Excellent: 'Outstanding start; strong student feedback in first evaluation cycle.',
      Good: 'Settled well into the department with reliable delivery.',
      Average: 'Satisfactory onboarding; encouraged to increase research output.',
      Poor: 'Needs improvement in result submission timelines.',
    };
    const peRows = [];
    for (const id of ids) {
      for (const period of ['2023-Annual', '2024-Mid Year']) {
        const r = rnd();
        const rating = r < 0.3 ? 'Excellent' : r < 0.72 ? 'Good' : r < 0.93 ? 'Average' : 'Poor';
        let ev = pick(evaluators);
        if (ev === id) ev = evaluators.find((x) => x !== id) ?? evaluators[0];
        peRows.push({ employee_id: id, evaluation_period: period, rating, remarks: REMARKS[rating], evaluated_by: ev });
      }
    }
    log('performance_evaluations', await ins(conn, 'performance_evaluations',
      ['employee_id', 'evaluation_period', 'rating', 'remarks', 'evaluated_by'], peRows));

    console.log('\nBackfill complete.');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
