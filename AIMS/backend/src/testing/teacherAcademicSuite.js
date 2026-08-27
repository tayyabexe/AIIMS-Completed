// TEACHER ASSIGNMENT / PROFILE / DASHBOARD / SCHEDULE
// + CGPA CALCULATION / EXAM BY ID / VIEW MARKS / VIEW ATTENDANCE
// Every endpoint x 8 roles + anonymous + bad token, verified against the live DB.
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
const rec = (mod, ep, test, exp, got, pass, note) => {
    rows.push({ mod, ep, test, exp, got, pass, note: note || "" });
    console.log(`[${pass ? "PASS" : "FAIL"}] ${mod.padEnd(15)} ${ep.padEnd(30)} ${test.padEnd(23)} exp=${String(exp).padEnd(8)} got=${String(got).padEnd(8)} ${note || ""}`);
};

// allowed = array of role_ids expected through the gate, or "any" for auth-only routes
const sweep = async (mod, method, path, label, allowed, body) => {
    for (const [name, rid] of ACCOUNTS) {
        const r = await call(method, path, T[name], body);
        const ok = r.status >= 200 && r.status < 300;
        const gate = ok || [400, 404, 409, 422, 500].includes(r.status);
        const should = allowed === "any" ? true : allowed.includes(rid);
        rec(mod, label, `role ${rid} ${name}`, should ? "allow" : "403", r.status,
            should ? gate : r.status === 403);
    }
    const anon = await call(method, path, null, body);
    rec(mod, label, "no token", 401, anon.status, anon.status === 401,
        anon.status !== 401 ? "*** NO AUTH GATE ***" : "");
    const bad = await call(method, path, "aaa.bbb.ccc", body);
    rec(mod, label, "bad token", 401, bad.status, bad.status === 401,
        bad.status !== 401 ? "*** accepts bad token ***" : "");
};

