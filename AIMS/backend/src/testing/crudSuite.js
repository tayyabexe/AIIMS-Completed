// Functional CRUD suite with live-DB verification.
// Creates its own rows, updates them, deletes them, and verifies each step
// with a direct SELECT. Never touches pre-existing rows.
require("dotenv").config();
const { sequelize } = require("../database/connection");

const BASE = "http://localhost:5000";
const ACCOUNTS = {
    SuperAdmin: ["system.administrator@aims.edu.pk", "SuperAdmin@1234"],
    Admin: ["admin2@aims.edu.pk", "Admin@1234"],
    Teacher: ["teacher2@aims.edu.pk", "Teacher@1234"],
    Student: ["student1@aims.edu.pk", "Student@1234"],
    Parent: ["parent1@aims.edu.pk", "Parent@1234"]
};

const tokens = {};
const results = [];

const call = async (method, path, token, body) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text };
};

const q = (s, r) => sequelize.query(s, {
    type: sequelize.QueryTypes.SELECT, replacements: r
});

const rec = (mod, test, expected, actual, pass, note) => {
    results.push({ mod, test, expected, actual, pass, note: note || "" });
    const tag = pass ? "PASS" : "FAIL";
    console.log(`[${tag}] ${mod.padEnd(20)} ${test.padEnd(38)} exp=${String(expected).padEnd(9)} got=${actual} ${note || ""}`);
};

// module -> {path, table, pk, make(ids), patch, roleOK, roleDeny}
const MODULES = (ids) => [
    {
        name: "attendance", path: "/api/attendance", table: "attendance", pk: "attendance_id",
        body: { student_id: ids.student, subject_id: 21, timetable_id: 17, att_date: "2026-12-01", status: "Present", marked_by: 2 },
        patch: { status: "Late" }, check: "status", expect: "Late",
        allow: ["Admin", "Teacher"], deny: ["Student", "Parent", "SuperAdmin"]
    },
    {
        name: "gpa", path: "/api/gpa", table: "gpa", pk: "gpa_id",
        body: { student_id: ids.student, semester_id: ids.semester, gpa: 3.11, cgpa: 3.22 },
        patch: { gpa: 3.55 }, check: "gpa", expect: "3.55",
        allow: ["Admin"], deny: ["Teacher", "Student", "Parent", "SuperAdmin"]
    },
    {
        name: "teacher-schedules", path: "/api/teacher-schedules", table: "teacher_schedules", pk: "schedule_id",
        body: { teacher_id: 1, subject_id: 1, day: "Friday", start_time: "14:00:00", end_time: "15:30:00" },
        patch: { day: "Saturday" }, check: "day", expect: "Saturday",
        allow: ["Admin"], deny: ["Teacher", "Student", "Parent", "SuperAdmin"]
    },
    {
        name: "challans", path: "/api/challans", table: "challans", pk: "challan_id",
        body: { student_id: ids.student, voucher_number: "VCH-TEST-" + Date.now(), issue_date: "2026-12-01", due_date: "2026-12-31", total_amount: 4321, status: "Unpaid" },
        patch: { status: "Paid" }, check: "status", expect: "Paid",
        allow: ["Admin"], deny: ["Teacher", "Student", "Parent", "SuperAdmin"]
    },
    {
        name: "teacher-assignments", path: "/api/teacher-assignments", table: "teacher_assignments", pk: "assignment_id",
        body: { teacher_id: 1, subject_id: 2, batch_id: 1, section_id: 1 },
        patch: { subject_id: 3 }, check: "subject_id", expect: 3,
        allow: ["Admin"], deny: ["Teacher", "Student", "Parent", "SuperAdmin"]
    },
    {
        name: "fee-structures", path: "/api/fee-structures", table: "fee_structures", pk: "fee_structure_id",
        body: { program_id: 1, semester_id: ids.semester, fee_category: "Test Fee", amount: 1234 },
        patch: { amount: 4444 }, check: "amount", expect: "4444.00",
        allow: ["Admin"], deny: ["Teacher", "Student", "Parent", "SuperAdmin"]
    },
    {
        name: "subjects", path: "/api/subjects", table: "subjects", pk: "subject_id",
        body: { subject_code: "TST" + (Date.now() % 100000), subject_name: "Test Subject", credit_hours: 3, semester_id: ids.semester },
        patch: { subject_name: "Renamed Subject" }, check: "subject_name", expect: "Renamed Subject",
        allow: ["Admin"], deny: ["Student", "Parent", "SuperAdmin"]
    },
    {
        name: "timetables", path: "/api/timetables", table: "timetables", pk: "timetable_id",
        // Saturday, because the generators only schedule Monday-Friday: the
        // unique indexes on (section|teacher|room, day, start_time) would turn
        // a weekday slot that happens to be taken into a 409. The times must
        // name a canonical slot - see config/timetableSlots.js - and the patch
        // moves the row to slot 4 to prove a slot change lands in the DB.
        body: { subject_id: 21, section_id: 1, teacher_id: 11, classroom_id: 1, day_of_week: "Saturday", start_time: "08:30:00", end_time: "10:00:00" },
        patch: { start_time: "13:30:00", end_time: "15:00:00" }, check: "start_time", expect: "13:30:00",
        allow: ["Admin"], deny: ["Student", "Parent", "SuperAdmin"]
    }
];

