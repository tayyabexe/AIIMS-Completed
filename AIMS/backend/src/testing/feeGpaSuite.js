// CHALLAN / RECEIPT / FEE PAYMENT / FEE REPORT / GPA
// Every endpoint x 8 roles + anonymous + bad token, with live DB verification.
// Creates only its own rows and removes them again.
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
    console.log(`[${pass ? "PASS" : "FAIL"}] ${mod.padEnd(13)} ${ep.padEnd(26)} ${test.padEnd(22)} exp=${String(exp).padEnd(8)} got=${String(got).padEnd(8)} ${note || ""}`);
};

const sweep = async (mod, method, path, label, allowed, body) => {
    for (const [name, rid] of ACCOUNTS) {
        const r = await call(method, path, T[name], body);
        const ok = r.status >= 200 && r.status < 300;
        const gate = ok || [400, 404, 409, 422, 500].includes(r.status);
        const should = allowed.includes(rid);
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

const idOf = (json, pk) => {
    if (!json) return null;
    const c = json.data || json.challan || json.receipt || json.payment || json.gpa || json;
    return c ? c[pk] : null;
};

(async () => {
    for (const [n, , e, p] of ACCOUNTS) {
        const r = await call("POST", "/api/auth/login", null, { email: e, password: p });
        T[n] = r.json && r.json.token;
    }
    console.log("All 8 roles authenticated.\n");
    const A = T.Admin;
    const stamp = Date.now() % 1000000;

    const stu = (await q("SELECT student_id FROM students WHERE is_deleted=0 LIMIT 1"))[0].student_id;
    const sem = (await q("SELECT semester_id FROM semesters LIMIT 1"))[0].semester_id;
    const exCh = (await q("SELECT challan_id FROM challans LIMIT 1"))[0].challan_id;

    // ---------------------------------------------------------------- CHALLAN
    console.log("################ CHALLAN ################");
    const chBody = {
        student_id: stu, voucher_number: `VCH-T-${stamp}`,
        issue_date: "2026-12-01", due_date: "2026-12-31",
        total_amount: 12345.67, status: "Unpaid"
    };
    await sweep("challan", "GET", "/api/challans", "GET /api/challans", [2]);
    await sweep("challan", "GET", `/api/challans/${exCh}`, "GET /api/challans/:id", [2]);
    await sweep("challan", "PUT", "/api/challans/999999", "PUT /api/challans/:id", [2], { status: "Paid" });
    await sweep("challan", "DELETE", "/api/challans/999999", "DELETE /api/challans/:id", [2]);
    await sweep("challan", "POST", "/api/challans", "POST /api/challans", [2], chBody);

    // the sweep above created one challan via the Admin call; find and reuse it
    let chId = (await q("SELECT challan_id FROM challans WHERE voucher_number=:v", { v: chBody.voucher_number }))[0];
    chId = chId && chId.challan_id;
    rec("challan", "POST /api/challans", "DB row created", "found", chId ? "found" : "MISSING", !!chId);

    if (chId) {
        const db = (await q("SELECT * FROM challans WHERE challan_id=:i", { i: chId }))[0];
        rec("challan", "POST /api/challans", "DB amount matches", "12345.67", db.total_amount, String(db.total_amount) === "12345.67");
        const g = await call("GET", `/api/challans/${chId}`, A);
        rec("challan", "GET /api/challans/:id", "read back", 200, g.status, g.status === 200);
        const u = await call("PUT", `/api/challans/${chId}`, A, { status: "Paid" });
        rec("challan", "PUT /api/challans/:id", "update", 200, u.status, u.status === 200);
        const db2 = (await q("SELECT status FROM challans WHERE challan_id=:i", { i: chId }))[0];
        rec("challan", "PUT /api/challans/:id", "DB status=Paid", "Paid", db2.status, db2.status === "Paid");
    }
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["invalid status enum", { ...chBody, voucher_number: `VCH-E-${stamp}`, status: "BOGUS" }, 400],
        ["duplicate voucher_number", chBody, 409],
        ["nonexistent student_id", { ...chBody, voucher_number: `VCH-F-${stamp}`, student_id: 999999 }, 400],
        ["negative amount", { ...chBody, voucher_number: `VCH-N-${stamp}`, total_amount: -500 }, 400]
    ]) {
        const r = await call("POST", "/api/challans", A, b);
        rec("challan", "POST /api/challans", lbl, exp, r.status, r.status === exp,
            r.status === 201 ? "*** ACCEPTED INVALID ***" : (r.status >= 500 ? r.text.slice(0, 45) : ""));
        const bad = idOf(r.json, "challan_id");
        if (r.status === 201 && bad) await call("DELETE", `/api/challans/${bad}`, A);
    }

    // ---------------------------------------------------------------- RECEIPT
    console.log("\n################ RECEIPT ################");
    const exRc = (await q("SELECT receipt_id FROM receipts LIMIT 1"))[0].receipt_id;
    const rcBody = {
        challan_id: chId || exCh, receipt_number: `RCP-T-${stamp}`,
        payment_date: "2026-12-02", amount_paid: 5000
    };
    await sweep("receipt", "GET", "/api/receipts", "GET /api/receipts", [2]);
    await sweep("receipt", "GET", `/api/receipts/${exRc}`, "GET /api/receipts/:id", [2]);
    await sweep("receipt", "PUT", "/api/receipts/999999", "PUT /api/receipts/:id", [2], { amount_paid: 1 });
    await sweep("receipt", "DELETE", "/api/receipts/999999", "DELETE /api/receipts/:id", [2]);
    await sweep("receipt", "POST", "/api/receipts", "POST /api/receipts", [2], rcBody);

    let rcId = (await q("SELECT receipt_id FROM receipts WHERE receipt_number=:v", { v: rcBody.receipt_number }))[0];
    rcId = rcId && rcId.receipt_id;
    rec("receipt", "POST /api/receipts", "DB row created", "found", rcId ? "found" : "MISSING", !!rcId);
    if (rcId) {
        const u = await call("PUT", `/api/receipts/${rcId}`, A, { amount_paid: 7500 });
        rec("receipt", "PUT /api/receipts/:id", "update", 200, u.status, u.status === 200);
        const db = (await q("SELECT amount_paid FROM receipts WHERE receipt_id=:i", { i: rcId }))[0];
        rec("receipt", "PUT /api/receipts/:id", "DB amount=7500.00", "7500.00", db.amount_paid, String(db.amount_paid) === "7500.00");
    }
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["duplicate receipt_number", rcBody, 409],
        ["nonexistent challan_id", { ...rcBody, receipt_number: `RCP-F-${stamp}`, challan_id: 999999 }, 400]
    ]) {
        const r = await call("POST", "/api/receipts", A, b);
        rec("receipt", "POST /api/receipts", lbl, exp, r.status, r.status === exp,
            r.status === 201 ? "*** ACCEPTED INVALID ***" : (r.status >= 500 ? r.text.slice(0, 45) : ""));
        const bad = idOf(r.json, "receipt_id");
        if (r.status === 201 && bad) await call("DELETE", `/api/receipts/${bad}`, A);
    }

    // ------------------------------------------------------------ FEE PAYMENT
    console.log("\n################ FEE PAYMENT ################");
    const exFp = (await q("SELECT fee_payment_id FROM fee_payments LIMIT 1"))[0].fee_payment_id;
    const fpBody = {
        challan_id: chId || exCh, receipt_id: rcId || exRc,
        amount_paid: 2500, payment_method: "Cash",
        payment_date: "2026-12-03", status: "Completed"
    };
    await sweep("fee-payment", "GET", "/api/fee-payments", "GET /api/fee-payments", [2]);
    await sweep("fee-payment", "GET", `/api/fee-payments/${exFp}`, "GET /api/fee-payments/:id", [2]);
    await sweep("fee-payment", "PUT", "/api/fee-payments/999999", "PUT /api/fee-payments/:id", [2], { amount_paid: 1 });
    await sweep("fee-payment", "DELETE", "/api/fee-payments/999999", "DELETE /api/fee-payments/:id", [2]);
    await sweep("fee-payment", "POST", "/api/fee-payments", "POST /api/fee-payments", [2], fpBody);

    let fpId = (await q(
        "SELECT fee_payment_id FROM fee_payments WHERE payment_date='2026-12-03' AND amount_paid=2500 ORDER BY fee_payment_id DESC LIMIT 1"))[0];
    fpId = fpId && fpId.fee_payment_id;
    rec("fee-payment", "POST /api/fee-payments", "DB row created", "found", fpId ? "found" : "MISSING", !!fpId);
    if (fpId) {
        const u = await call("PUT", `/api/fee-payments/${fpId}`, A, { status: "Pending" });
        rec("fee-payment", "PUT /api/fee-payments/:id", "update", 200, u.status, u.status === 200);
        const db = (await q("SELECT status FROM fee_payments WHERE fee_payment_id=:i", { i: fpId }))[0];
        rec("fee-payment", "PUT /api/fee-payments/:id", "DB status=Pending", "Pending", db.status, db.status === "Pending");
    }
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["invalid payment_method", { ...fpBody, payment_method: "Crypto" }, 400],
        ["invalid status enum", { ...fpBody, status: "BOGUS" }, 400],
        ["nonexistent challan_id", { ...fpBody, challan_id: 999999 }, 400]
    ]) {
        const r = await call("POST", "/api/fee-payments", A, b);
        rec("fee-payment", "POST /api/fee-payments", lbl, exp, r.status, r.status === exp,
            r.status === 201 ? "*** ACCEPTED INVALID ***" : (r.status >= 500 ? r.text.slice(0, 45) : ""));
        const bad = idOf(r.json, "fee_payment_id");
        if (r.status === 201 && bad) await call("DELETE", `/api/fee-payments/${bad}`, A);
    }

    // ------------------------------------------------------------- FEE REPORT
    console.log("\n################ FEE REPORT (read-only) ################");
    await sweep("fee-report", "GET", "/api/fee-reports", "GET /api/fee-reports", [2]);
    await sweep("fee-report", "GET", `/api/fee-reports/${exFp}`, "GET /api/fee-reports/:id", [2]);
    const fr = await call("GET", "/api/fee-reports", A);
    const frCount = fr.json && (fr.json.data || fr.json.reports || []).length;
    const dbFp = (await q("SELECT COUNT(*) c FROM fee_payments"))[0].c;
    rec("fee-report", "GET /api/fee-reports", "count vs fee_payments", dbFp, frCount, frCount === dbFp);
    const frBad = await call("GET", "/api/fee-reports/999999", A);
    rec("fee-report", "GET /api/fee-reports/:id", "nonexistent", 404, frBad.status, frBad.status === 404);
    const frWrite = await call("POST", "/api/fee-reports", A, {});
    rec("fee-report", "POST /api/fee-reports", "write blocked", 404, frWrite.status, frWrite.status === 404);

    // -------------------------------------------------------------------- GPA
    console.log("\n################ GPA ################");
    const exG = (await q("SELECT gpa_id FROM gpa LIMIT 1"))[0].gpa_id;
    const gBody = { student_id: stu, semester_id: sem, gpa: 3.25, cgpa: 3.40 };
    await sweep("gpa", "GET", "/api/gpa", "GET /api/gpa", [2]);
    await sweep("gpa", "GET", `/api/gpa/${exG}`, "GET /api/gpa/:id", [2]);
    await sweep("gpa", "PUT", "/api/gpa/999999", "PUT /api/gpa/:id", [2], { gpa: 3 });
    await sweep("gpa", "DELETE", "/api/gpa/999999", "DELETE /api/gpa/:id", [2]);
    await sweep("gpa", "POST", "/api/gpa", "POST /api/gpa", [2], gBody);

    let gId = (await q(
        "SELECT gpa_id FROM gpa WHERE student_id=:s AND gpa=3.25 ORDER BY gpa_id DESC LIMIT 1", { s: stu }))[0];
    gId = gId && gId.gpa_id;
    rec("gpa", "POST /api/gpa", "DB row created", "found", gId ? "found" : "MISSING", !!gId);
    if (gId) {
        const u = await call("PUT", `/api/gpa/${gId}`, A, { gpa: 3.75 });
        rec("gpa", "PUT /api/gpa/:id", "update", 200, u.status, u.status === 200);
        const db = (await q("SELECT gpa FROM gpa WHERE gpa_id=:i", { i: gId }))[0];
        rec("gpa", "PUT /api/gpa/:id", "DB gpa=3.75", "3.75", db.gpa, String(db.gpa) === "3.75");
    }
    for (const [lbl, b, exp] of [
        ["empty body", {}, 400],
        ["gpa above 4.0", { ...gBody, gpa: 99 }, 400],
        ["negative cgpa", { ...gBody, cgpa: -5 }, 400],
        ["nonexistent student_id", { ...gBody, student_id: 999999 }, 400]
    ]) {
        const r = await call("POST", "/api/gpa", A, b);
        rec("gpa", "POST /api/gpa", lbl, exp, r.status, r.status === exp,
            r.status === 201 ? "*** ACCEPTED INVALID ***" : (r.status >= 500 ? r.text.slice(0, 45) : ""));
        const bad = idOf(r.json, "gpa_id");
        if (r.status === 201 && bad) await call("DELETE", `/api/gpa/${bad}`, A);
    }

    // ---------------------------------------------------------------- CLEANUP
    console.log("\n################ CLEANUP + DB VERIFY ################");
    for (const [mod, path, id, table, pk] of [
        ["gpa", "/api/gpa", gId, "gpa", "gpa_id"],
        ["fee-payment", "/api/fee-payments", fpId, "fee_payments", "fee_payment_id"],
        ["receipt", "/api/receipts", rcId, "receipts", "receipt_id"],
        ["challan", "/api/challans", chId, "challans", "challan_id"]
    ]) {
        if (!id) continue;
        const d = await call("DELETE", `${path}/${id}`, A);
        rec(mod, `DELETE ${path}/:id`, "delete", 200, d.status, d.status === 200);
        const left = await q(`SELECT * FROM ${table} WHERE ${pk}=:i`, { i: id });
        rec(mod, `DELETE ${path}/:id`, "DB row removed", 0, left.length, left.length === 0);
        const dd = await call("DELETE", `${path}/${id}`, A);
        rec(mod, `DELETE ${path}/:id`, "double delete", 404, dd.status, dd.status === 404);
    }

    const p = rows.filter(r => r.pass).length;
    console.log(`\n================ ${p}/${rows.length} PASSED ================\n`);
    const byMod = {};
    rows.forEach(r => {
        byMod[r.mod] = byMod[r.mod] || { p: 0, t: 0 };
        byMod[r.mod].t++; if (r.pass) byMod[r.mod].p++;
    });
    console.log("PER MODULE:");
    Object.entries(byMod).forEach(([m, v]) => console.log(`  ${m.padEnd(14)} ${v.p}/${v.t}`));
    console.log("\nFAILURES:");
    rows.filter(r => !r.pass).forEach(r =>
        console.log(`  ${r.mod.padEnd(13)} ${r.ep.padEnd(26)} ${r.test.padEnd(24)} exp=${r.exp} got=${r.got} ${r.note}`));
    require("fs").writeFileSync(__dirname + "/fee-gpa-results.json", JSON.stringify(rows, null, 1));
    await sequelize.close();
})();
