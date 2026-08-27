// STUDENT API — all 11 endpoints x 8 roles + anonymous/bad token, with live DB verification.
require("dotenv").config();
const { sequelize } = require("../database/connection");
const BASE = "http://localhost:5000";

const ACCOUNTS = [
    ["SuperAdmin", 1, "system.administrator@aims.edu.pk", "SuperAdmin@1234"],
    ["Admin", 2, "admin2@aims.edu.pk", "Admin@1234"],
    ["Teacher", 3, "teacher2@aims.edu.pk", "Teacher@1234"],
    ["Student", 4, "student1@aims.edu.pk", "Student@1234"],
    ["Parent", 5, "parent1@aims.edu.pk", "Parent@1234"],
    ["HR", 6, "nadia.rehman@aims.edu.pk", "Hr@1234"],
    ["Accountant", 7, "saima.akhtar@aims.edu.pk", "Accountant@1234"],
    ["Library", 8, "rabia.nawaz@aims.edu.pk", "Library@1234"]
];
// expected per route: which roles should get through
const EXPECT = { list: [2, 3], byId: [2, 3], sub: "any", write: [2] };

const T = {};
const call = async (m, p, t, b) => {
    const h = { "Content-Type": "application/json" };
    if (t) h.Authorization = `Bearer ${t}`;
    const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text };
};
const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const rows = [];
const rec = (ep, test, exp, got, pass, note) => {
    rows.push({ ep, test, exp, got, pass, note: note || "" });
    console.log(`[${pass ? "PASS" : "FAIL"}] ${ep.padEnd(34)} ${test.padEnd(26)} exp=${String(exp).padEnd(10)} got=${String(got).padEnd(10)} ${note || ""}`);
};

// role sweep helper: allowed = array of role_ids expected 2xx, or "any"
const sweep = async (method, path, label, allowed, body) => {
    console.log(`\n--- ${method} ${label} ---`);
    for (const [name, rid] of ACCOUNTS) {
        const r = await call(method, path, T[name], body);
        const ok2xx = r.status >= 200 && r.status < 300;
        const should = allowed === "any" ? true : allowed.includes(rid);
        // for write probes against nonexistent ids a 404 means "passed the gate"
        const passedGate = ok2xx || r.status === 404 || r.status === 400 || r.status === 409;
        const pass = should ? passedGate : r.status === 403;
        rec(label, `role ${rid} ${name}`, should ? "allow" : "403", r.status, pass);
    }
    const anon = await call(method, path, null, body);
    rec(label, "no token", 401, anon.status, anon.status === 401);
    const bad = await call(method, path, "aaa.bbb.ccc", body);
    rec(label, "bad token", 401, bad.status, bad.status === 401);
};

