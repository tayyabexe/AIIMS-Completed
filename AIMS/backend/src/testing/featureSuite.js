// Named feature scenarios, each cross-checked against a direct DB query.
require("dotenv").config();
const { sequelize } = require("../database/connection");
const BASE = "http://localhost:5000";

const call = async (m, p, t, b) => {
    const h = { "Content-Type": "application/json" };
    if (t) h.Authorization = `Bearer ${t}`;
    const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text };
};
const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const out = [];
const rec = (t, exp, got, pass, note) => {
    out.push({ t, exp, got, pass });
    console.log(`[${pass ? "PASS" : "FAIL"}] ${t.padEnd(46)} exp=${String(exp).padEnd(14)} got=${String(got).padEnd(14)} ${note || ""}`);
};

(async () => {
    const login = async (e, p) => (await call("POST", "/api/auth/login", null, { email: e, password: p })).json;

    // ---- login ----
    const admin = await login("admin2@aims.edu.pk", "Admin@1234");
    rec("LOGIN admin2 -> token issued", "token", admin && admin.token ? "token" : "none", !!(admin && admin.token));
    const dbRole = (await q("SELECT role_id FROM users WHERE email='admin2@aims.edu.pk'"))[0].role_id;
    rec("LOGIN role_id matches DB", dbRole, admin.user.role_id, dbRole === admin.user.role_id);
    const A = admin.token;

    const sid = (await q("SELECT student_id FROM students WHERE is_deleted=0 LIMIT 1"))[0].student_id;

    // ---- student profile ----
    const prof = await call("GET", `/api/students/${sid}`, A);
    const dbS = (await q("SELECT * FROM students WHERE student_id=:id", { id: sid }))[0];
    const apiS = prof.json && (prof.json.student || prof.json.data);
    rec("STUDENT PROFILE status", 200, prof.status, prof.status === 200);
    rec("STUDENT PROFILE reg_no matches DB", dbS.registration_number,
        apiS && apiS.registration_number, apiS && apiS.registration_number === dbS.registration_number);

    // ---- student filters ----
    const total = (await q("SELECT COUNT(*) c FROM students WHERE is_deleted=0"))[0].c;
    const prog = dbS.program_id;
    const dbFiltered = (await q("SELECT COUNT(*) c FROM students WHERE is_deleted=0 AND program_id=:p", { p: prog }))[0].c;
    const f = await call("GET", `/api/students?program_id=${prog}`, A);
    const fCount = f.json.students ? f.json.students.length : -1;
    rec(`FILTER program_id=${prog} (DB says ${dbFiltered})`, dbFiltered, fCount, fCount === dbFiltered,
        fCount === total ? "<-- returns FULL table, filter ignored" : "");

    const bogus = await call("GET", "/api/students?program_id=999999", A);
    const bCount = bogus.json.students ? bogus.json.students.length : -1;
    rec("FILTER program_id=999999 (no match)", 0, bCount, bCount === 0);

    // ---- pagination ----
    const pg = await call("GET", "/api/students?page=1&limit=5", A);
    const pCount = pg.json.students ? pg.json.students.length : -1;
    rec("PAGINATION limit=5", 5, pCount, pCount === 5);

    // ---- search ----
    const nm = dbS.first_name;
    const dbSearch = (await q("SELECT COUNT(*) c FROM students WHERE is_deleted=0 AND first_name=:n", { n: nm }))[0].c;
    const sr = await call("GET", `/api/students/search?first_name=${encodeURIComponent(nm)}`, A);
    const sCount = sr.json.students ? sr.json.students.length : -1;
    rec(`SEARCH first_name=${nm} (DB says ${dbSearch})`, dbSearch, sCount, sCount === dbSearch);

    const noMatch = await call("GET", "/api/students/search?first_name=ZZZNOMATCH", A);
    const nCount = noMatch.json.students ? noMatch.json.students.length : -1;
    rec("SEARCH no-match returns empty", 0, nCount, nCount === 0);

    // ---- exam by id ----
    const eid = (await q("SELECT exam_id FROM exams LIMIT 1"))[0].exam_id;
    const ex = await call("GET", `/api/exams/${eid}`, A);
    const dbE = (await q("SELECT * FROM exams WHERE exam_id=:id", { id: eid }))[0];
    const apiE = ex.json && (ex.json.exam || ex.json.data);
    rec("EXAM BY ID status", 200, ex.status, ex.status === 200);
    rec("EXAM BY ID name matches DB", dbE.exam_name, apiE && apiE.exam_name, apiE && apiE.exam_name === dbE.exam_name);

    // ---- marks ----
    const mstu = (await q("SELECT student_id, COUNT(*) c FROM marks GROUP BY student_id HAVING c>0 LIMIT 1"))[0];
    const mk = await call("GET", `/api/marks/student/${mstu.student_id}`, A);
    const mCount = mk.json && mk.json.marks ? mk.json.marks.length : -1;
    rec(`MARKS student ${mstu.student_id} count vs DB`, mstu.c, mCount, mCount === mstu.c);

    // ---- attendance ----
    const astu = (await q("SELECT student_id, COUNT(*) c FROM attendance GROUP BY student_id HAVING c>0 LIMIT 1"))[0];
    const at = await call("GET", `/api/attendance/student/${astu.student_id}`, A);
    const aCount = at.json && at.json.attendance ? at.json.attendance.length : -1;
    rec(`ATTENDANCE student ${astu.student_id} count vs DB`, astu.c, aCount, aCount === astu.c);

    const dbPct = (await q(
        "SELECT COUNT(*) total, SUM(status='Present') pres FROM attendance WHERE student_id=:id", { id: astu.student_id }))[0];
    const rep = await call("GET", `/api/attendance/report/${astu.student_id}`, A);
    const apiTotal = rep.json && rep.json.report ? rep.json.report.total_classes : -1;
    rec("ATTENDANCE report total vs DB", dbPct.total, apiTotal, Number(apiTotal) === Number(dbPct.total));

    // ---- CGPA ----
    const g = (await q("SELECT student_id, cgpa FROM results WHERE cgpa IS NOT NULL LIMIT 1"))[0];
    if (g) {
        const c = await call("GET", `/api/results/cgpa/${g.student_id}`, A);
        const apiC = c.json && (c.json.cgpa || (c.json.data && c.json.data.cgpa));
        rec(`CGPA student ${g.student_id} vs DB`, g.cgpa, apiC === undefined ? c.status : apiC,
            String(apiC) === String(g.cgpa), c.status !== 200 ? `HTTP ${c.status}` : "");
    }

    // ---- transcript ----
    const tr = await call("GET", `/api/results/transcript/${sid}`, A);
    rec("TRANSCRIPT reachable", 200, tr.status, tr.status === 200);

    const pass = out.filter(o => o.pass).length;
    console.log(`\n================ ${pass}/${out.length} PASSED ================`);
    require("fs").writeFileSync(__dirname + "/feature-results.json", JSON.stringify(out, null, 1));
    await sequelize.close();
})();