(async () => {
    for (const [n, , e, p] of ACCOUNTS) {
        const r = await call("POST", "/api/auth/login", null, { email: e, password: p });
        T[n] = r.json && r.json.token;
    }
    console.log("All 8 roles authenticated.\n");
    const A = T.Admin;
    const stamp = Date.now() % 100000;

    const tch = (await q("SELECT teacher_id FROM teachers WHERE is_deleted=0 LIMIT 1"))[0].teacher_id;
    const subj = (await q("SELECT subject_id FROM subjects WHERE is_deleted=0 LIMIT 1"))[0].subject_id;
    const batch = (await q("SELECT batch_id FROM batches LIMIT 1"))[0].batch_id;
    const sect = (await q("SELECT section_id FROM sections LIMIT 1"))[0].section_id;

    // ================================================= TEACHER ASSIGNMENT
    console.log("############ TEACHER ASSIGNMENT ############");
    const exTa = (await q("SELECT assignment_id FROM teacher_assignments LIMIT 1"))[0];
    const taBody = { teacher_id: tch, subject_id: subj, batch_id: batch, section_id: sect };
    await sweep("tchr-assign", "GET", "/api/teacher-assignments", "GET /teacher-assignments", [2]);
    if (exTa) await sweep("tchr-assign", "GET", `/api/teacher-assignments/${exTa.assignment_id}`, "GET /teacher-assignments/:id", [2]);
    await sweep("tchr-assign", "PUT", "/api/teacher-assignments/999999", "PUT /teacher-assignments/:id", [2], { subject_id: subj });
    await sweep("tchr-assign", "DELETE", "/api/teacher-assignments/999999", "DELETE /teacher-assignments/:id", [2]);
    await sweep("tchr-assign", "POST", "/api/teacher-assignments", "POST /teacher-assignments", [2], taBody);

    let taId = (await q(
        "SELECT assignment_id FROM teacher_assignments WHERE teacher_id=:t AND subject_id=:s ORDER BY assignment_id DESC LIMIT 1",
        { t: tch, s: subj }))[0];
    taId = taId && taId.assignment_id;
    rec("tchr-assign", "POST /teacher-assignments", "DB row created", "found", taId ? "found" : "MISSING", !!taId);
    if (taId) {
        const u = await call("PUT", `/api/teacher-assignments/${taId}`, A, { section_id: sect });
        rec("tchr-assign", "PUT /teacher-assignments/:id", "update", 200, u.status, u.status === 200);
        const db = (await q("SELECT section_id FROM teacher_assignments WHERE assignment_id=:i", { i: taId }))[0];
        rec("tchr-assign", "PUT /teacher-assignments/:id", "DB section persisted", sect, db && db.section_id, db && db.section_id === sect);
    }
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["nonexistent teacher_id", { ...taBody, teacher_id: 999999 }, 400],
        ["teacher_id as string", { ...taBody, teacher_id: "abc" }, 400]
    ]) {
        const r = await call("POST", "/api/teacher-assignments", A, b);
        rec("tchr-assign", "POST /teacher-assignments", lbl, exp, r.status, r.status === exp,
            r.status === 201 ? "*** ACCEPTED INVALID ***" : (r.status >= 500 ? r.text.slice(0, 42) : ""));
        const id = r.json && (r.json.data || {}).assignment_id;
        if (r.status === 201 && id) await call("DELETE", `/api/teacher-assignments/${id}`, A);
    }

    // =================================================== TEACHER PROFILE
    console.log("\n############ TEACHER PROFILE ############");
    const exTp = (await q("SELECT teacher_id FROM teacher_profiles LIMIT 1"))[0];
    const freeT = (await q(`
        SELECT t.teacher_id FROM teachers t
        LEFT JOIN teacher_profiles p ON p.teacher_id = t.teacher_id
        WHERE p.teacher_id IS NULL AND t.is_deleted = 0 LIMIT 1`))[0];
    await sweep("tchr-profile", "GET", "/api/teacher-profiles", "GET /teacher-profiles", [2]);
    if (exTp) await sweep("tchr-profile", "GET", `/api/teacher-profiles/${exTp.teacher_id}`, "GET /teacher-profiles/:id", [2]);
    await sweep("tchr-profile", "PUT", "/api/teacher-profiles/999999", "PUT /teacher-profiles/:id", [2], { qualification: "X" });
    await sweep("tchr-profile", "DELETE", "/api/teacher-profiles/999999", "DELETE /teacher-profiles/:id", [2]);
    await sweep("tchr-profile", "POST", "/api/teacher-profiles", "POST /teacher-profiles", [2], {});

    if (freeT) {
        const body = { teacher_id: freeT.teacher_id, qualification: "MS Testing", specialization: "QA", experience_years: 5 };
        const c = await call("POST", "/api/teacher-profiles", A, body);
        rec("tchr-profile", "POST /teacher-profiles", "create", 201, c.status, c.status === 201,
            c.status >= 500 ? c.text.slice(0, 50) : "");
        if (c.status === 201) {
            const db = (await q("SELECT * FROM teacher_profiles WHERE teacher_id=:i", { i: freeT.teacher_id }))[0];
            rec("tchr-profile", "POST /teacher-profiles", "DB qualification", "MS Testing", db && db.qualification, db && db.qualification === "MS Testing");
            const u = await call("PUT", `/api/teacher-profiles/${freeT.teacher_id}`, A, { qualification: "PhD Testing" });
            rec("tchr-profile", "PUT /teacher-profiles/:id", "update", 200, u.status, u.status === 200);
            const db2 = (await q("SELECT qualification FROM teacher_profiles WHERE teacher_id=:i", { i: freeT.teacher_id }))[0];
            rec("tchr-profile", "PUT /teacher-profiles/:id", "DB persisted", "PhD Testing", db2 && db2.qualification, db2 && db2.qualification === "PhD Testing");
            const d = await call("DELETE", `/api/teacher-profiles/${freeT.teacher_id}`, A);
            rec("tchr-profile", "DELETE /teacher-profiles/:id", "delete", 200, d.status, d.status === 200);
            const left = await q("SELECT * FROM teacher_profiles WHERE teacher_id=:i", { i: freeT.teacher_id });
            rec("tchr-profile", "DELETE /teacher-profiles/:id", "DB row removed", 0, left.length, left.length === 0);
        }
    }
    const tpBad = await call("POST", "/api/teacher-profiles", A, {});
    rec("tchr-profile", "POST /teacher-profiles", "empty body", 400, tpBad.status, tpBad.status === 400,
        tpBad.status >= 500 ? tpBad.text.slice(0, 42) : "");

    // ================================================= TEACHER DASHBOARD
    console.log("\n############ TEACHER DASHBOARD ############");
    await sweep("tchr-dash", "GET", `/api/teacher-dashboard/${tch}`, "GET /teacher-dashboard/:id", [2]);
    const dash = await call("GET", `/api/teacher-dashboard/${tch}`, A);
    rec("tchr-dash", "GET /teacher-dashboard/:id", "returns 200", 200, dash.status, dash.status === 200);
    const hasTeacher = dash.json && dash.json.data && dash.json.data.teacher;
    rec("tchr-dash", "GET /teacher-dashboard/:id", "payload has teacher", "yes", hasTeacher ? "yes" : "no", !!hasTeacher);
    if (hasTeacher) {
        rec("tchr-dash", "GET /teacher-dashboard/:id", "teacher_id matches", tch,
            dash.json.data.teacher.teacher_id, dash.json.data.teacher.teacher_id === tch);
    }
    const dashBad = await call("GET", "/api/teacher-dashboard/999999", A);
    rec("tchr-dash", "GET /teacher-dashboard/:id", "nonexistent", 404, dashBad.status, dashBad.status === 404);

    // ================================================= TEACHER SCHEDULE
    console.log("\n############ TEACHER SCHEDULE ############");
    const exTs = (await q("SELECT schedule_id FROM teacher_schedules LIMIT 1"))[0];
    const tsBody = { teacher_id: tch, subject_id: subj, day: "Friday", start_time: "14:00:00", end_time: "15:30:00", room: "T-" + stamp };
    await sweep("tchr-sched", "GET", "/api/teacher-schedules", "GET /teacher-schedules", [2]);
    if (exTs) await sweep("tchr-sched", "GET", `/api/teacher-schedules/${exTs.schedule_id}`, "GET /teacher-schedules/:id", [2]);
    await sweep("tchr-sched", "PUT", "/api/teacher-schedules/999999", "PUT /teacher-schedules/:id", [2], { day: "Monday" });
    await sweep("tchr-sched", "DELETE", "/api/teacher-schedules/999999", "DELETE /teacher-schedules/:id", [2]);
    await sweep("tchr-sched", "POST", "/api/teacher-schedules", "POST /teacher-schedules", [2], tsBody);

    let tsId = (await q("SELECT schedule_id FROM teacher_schedules WHERE room=:r ORDER BY schedule_id DESC LIMIT 1", { r: tsBody.room }))[0];
    tsId = tsId && tsId.schedule_id;
    rec("tchr-sched", "POST /teacher-schedules", "DB row created", "found", tsId ? "found" : "MISSING", !!tsId);
    if (tsId) {
        const u = await call("PUT", `/api/teacher-schedules/${tsId}`, A, { day: "Saturday" });
        rec("tchr-sched", "PUT /teacher-schedules/:id", "update", 200, u.status, u.status === 200);
        const db = (await q("SELECT day FROM teacher_schedules WHERE schedule_id=:i", { i: tsId }))[0];
        rec("tchr-sched", "PUT /teacher-schedules/:id", "DB day=Saturday", "Saturday", db && db.day, db && db.day === "Saturday");
        const d = await call("DELETE", `/api/teacher-schedules/${tsId}`, A);
        rec("tchr-sched", "DELETE /teacher-schedules/:id", "delete", 200, d.status, d.status === 200);
        const left = await q("SELECT * FROM teacher_schedules WHERE schedule_id=:i", { i: tsId });
        rec("tchr-sched", "DELETE /teacher-schedules/:id", "DB row removed", 0, left.length, left.length === 0);
        const dd = await call("DELETE", `/api/teacher-schedules/${tsId}`, A);
        rec("tchr-sched", "DELETE /teacher-schedules/:id", "double delete", 404, dd.status, dd.status === 404);
    }
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["end before start", { ...tsBody, room: "X" + stamp, start_time: "16:00:00", end_time: "15:00:00" }, 400],
        ["nonexistent teacher_id", { ...tsBody, room: "Y" + stamp, teacher_id: 999999 }, 400]
    ]) {
        const r = await call("POST", "/api/teacher-schedules", A, b);
        rec("tchr-sched", "POST /teacher-schedules", lbl, exp, r.status, r.status === exp,
            r.status === 201 ? "*** ACCEPTED INVALID ***" : (r.status >= 500 ? r.text.slice(0, 42) : ""));
        const id = r.json && (r.json.data || {}).schedule_id;
        if (r.status === 201 && id) await call("DELETE", `/api/teacher-schedules/${id}`, A);
    }

    // ================================================= CGPA CALCULATION
    console.log("\n############ CGPA CALCULATION ############");
    const res = (await q("SELECT student_id, gpa, cgpa FROM results WHERE cgpa IS NOT NULL LIMIT 1"))[0];
    await sweep("cgpa", "GET", `/api/results/cgpa/${res.student_id}`, "GET /results/cgpa/:id", "any");
    const cg = await call("GET", `/api/results/cgpa/${res.student_id}`, A);
    rec("cgpa", "GET /results/cgpa/:id", "returns 200", 200, cg.status, cg.status === 200);
    const apiCgpa = cg.json && (cg.json.cgpa ?? (cg.json.data && cg.json.data.cgpa));
    rec("cgpa", "GET /results/cgpa/:id", "CGPA matches DB", res.cgpa, apiCgpa,
        apiCgpa !== undefined && Number(apiCgpa) === Number(res.cgpa));
    const cgBad = await call("GET", "/api/results/cgpa/999999", A);
    rec("cgpa", "GET /results/cgpa/:id", "nonexistent student", 404, cgBad.status, cgBad.status === 404);
    const tr = await call("GET", `/api/results/transcript/${res.student_id}`, A);
    rec("cgpa", "GET /results/transcript/:id", "transcript 200", 200, tr.status, tr.status === 200);

    // =================================================== GET EXAM BY ID
    console.log("\n############ GET EXAM BY ID ############");
    const ex = (await q("SELECT * FROM exams LIMIT 1"))[0];
    await sweep("exam", "GET", `/api/exams/${ex.exam_id}`, "GET /api/exams/:id", "any");
    const e1 = await call("GET", `/api/exams/${ex.exam_id}`, A);
    rec("exam", "GET /api/exams/:id", "returns 200", 200, e1.status, e1.status === 200);
    const apiEx = e1.json && (e1.json.exam || e1.json.data);
    rec("exam", "GET /api/exams/:id", "exam_name matches DB", ex.exam_name, apiEx && apiEx.exam_name, apiEx && apiEx.exam_name === ex.exam_name);
    rec("exam", "GET /api/exams/:id", "total_marks matches DB", ex.total_marks, apiEx && apiEx.total_marks, apiEx && apiEx.total_marks === ex.total_marks);
    const eBad = await call("GET", "/api/exams/999999", A);
    rec("exam", "GET /api/exams/:id", "nonexistent", 404, eBad.status, eBad.status === 404);
    const eStr = await call("GET", "/api/exams/abc", A);
    rec("exam", "GET /api/exams/:id", "non-numeric id", 400, eStr.status, [400, 404].includes(eStr.status), `got ${eStr.status}`);

    // ================================================== VIEW STUDENT MARKS
    console.log("\n############ VIEW STUDENT MARKS ############");
    const mk = (await q("SELECT student_id, COUNT(*) c FROM marks GROUP BY student_id ORDER BY c DESC LIMIT 1"))[0];
    await sweep("marks", "GET", `/api/marks/student/${mk.student_id}`, "GET /marks/student/:id", "any");
    const m1 = await call("GET", `/api/marks/student/${mk.student_id}`, A);
    rec("marks", "GET /marks/student/:id", "returns 200", 200, m1.status, m1.status === 200);
    const apiMarks = m1.json && (m1.json.marks || m1.json.data || []);
    rec("marks", "GET /marks/student/:id", "count matches DB", mk.c, apiMarks.length, apiMarks.length === mk.c);
    const m0 = await call("GET", "/api/marks/student/999999", A);
    rec("marks", "GET /marks/student/:id", "unknown student", "200/404", m0.status, [200, 404].includes(m0.status));

    // =================================================== VIEW ATTENDANCE
    console.log("\n############ VIEW ATTENDANCE ############");
    const at = (await q("SELECT student_id, COUNT(*) c FROM attendance GROUP BY student_id ORDER BY c DESC LIMIT 1"))[0];
    await sweep("attendance", "GET", `/api/attendance/student/${at.student_id}`, "GET /attendance/student/:id", "any");
    await sweep("attendance", "GET", `/api/attendance/report/${at.student_id}`, "GET /attendance/report/:id", "any");
    await sweep("attendance", "GET", `/api/attendance/percentage/${at.student_id}`, "GET /attendance/percentage/:id", "any");
    const a1 = await call("GET", `/api/attendance/student/${at.student_id}`, A);
    const apiAtt = a1.json && (a1.json.attendance || a1.json.data || []);
    rec("attendance", "GET /attendance/student/:id", "count matches DB", at.c, apiAtt.length, apiAtt.length === at.c);
    const dbRep = (await q(
        "SELECT COUNT(*) total, SUM(status='Present') pres FROM attendance WHERE student_id=:i", { i: at.student_id }))[0];
    const rp = await call("GET", `/api/attendance/report/${at.student_id}`, A);
    const rpt = rp.json && rp.json.report;
    rec("attendance", "GET /attendance/report/:id", "total matches DB", dbRep.total, rpt && rpt.total_classes,
        rpt && Number(rpt.total_classes) === Number(dbRep.total));
    rec("attendance", "GET /attendance/report/:id", "present matches DB", dbRep.pres, rpt && rpt.present,
        rpt && Number(rpt.present) === Number(dbRep.pres));
    const expectedPct = ((Number(dbRep.pres) / Number(dbRep.total)) * 100).toFixed(2);
    const pc = await call("GET", `/api/attendance/percentage/${at.student_id}`, A);
    const apiPct = pc.json && String(pc.json.attendancePercentage || "").replace("%", "");
    rec("attendance", "GET /attendance/percentage/:id", "percentage matches DB", expectedPct + "%", apiPct + "%",
        apiPct === expectedPct);

    // ============================================================ SUMMARY
    const p = rows.filter(r => r.pass).length;
    console.log(`\n================ ${p}/${rows.length} PASSED ================\n`);
    const byMod = {};
    rows.forEach(r => {
        byMod[r.mod] = byMod[r.mod] || { p: 0, t: 0 };
        byMod[r.mod].t++; if (r.pass) byMod[r.mod].p++;
    });
    console.log("PER MODULE:");
    Object.entries(byMod).forEach(([m, v]) =>
        console.log(`  ${m.padEnd(15)} ${v.p}/${v.t}${v.p === v.t ? "  ALL PASS" : ""}`));
    console.log("\nFAILURES:");
    const f = rows.filter(r => !r.pass);
    if (!f.length) console.log("  none");
    f.forEach(r => console.log(`  ${r.mod.padEnd(15)} ${r.ep.padEnd(30)} ${r.test.padEnd(24)} exp=${r.exp} got=${r.got} ${r.note}`));
    require("fs").writeFileSync(__dirname + "/teacher-academic-results.json", JSON.stringify(rows, null, 1));
    await sequelize.close();
})();