(async () => {
    for (const [n, , e, p] of ACCOUNTS) {
        const r = await call("POST", "/api/auth/login", null, { email: e, password: p });
        T[n] = r.json && r.json.token;
        rec("auth", `login ${n}`, 200, r.status, r.status === 200);
    }

    const s = (await q("SELECT * FROM students WHERE is_deleted=0 LIMIT 1"))[0];
    const sid = s.student_id;
    const batch = (await q("SELECT batch_id FROM batches LIMIT 1"))[0].batch_id;
    console.log(`\nFixture: student_id=${sid} program_id=${s.program_id} batch_id=${batch}`);

    // ---------- READ endpoints x 8 roles ----------
    await sweep("GET", "/api/students", "GET /api/students", EXPECT.list);
    await sweep("GET", `/api/students/${sid}`, "GET /api/students/:id", EXPECT.byId);
    await sweep("GET", "/api/students/search?first_name=A", "GET /api/students/search", EXPECT.list);
    await sweep("GET", `/api/students/documents/${sid}`, "GET /students/documents/:id", "any");
    await sweep("GET", `/api/students/guardians/${sid}`, "GET /students/guardians/:id", "any");

    // ---------- WRITE endpoints x 8 roles (nonexistent id => no data touched) ----------
    await sweep("PUT", "/api/students/999999", "PUT /api/students/:id", EXPECT.write, { first_name: "X" });
    await sweep("PUT", "/api/students/999999/enroll", "PUT /students/:id/enroll", EXPECT.write, { section_id: 1 });
    await sweep("DELETE", "/api/students/999999", "DELETE /api/students/:id", EXPECT.write);
    await sweep("DELETE", "/api/students/documents/999999", "DELETE /students/documents/:id", "any");
    await sweep("POST", "/api/students/upload-document", "POST /students/upload-document", "any", {});

    // ---------- FUNCTIONAL CRUD (admin) ----------
    console.log("\n--- FUNCTIONAL CRUD ---");
    const A = T.Admin;
    const stamp = Date.now() % 1000000;
    const payload = {
        registration_number: `TEST-REG-${stamp}`,
        first_name: "ApiTest", last_name: "Student",
        cnic_bform: `99999-${stamp}-9`,
        program_id: s.program_id, batch_id: batch,
        gender: "Male", dob: "2003-01-01"
    };
    const c = await call("POST", "/api/students/register", A, payload);
    const created = c.json && (c.json.student || c.json.data);
    const newId = created && created.student_id;
    rec("POST /students/register", "create", 201, c.status, c.status === 201, newId ? `id=${newId}` : c.text.slice(0, 60));

    if (newId) {
        const db = (await q("SELECT * FROM students WHERE student_id=:i", { i: newId }))[0];
        rec("POST /students/register", "DB row exists", "found", db ? "found" : "MISSING", !!db);
        rec("POST /students/register", "DB reg_no matches", payload.registration_number,
            db && db.registration_number, db && db.registration_number === payload.registration_number);

        const u = await call("PUT", `/api/students/${newId}`, A, { first_name: "Renamed" });
        rec("PUT /api/students/:id", "update", 200, u.status, u.status === 200);
        const db2 = (await q("SELECT first_name FROM students WHERE student_id=:i", { i: newId }))[0];
        rec("PUT /api/students/:id", "DB first_name", "Renamed", db2 && db2.first_name, db2 && db2.first_name === "Renamed");

        const d = await call("DELETE", `/api/students/${newId}`, A);
        rec("DELETE /api/students/:id", "delete", 200, d.status, d.status === 200);
        const db3 = await q("SELECT is_deleted FROM students WHERE student_id=:i", { i: newId });
        const removed = db3.length === 0 || db3[0].is_deleted === 1 || db3[0].is_deleted === true;
        rec("DELETE /api/students/:id", "DB removed", "removed",
            db3.length === 0 ? "hard" : (removed ? "soft" : "STILL ACTIVE"), removed);

        const g = await call("GET", `/api/students/${newId}`, A);
        rec("DELETE /api/students/:id", "GET after delete", 404, g.status, g.status === 404);
    }

    // ---------- VALIDATION ----------
    console.log("\n--- VALIDATION ---");
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["missing first_name", { ...payload, first_name: "" }, 400],
        ["program_id as string", { ...payload, registration_number: "X" + stamp, program_id: "abc" }, 400],
        ["duplicate reg_no", payload, 409]
    ]) {
        const r = await call("POST", "/api/students/register", A, b);
        rec("POST /students/register", lbl, exp, r.status, r.status === exp, r.status === 500 ? r.text.slice(0, 55) : "");
    }

    // ---------- SECURITY ----------
    console.log("\n--- SECURITY ---");
    const leak = await call("GET", `/api/students/${sid}`, A);
    rec("GET /api/students/:id", "no password_hash", "absent",
        /password_hash/.test(leak.text) ? "LEAKED" : "absent", !/password_hash/.test(leak.text));

    const sqli = await call("GET", "/api/students/search?first_name=' OR 1=1 --", A);
    rec("GET /students/search", "SQLi safe", "no 500", sqli.status, sqli.status !== 500);

    const p = rows.filter(r => r.pass).length;
    console.log(`\n============ STUDENT API: ${p}/${rows.length} PASSED ============`);
    console.log("\nFAILURES:");
    rows.filter(r => !r.pass).forEach(r => console.log(`  ${r.ep.padEnd(34)} ${r.test.padEnd(26)} exp=${r.exp} got=${r.got} ${r.note}`));
    require("fs").writeFileSync(__dirname + "/student-results.json", JSON.stringify(rows, null, 1));
    await sequelize.close();
})();
