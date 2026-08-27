// TEACHER API + TIMETABLE API — every endpoint x 8 roles + anonymous/bad token,
// with live DB verification. Creates only its own rows and removes them.
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
    console.log(`[${pass ? "PASS" : "FAIL"}] ${ep.padEnd(30)} ${test.padEnd(24)} exp=${String(exp).padEnd(10)} got=${String(got).padEnd(8)} ${note || ""}`);
};

// allowed: array of role_ids, or "any"; anonExpect: 401 normally, or "open" when route has no auth
const sweep = async (method, path, label, allowed, anonExpect, body) => {
    console.log(`\n--- ${method} ${label} ---`);
    for (const [name, rid] of ACCOUNTS) {
        const r = await call(method, path, T[name], body);
        const ok = r.status >= 200 && r.status < 300;
        const gate = ok || [400, 404, 409, 500].includes(r.status);
        const should = allowed === "any" ? true : allowed.includes(rid);
        const pass = should ? gate : r.status === 403;
        rec(label, `role ${rid} ${name}`, should ? "allow" : "403", r.status, pass);
    }
    const anon = await call(method, path, null, body);
    if (anonExpect === "open") {
        rec(label, "no token (SHOULD be 401)", 401, anon.status, anon.status === 401,
            anon.status !== 401 ? "*** NO AUTH GATE ***" : "");
    } else {
        rec(label, "no token", 401, anon.status, anon.status === 401);
    }
    const bad = await call(method, path, "aaa.bbb.ccc", body);
    rec(label, "bad token", 401, bad.status, bad.status === 401,
        bad.status !== 401 ? "*** accepts invalid token ***" : "");
};

