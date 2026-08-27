// PARENT MODULE — all 11 routes x 8 roles, both URL spellings (/api/parent and
// /api/parents), anonymous + bad token, with live DB verification.
// Read-only module: creates and modifies nothing.
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

const ENDPOINTS = [
    "profile", "children", "attendance", "fee-status", "challan",
    "receipt", "timetable", "results", "gpa-cgpa", "notifications"
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
    console.log(`[${pass ? "PASS" : "FAIL"}] ${ep.padEnd(30)} ${test.padEnd(26)} exp=${String(exp).padEnd(10)} got=${String(got).padEnd(10)} ${note || ""}`);
};

(async () => {
    for (const [n, , e, p] of ACCOUNTS) {
        const r = await call("POST", "/api/auth/login", null, { email: e, password: p });
        T[n] = r.json && r.json.token;
        rec("auth", `login ${n}`, 200, r.status, r.status === 200);
    }

    const p1 = (await q(`
        SELECT p.parent_id, p.user_id, p.first_name, p.last_name, p.phone, p.occupation
        FROM parents p JOIN users u ON u.user_id = p.user_id
        WHERE u.email = 'parent1@aims.edu.pk'`))[0];
    const kids = await q("SELECT student_id, relationship FROM student_guardians WHERE parent_id = :p", { p: p1.parent_id });
    const childId = kids[0].student_id;
    console.log(`\nFixture: parent_id=${p1.parent_id} user_id=${p1.user_id} children=${kids.length} child=${childId}\n`);

    // ---------------------------------------------------------- LOGIN
    console.log("---------- PARENT LOGIN ----------");
    for (const path of ["/api/parents/parent-login", "/api/parents/login", "/api/parent/parent-login", "/api/parent/login"]) {
        const r = await call("POST", path, null, { email: "parent1@aims.edu.pk", password: "Parent@1234" });
        rec("POST " + path, "valid credentials", 200, r.status, r.status === 200);
    }
    for (const [lbl, body, exp] of [
        ["wrong password", { email: "parent1@aims.edu.pk", password: "WRONG" }, 401],
        ["unknown email", { email: "nobody@aims.edu.pk", password: "Parent@1234" }, 401],
        ["non-parent account", { email: "student1@aims.edu.pk", password: "Student@1234" }, 403],
        ["empty body", {}, 400],
        ["missing password", { email: "parent1@aims.edu.pk" }, 400],
        ["malformed email", { email: "not-an-email", password: "x" }, 400],
        // rejected by the email format check before it can reach the query
        ["SQLi in email", { email: "x' OR 1=1 --", password: "x" }, 400]
    ]) {
        const r = await call("POST", "/api/parents/parent-login", null, body);
        rec("POST /parents/parent-login", lbl, exp, r.status, r.status === exp,
            r.status >= 500 ? r.text.slice(0, 45) : "");
    }
    const lg = await call("POST", "/api/parents/parent-login", null,
        { email: "parent1@aims.edu.pk", password: "Parent@1234" });
    rec("POST /parents/parent-login", "issues a token", "token",
        lg.json && lg.json.token ? "token" : "none", !!(lg.json && lg.json.token));
    rec("POST /parents/parent-login", "no password_hash leak", "absent",
        /password_hash/.test(lg.text) ? "LEAKED" : "absent", !/password_hash/.test(lg.text));

    // -------------------------------------------------- ROLE SWEEP x2 PATHS
    console.log("\n---------- ROLE ACCESS (all 8 roles, both URL spellings) ----------");
    for (const ep of ENDPOINTS) {
        for (const prefix of ["/api/parents", "/api/parent"]) {
            const path = `${prefix}/${ep}`;
            for (const [name, rid] of ACCOUNTS) {
                const r = await call("GET", path, T[name]);
                // Only role 5 has a parent record, so the child-data endpoints
                // must refuse everyone else. /notifications is scoped to the
                // caller's own user_id by design, so every role gets its own.
                const expected = ep === "notifications" ? 200 : (rid === 5 ? 200 : 404);
                rec(path, `role ${rid} ${name}`, expected, r.status, r.status === expected,
                    ep !== "notifications" && rid !== 5 && r.status === 200 ? "*** NON-PARENT GOT DATA ***" : "");
            }
            const anon = await call("GET", path, null);
            rec(path, "no token", 401, anon.status, anon.status === 401);
            const bad = await call("GET", path, "aaa.bbb.ccc");
            rec(path, "bad token", 401, bad.status, bad.status === 401);
        }
    }

    // ------------------------------------------------ DATA VS LIVE DATABASE
    console.log("\n---------- DATA VERIFICATION vs LIVE DB ----------");
    const P = T.Parent;

    const prof = await call("GET", "/api/parent/profile", P);
    const pj = prof.json && (prof.json.parent || prof.json.data);
    rec("GET /parent/profile", "parent_id matches DB", p1.parent_id, pj && pj.parent_id, pj && pj.parent_id === p1.parent_id);
    rec("GET /parent/profile", "first_name matches DB", p1.first_name, pj && pj.first_name, pj && pj.first_name === p1.first_name);
    rec("GET /parent/profile", "no password_hash", "absent",
        /password_hash/.test(prof.text) ? "LEAKED" : "absent", !/password_hash/.test(prof.text));

    const ch = await call("GET", "/api/parent/children", P);
    const chList = ch.json && (ch.json.children || ch.json.data || []);
    rec("GET /parent/children", "child count matches DB", kids.length, chList.length, chList.length === kids.length);
    rec("GET /parent/children", "child_id matches DB", childId,
        chList[0] && chList[0].student_id, chList[0] && chList[0].student_id === childId);
    rec("GET /parent/children", "relationship matches DB", kids[0].relationship,
        chList[0] && chList[0].relationship, chList[0] && chList[0].relationship === kids[0].relationship);

    const dbAtt = (await q(
        "SELECT COUNT(*) total, SUM(status='Present') pres FROM attendance WHERE student_id=:s", { s: childId }))[0];
    const att = await call("GET", "/api/parent/attendance", P);
    rec("GET /parent/attendance", "returns 200", 200, att.status, att.status === 200);
    rec("GET /parent/attendance", `DB has ${dbAtt.total} records`, "non-empty",
        att.text.length > 40 ? "non-empty" : "empty", att.text.length > 40);

    // the API returns the most recent semester, so order the check the same way
    const dbRes = (await q(
        "SELECT gpa, cgpa FROM results WHERE student_id=:s ORDER BY semester_id DESC LIMIT 1", { s: childId }))[0];
    const gc = await call("GET", "/api/parent/gpa-cgpa", P);
    const gj = gc.json && (gc.json.result || gc.json.data);
    if (dbRes && gj) {
        rec("GET /parent/gpa-cgpa", "gpa matches DB", dbRes.gpa, gj.gpa, String(gj.gpa) === String(dbRes.gpa));
        rec("GET /parent/gpa-cgpa", "cgpa matches DB", dbRes.cgpa, gj.cgpa, String(gj.cgpa) === String(dbRes.cgpa));
    } else {
        rec("GET /parent/gpa-cgpa", "returns result object", "object", gj ? "object" : "none", !!gj);
    }

    const dbNotif = (await q("SELECT COUNT(*) c FROM notifications WHERE user_id=:u", { u: p1.user_id }))[0].c;
    const nt = await call("GET", "/api/parent/notifications", P);
    const ntList = nt.json && (nt.json.notifications || nt.json.data || []);
    rec("GET /parent/notifications", "count matches DB", dbNotif, ntList.length, ntList.length === dbNotif);

    // notifications is caller-scoped: confirm no other user's rows appear
    const adminUser = (await q("SELECT user_id FROM users WHERE email='admin2@aims.edu.pk'"))[0].user_id;
    const dbAdminNotif = (await q("SELECT COUNT(*) c FROM notifications WHERE user_id=:u", { u: adminUser }))[0].c;
    const ntAdmin = await call("GET", "/api/parent/notifications", T.Admin);
    const ntAdminList = ntAdmin.json && (ntAdmin.json.notifications || []);
    rec("GET /parent/notifications", "admin sees only own rows", dbAdminNotif, ntAdminList.length,
        ntAdminList.length === dbAdminNotif);
    rec("GET /parent/notifications", "no cross-user leak", "scoped",
        ntAdminList.every(n => n.user_id === adminUser) ? "scoped" : "LEAKED",
        ntAdminList.every(n => n.user_id === adminUser));

    for (const ep of ["fee-status", "challan", "receipt", "timetable", "results"]) {
        const r = await call("GET", `/api/parent/${ep}`, P);
        rec(`GET /parent/${ep}`, "returns 200", 200, r.status, r.status === 200,
            r.status >= 500 ? r.text.slice(0, 45) : "");
        rec(`GET /parent/${ep}`, "success flag true", true,
            r.json && r.json.success, !!(r.json && r.json.success === true));
    }

    // ------------------------------------------------------ ISOLATION CHECK
    console.log("\n---------- CROSS-PARENT ISOLATION ----------");
    const p2 = (await q(`
        SELECT p.parent_id, p.first_name FROM parents p JOIN users u ON u.user_id = p.user_id
        WHERE u.email = 'parent2@aims.edu.pk'`))[0];
    const p2kids = await q("SELECT student_id FROM student_guardians WHERE parent_id=:p", { p: p2.parent_id });
    rec("GET /parent/children", "does NOT return other parent's child", "excluded",
        chList.some(c => c.student_id === (p2kids[0] || {}).student_id) ? "LEAKED" : "excluded",
        !chList.some(c => c.student_id === (p2kids[0] || {}).student_id));

    const p2tok = (await call("POST", "/api/auth/login", null,
        { email: "parent2@aims.edu.pk", password: "Parent@1234" })).json.token;
    const ch2 = await call("GET", "/api/parent/children", p2tok);
    const ch2List = ch2.json && (ch2.json.children || []);
    rec("GET /parent/children", "parent2 sees only own child", p2kids[0].student_id,
        ch2List[0] && ch2List[0].student_id, ch2List[0] && ch2List[0].student_id === p2kids[0].student_id);

    // ------------------------------------------------------------- SUMMARY
    const pass = rows.filter(r => r.pass).length;
    console.log(`\n================ PARENT MODULE: ${pass}/${rows.length} PASSED ================`);
    console.log("\nFAILURES:");
    const f = rows.filter(r => !r.pass);
    if (!f.length) console.log("  none");
    f.forEach(r => console.log(`  ${r.ep.padEnd(30)} ${r.test.padEnd(26)} exp=${r.exp} got=${r.got} ${r.note}`));
    require("fs").writeFileSync(__dirname + "/parent-results.json", JSON.stringify(rows, null, 1));
    await sequelize.close();
})();