(async () => {
    for (const [label, [email, password]] of Object.entries(ACCOUNTS)) {
        const r = await call("POST", "/api/auth/login", null, { email, password });
        tokens[label] = r.json && r.json.token;
        rec("auth", `login ${label}`, 200, r.status, r.status === 200);
    }

    const ids = {
        student: (await q("SELECT student_id FROM students WHERE is_deleted=0 LIMIT 1"))[0].student_id,
        semester: (await q("SELECT semester_id FROM semesters LIMIT 1"))[0].semester_id
    };
    console.log("\nFK ids:", JSON.stringify(ids), "\n");

    const A = () => tokens.Admin;
    const created = [];

    for (const m of MODULES(ids)) {
        console.log(`\n----- ${m.name} -----`);

        // C: create
        const c = await call("POST", m.path, A(), m.body);
        const ok = c.status === 201 || c.status === 200;
        const id = ok && c.json ? (c.json.data || c.json.attendance || c.json[m.name] || c.json)[m.pk] : null;
        rec(m.name, "POST create", "201", c.status, ok, id ? `id=${id}` : (c.text || "").slice(0, 70));
        if (!id) continue;
        created.push({ m, id });

        // DB verify create
        const row = (await q(`SELECT * FROM ${m.table} WHERE ${m.pk}=:id`, { id }))[0];
        rec(m.name, "DB row exists after create", "found", row ? "found" : "MISSING", !!row);

        // R: read back
        const g = await call("GET", `${m.path}/${id}`, A());
        rec(m.name, "GET by id", "200", g.status, g.status === 200);

        // U: update
        const u = await call("PUT", `${m.path}/${id}`, A(), m.patch);
        rec(m.name, "PUT update", "200", u.status, u.status === 200);

        const row2 = (await q(`SELECT * FROM ${m.table} WHERE ${m.pk}=:id`, { id }))[0];
        const got = row2 ? String(row2[m.check]) : "no-row";
        rec(m.name, `DB verify ${m.check}=${m.expect}`, m.expect, got, got === String(m.expect));

        // validation
        const v = await call("POST", m.path, A(), {});
        rec(m.name, "POST empty body", "400", v.status, v.status === 400);

        // RBAC
        for (const r of m.allow) {
            const t = await call("GET", m.path, tokens[r]);
            rec(m.name, `RBAC allow ${r}`, "200", t.status, t.status === 200);
        }
        for (const r of m.deny) {
            const t = await call("GET", m.path, tokens[r]);
            rec(m.name, `RBAC deny ${r}`, "403", t.status, t.status === 403);
        }

        // 404s
        const n = await call("GET", `${m.path}/999999`, A());
        rec(m.name, "GET nonexistent", "404", n.status, n.status === 404);

        // D: delete
        const d = await call("DELETE", `${m.path}/${id}`, A());
        rec(m.name, "DELETE", "200", d.status, d.status === 200);

        const row3 = await q(`SELECT * FROM ${m.table} WHERE ${m.pk}=:id`, { id });
        const softCol = row3[0] && "is_deleted" in row3[0];
        const gone = row3.length === 0 || (softCol && row3[0].is_deleted === true) || (softCol && row3[0].is_deleted === 1);
        rec(m.name, "DB cleanup verified", "removed", row3.length === 0 ? "hard-deleted" : (gone ? "soft-deleted" : "STILL PRESENT"), gone);

        const dd = await call("DELETE", `${m.path}/${id}`, A());
        rec(m.name, "double delete", "404", dd.status, dd.status === 404);
    }

    const pass = results.filter(r => r.pass).length;
    console.log(`\n================ ${pass}/${results.length} PASSED ================`);
    console.log("\nFAILURES:");
    results.filter(r => !r.pass).forEach(r =>
        console.log(`  ${r.mod.padEnd(20)} ${r.test.padEnd(38)} exp=${r.expected} got=${r.actual} ${r.note}`));

    require("fs").writeFileSync(__dirname + "/results.json", JSON.stringify(results, null, 1));
    await sequelize.close();
})();