(async () => {
    for (const [n, , e, p] of ACCOUNTS) {
        const r = await call("POST", "/api/auth/login", null, { email: e, password: p });
        T[n] = r.json && r.json.token;
    }
    console.log("All 8 roles authenticated.");

    // =====================================================================
    console.log("\n\n#################### TEACHER API ####################");
    // routes have NO authenticate middleware -> anonExpect "open"
    const tch = (await q("SELECT * FROM teachers WHERE is_deleted=0 LIMIT 1"))[0];
    console.log(`Fixture: teacher_id=${tch.teacher_id} employee_id=${tch.employee_id}`);

    await sweep("GET", "/api/teachers", "GET /api/teachers", [1,2,3,6], 401);
    await sweep("GET", `/api/teachers/${tch.teacher_id}`, "GET /api/teachers/:id", [1,2,3,6], 401);
    await sweep("PUT", "/api/teachers/999999", "PUT /api/teachers/:id", [1,2,6], 401, { specialization: "X" });
    await sweep("DELETE", "/api/teachers/999999", "DELETE /api/teachers/:id", [1,2], 401);
    await sweep("POST", "/api/teachers", "POST /api/teachers", [1,2,6], 401, {});

    console.log("\n--- TEACHER functional CRUD (admin) ---");
    const A = T.Admin;
    const emp = (await q("SELECT employee_id FROM employees ORDER BY employee_id DESC LIMIT 1"))[0];
    const tPayload = { employee_id: emp ? emp.employee_id : 1, specialization: "API Test Spec" };
    const tc = await call("POST", "/api/teachers", A, tPayload);
    const tId = tc.json && (tc.json.data || tc.json.teacher || {}).teacher_id;
    rec("POST /api/teachers", "create", 201, tc.status, tc.status === 201 || tc.status === 200,
        tId ? `id=${tId}` : tc.text.slice(0, 60));

    if (tId) {
        const db = (await q("SELECT * FROM teachers WHERE teacher_id=:i", { i: tId }))[0];
        rec("POST /api/teachers", "DB row exists", "found", db ? "found" : "MISSING", !!db);
        const u = await call("PUT", `/api/teachers/${tId}`, A, { specialization: "Updated Spec" });
        rec("PUT /api/teachers/:id", "update", 200, u.status, u.status === 200);
        const db2 = (await q("SELECT specialization FROM teachers WHERE teacher_id=:i", { i: tId }))[0];
        rec("PUT /api/teachers/:id", "DB specialization", "Updated Spec", db2 && db2.specialization,
            db2 && db2.specialization === "Updated Spec");
        const d = await call("DELETE", `/api/teachers/${tId}`, A);
        rec("DELETE /api/teachers/:id", "delete", 200, d.status, d.status === 200);
        const db3 = await q("SELECT is_deleted FROM teachers WHERE teacher_id=:i", { i: tId });
        const gone = db3.length === 0 || db3[0].is_deleted === 1 || db3[0].is_deleted === true;
        rec("DELETE /api/teachers/:id", "DB removed", "removed",
            db3.length === 0 ? "hard" : (gone ? "soft" : "STILL ACTIVE"), gone);
        const dd = await call("DELETE", `/api/teachers/${tId}`, A);
        rec("DELETE /api/teachers/:id", "double delete", 404, dd.status, dd.status === 404);
    }
    const tv = await call("POST", "/api/teachers", A, {});
    rec("POST /api/teachers", "empty body", 400, tv.status, tv.status === 400, tv.status === 500 ? tv.text.slice(0, 50) : "");
    const tl = await call("GET", "/api/teachers", null);
    rec("GET /api/teachers", "no password_hash", "absent",
        /password_hash/.test(tl.text) ? "LEAKED" : "absent", !/password_hash/.test(tl.text));

    // =====================================================================
    console.log("\n\n#################### TIMETABLE API ####################");
    const tt = (await q("SELECT * FROM timetables LIMIT 1"))[0];
    console.log(`Fixture: timetable_id=${tt.timetable_id}`);

    await sweep("GET", "/api/timetables", "GET /api/timetables", [2, 3], 401);
    await sweep("GET", `/api/timetables/${tt.timetable_id}`, "GET /api/timetables/:id", [2, 3], 401);
    await sweep("PUT", "/api/timetables/999999", "PUT /api/timetables/:id", [2], 401, { day_of_week: "Monday" });
    await sweep("DELETE", "/api/timetables/999999", "DELETE /api/timetables/:id", [2], 401);
    await sweep("POST", "/api/timetables", "POST /api/timetables", [2], 401, {});

    console.log("\n--- TIMETABLE functional CRUD (admin) ---");
    // Saturday slot 1. The generators only schedule Monday-Friday, so Saturday
    // is guaranteed free - on a weekday this would collide with the row `tt`
    // was read from and come back 409 from the new conflict check.
    const ttPayload = {
        subject_id: tt.subject_id, section_id: tt.section_id, teacher_id: tt.teacher_id,
        classroom_id: tt.classroom_id, day_of_week: "Saturday",
        start_time: "08:30:00", end_time: "10:00:00"
    };
    const tc2 = await call("POST", "/api/timetables", A, ttPayload);
    const ttId = tc2.json && (tc2.json.data || tc2.json.timetable || tc2.json).timetable_id;
    rec("POST /api/timetables", "create", 201, tc2.status, tc2.status === 201,
        ttId ? `id=${ttId}` : tc2.text.slice(0, 60));

    if (ttId) {
        const db = (await q("SELECT * FROM timetables WHERE timetable_id=:i", { i: ttId }))[0];
        rec("POST /api/timetables", "DB row exists", "found", db ? "found" : "MISSING", !!db);
        rec("POST /api/timetables", "DB day_of_week", "Saturday", db && db.day_of_week, db && db.day_of_week === "Saturday");

        const g = await call("GET", `/api/timetables/${ttId}`, A);
        rec("GET /api/timetables/:id", "read back", 200, g.status, g.status === 200);

        // Move it to slot 4. The row is already on Saturday, so re-sending the
        // day would assert nothing; moving the period also proves the conflict
        // check excludes the row being updated from its own clash search.
        const u = await call("PUT", `/api/timetables/${ttId}`, A,
            { start_time: "13:30:00", end_time: "15:00:00" });
        rec("PUT /api/timetables/:id", "update", 200, u.status, u.status === 200);
        const db2 = (await q("SELECT start_time FROM timetables WHERE timetable_id=:i", { i: ttId }))[0];
        rec("PUT /api/timetables/:id", "DB start_time", "13:30:00", db2 && db2.start_time, db2 && String(db2.start_time) === "13:30:00");

        const d = await call("DELETE", `/api/timetables/${ttId}`, A);
        rec("DELETE /api/timetables/:id", "delete", 200, d.status, d.status === 200);
        const db3 = await q("SELECT * FROM timetables WHERE timetable_id=:i", { i: ttId });
        rec("DELETE /api/timetables/:id", "DB removed", "removed",
            db3.length === 0 ? "hard" : "STILL PRESENT", db3.length === 0);
        const dd = await call("DELETE", `/api/timetables/${ttId}`, A);
        rec("DELETE /api/timetables/:id", "double delete", 404, dd.status, dd.status === 404);
    }

    console.log("\n--- TIMETABLE validation ---");
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["invalid day_of_week", { ...ttPayload, day_of_week: "Funday" }, 400],
        ["end before start", { ...ttPayload, start_time: "10:00:00", end_time: "09:00:00" }, 400],
        // Times must name a canonical slot, not merely be well-ordered.
        ["off-grid times", { ...ttPayload, start_time: "09:07:00", end_time: "10:37:00" }, 400],
        ["on-grid start, wrong end", { ...ttPayload, start_time: "08:30:00", end_time: "09:30:00" }, 400],
        ["spans two slots", { ...ttPayload, start_time: "08:30:00", end_time: "11:30:00" }, 400],
        ["inside the daily break", { ...ttPayload, start_time: "13:00:00", end_time: "13:30:00" }, 400],
        // The section/teacher/room in `tt` are already booked at its own
        // day+slot, so re-booking that exact period must be refused.
        ["double-booked slot", {
            ...ttPayload, day_of_week: tt.day_of_week,
            start_time: String(tt.start_time), end_time: String(tt.end_time)
        }, 409],
        ["nonexistent subject_id", { ...ttPayload, subject_id: 999999 }, 400]
    ]) {
        const r = await call("POST", "/api/timetables", A, b);
        rec("POST /api/timetables", lbl, exp, r.status, r.status === exp, r.status >= 500 ? r.text.slice(0, 50) : "");
        if (r.status === 201) {
            const bad = (r.json.data || r.json).timetable_id;
            if (bad) await call("DELETE", `/api/timetables/${bad}`, A);
        }
    }

    const p = rows.filter(r => r.pass).length;
    console.log(`\n============ TEACHER + TIMETABLE: ${p}/${rows.length} PASSED ============`);
    console.log("\nFAILURES:");
    rows.filter(r => !r.pass).forEach(r =>
        console.log(`  ${r.ep.padEnd(30)} ${r.test.padEnd(26)} exp=${r.exp} got=${r.got} ${r.note}`));
    require("fs").writeFileSync(__dirname + "/teacher-timetable-results.json", JSON.stringify(rows, null, 1));
    await sequelize.close();
})();
