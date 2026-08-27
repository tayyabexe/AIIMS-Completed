/*
 * Boot smoke test for the assistant.
 *
 * Loads the Express app the way the server does, then checks the parts that
 * can be verified without a live HTTP request: that every module resolves,
 * that the tool registry built without a name collision, that each role is
 * offered the right tools and denied the wrong ones, and that the SQL guard
 * refuses what it is supposed to.
 *
 * Deliberately does NOT call Groq — this is meant to run without spending
 * tokens or needing the network.
 *
 * Usage: node src/testing/assistant.smoke.js
 */

require("dotenv").config({ quiet: true });

const assert = (label, condition) => {
    console.log(`${condition ? "ok   " : "FAIL "} ${label}`);
    if (!condition) process.exitCode = 1;
};

(async () => {

    // --- modules load -----------------------------------------------------
    require("../app");
    console.log("ok    app.js loads with /api/assistant mounted\n");

    const tools = require("../services/assistant/tools");
    const sqlGuard = require("../services/assistant/sqlGuard");
    const config = require("../config/assistant");

    // --- registry ---------------------------------------------------------
    const all = Object.keys(tools.registry);
    console.log(`registry: ${all.length} tools\n`);
    assert("more than 12 tools are registered", all.length > 12);

    // --- role visibility --------------------------------------------------
    //
    // The scope objects below are the minimum shape definitionsFor() reads.
    const student = {
        kind: "student", userId: 1, roleId: 4, studentId: 1,
        fullName: "Test Student", registrationNumber: "TEST-1",
        programName: "BS Computer Science", sectionId: 1, semesterNumber: 4
    };
    const teacher = {
        kind: "teacher", userId: 2, roleId: 3, teacherId: 1,
        fullName: "Test Teacher", departmentName: "CS",
        subjectIds: [1], sectionIds: [1], studentIds: new Set([1]),
        classes: [{ subjectId: 1, sectionId: 1 }]
    };
    const admin = { kind: "admin", userId: 3, roleId: 2, unrestricted: true };

    const studentTools = tools.namesFor(student);
    const teacherTools = tools.namesFor(teacher);
    const adminTools = tools.namesFor(admin);

    console.log(`  student: ${studentTools.length}  ${studentTools.join(", ")}`);
    console.log(`  teacher: ${teacherTools.length}  ${teacherTools.join(", ")}`);
    console.log(`  admin  : ${adminTools.length}  ${adminTools.join(", ")}\n`);

    /*
     * Students never get a SQL channel. Teachers do, but theirs runs against
     * CTEs redefined over their own roster (scopedSql.js), so the scope is not
     * something the generated statement has to remember to apply.
     */
    assert("student is NOT offered execute_readonly_query",
        !studentTools.includes("execute_readonly_query"));
    assert("teacher IS offered execute_readonly_query (scoped)",
        teacherTools.includes("execute_readonly_query"));
    assert("admin IS offered execute_readonly_query",
        adminTools.includes("execute_readonly_query"));

    assert("student is NOT offered get_fee_defaulters",
        !studentTools.includes("get_fee_defaulters"));
    assert("student is NOT offered get_class_roster",
        !studentTools.includes("get_class_roster"));
    assert("teacher is NOT offered get_institute_overview",
        !teacherTools.includes("get_institute_overview"));
    assert("student IS offered get_my_marks",
        studentTools.includes("get_my_marks"));
    assert("teacher IS offered get_my_classes",
        teacherTools.includes("get_my_classes"));

    /*
     * The router section that stood here tested services/assistant/router.js,
     * which selected which of 33 tools to offer the model on the old
     * /api/assistant route. That route and that router are gone: analytics
     * builds its catalogue in services/analytics/catalogue.js instead, and
     * there is no per-question tool selection left to test.
     *
     * Everything else in this file survives because it covers machinery the
     * analytics route inherited and still uses - the tool registry, the role
     * filter and the SQL guard.
     */

    // --- dispatcher refuses out-of-role calls -----------------------------
    //
    // The registry never offers these names to this scope, so reaching the
    // dispatcher means the model invented one. It must still be refused.
    const sneaky = await tools.dispatch("execute_readonly_query", student, {
        sql: "SELECT 1", purpose: "probe"
    });
    assert("dispatcher refuses a tool the role cannot see",
        sneaky.type === "refused");

    const unknown = await tools.dispatch("drop_everything", admin, {});
    assert("dispatcher rejects an unknown tool name", unknown.type === "error");

    // --- SQL guard --------------------------------------------------------
    console.log("");
    const mustFail = [
        ["DELETE", "DELETE FROM students"],
        ["UPDATE", "UPDATE students SET first_name='x'"],
        ["DROP", "DROP TABLE students"],
        ["multi-statement", "SELECT 1; DROP TABLE students"],
        ["INTO OUTFILE", "SELECT * FROM users INTO OUTFILE '/tmp/x'"],
        ["information_schema", "SELECT * FROM information_schema.tables"],
        ["mysql schema", "SELECT * FROM mysql.user"],
        ["password_hash", "SELECT password_hash FROM users"],
        ["CNIC", "SELECT cnic_bform FROM students"],
        ["salary", "SELECT basic_salary FROM employees"],
        ["assistant transcripts", "SELECT * FROM assistant_messages"],
        ["comment-hidden DROP", "SELECT 1 /* x */ ; /* y */ DROP TABLE students"],
        ["SLEEP", "SELECT SLEEP(30)"],
        ["stored procedure", "CALL sp_mark_overdue_fees()"]
    ];

    for (const [label, sql] of mustFail) {
        assert(`SQL guard blocks ${label}`, sqlGuard.validate(sql).ok === false);
    }

    const mustPass = [
        ["plain SELECT", "SELECT student_id FROM students LIMIT 10"],
        ["WITH clause", "WITH x AS (SELECT 1 AS n) SELECT n FROM x"],
        ["string containing the word delete",
            "SELECT subject_name FROM subjects WHERE subject_name = 'delete me'"]
    ];

    for (const [label, sql] of mustPass) {
        const result = sqlGuard.validate(sql);
        assert(`SQL guard allows ${label}`, result.ok === true);
    }

    // --- LIMIT enforcement -------------------------------------------------
    const noLimit = sqlGuard.validate("SELECT student_id FROM students");
    assert("a missing LIMIT is added",
        noLimit.ok && /LIMIT \d+$/.test(noLimit.sql));

    const bigLimit = sqlGuard.validate("SELECT student_id FROM students LIMIT 99999");
    assert("an oversized LIMIT is reduced",
        bigLimit.ok && bigLimit.sql.endsWith(`LIMIT ${config.maxSqlRows}`));

    const smallLimit = sqlGuard.validate("SELECT student_id FROM students LIMIT 5");
    assert("a smaller LIMIT is respected",
        smallLimit.ok && smallLimit.sql.endsWith("LIMIT 5"));

    // --- teacher-scoped SQL ------------------------------------------------
    //
    // The live-data version of this is src/testing/scopedSql.probe.js, which
    // checks the rows actually returned. These are the offline invariants.
    console.log("");
    const scopedSql = require("../services/assistant/scopedSql");

    const prelude = scopedSql.buildPrelude(teacher);

    assert("every allowlisted name is shadowed by a CTE in the prelude",
        scopedSql.ALLOWED_TABLES.every((name) =>
            new RegExp(`\\b${name} AS \\(`).test(prelude)));

    assert("the prelude pins the roster into every student-bearing CTE",
        prelude.includes("student_id IN (1)"));

    const scopedCases = [
        ["allows a plain SELECT on an allowlisted name",
            "SELECT student_id FROM students", true],
        ["allows a join between allowlisted names",
            "SELECT s.student_id FROM students s JOIN marks m ON m.student_id = s.student_id", true],
        ["refuses an unlisted table", "SELECT email FROM users", false],
        ["refuses a schema-qualified bypass",
            "SELECT student_id FROM aims_db.students", false],
        ["refuses a teacher-supplied WITH",
            "WITH students AS (SELECT 1) SELECT * FROM students", false],
        ["refuses an unlisted table inside a subquery",
            "SELECT student_id FROM students WHERE student_id IN (SELECT student_id FROM fee_vouchers)", false],
        ["refuses an unlisted table in a UNION branch",
            "SELECT student_id FROM students UNION SELECT student_id FROM results", false],
        ["refuses a view the allowlist omits",
            "SELECT student_id FROM vw_student_profile_full", false]
    ];

    for (const [label, sql, shouldPass] of scopedCases) {
        const result = sqlGuard.validateScoped(
            sql, prelude, scopedSql.ALLOWED_TABLES
        );
        assert(`scoped SQL ${label}`, result.ok === shouldPass);
    }

    // The prelude must actually be prepended, or the CTEs never apply.
    const scopedOk = sqlGuard.validateScoped(
        "SELECT student_id FROM students", prelude, scopedSql.ALLOWED_TABLES
    );
    assert("an accepted scoped query carries the prelude",
        scopedOk.ok && scopedOk.sql.startsWith("WITH "));

    // A teacher must never be shown the real schema.
    const teacherSchema = scopedSql.describeForTeacher();
    assert("the teacher schema description hides unrelated tables",
        !/\busers\b|\bpayroll\b|\bfee_vouchers\b|\bemployees\b/.test(teacherSchema));

    // --- failures must not be reported as permission problems --------------
    //
    // Reported live: an admin asked for the names of fee defaulters, the model
    // guessed a column `student_name` that does not exist, and then told the
    // user the information was "outside what your account can see". That is
    // false and alarming — an administrator is entitled to that data, and the
    // query failed only because of a typo.
    console.log("");
    {
        const badColumn = await tools.dispatch("execute_readonly_query", admin, {
            sql: "SELECT student_name FROM vw_fee_defaulters LIMIT 10",
            purpose: "regression: unknown column"
        });

        assert("an unknown column is an error, not a refusal",
            badColumn.type === "error");

        assert("the message says it is NOT a permission problem",
            /NOT A PERMISSION PROBLEM|not a permission/i.test(badColumn.message));

        assert("the message tells the model how to recover",
            /describe_database_schema/.test(badColumn.message));
    }

    // --- API key pool ------------------------------------------------------
    console.log("");
    const groq = require("../services/assistant/groq.client");
    const status = groq.keyStatus();

    assert(`at least one API key is configured (${status.length})`, status.length >= 1);

    if (status.length > 1) {
        assert("multiple keys are pooled for rotation", status.length >= 2);
    } else {
        console.log("note  only one Groq key configured; rotation has nothing to rotate to");
    }

    // A credential must never be printable from the status object.
    const fullKeys = config.groq.apiKeys;
    assert("key status exposes no full key",
        status.every((s) => !fullKeys.some((k) => s.key === k || s.key.length > 12)));

    // --- rate limiting ------------------------------------------------------
    console.log("");
    const rateLimit = require("../middlewares/assistantRateLimit.middleware");
    rateLimit.reset();

    const studentLimits = rateLimit.limitsFor(4);
    const adminLimits = rateLimit.limitsFor(2);

    assert("admins get a larger allowance than students",
        adminLimits.perMinute > studentLimits.perMinute);

    /*
     * Drives the middleware directly with a fake req/res rather than over
     * HTTP — the behaviour under test is the counting, not Express.
     */
    const runRequest = (userId, roleId) => new Promise((resolve) => {
        const headers = {};
        const res = {
            set: (k, v) => { headers[k] = v; },
            status(code) { this._code = code; return this; },
            json(body) { resolve({ code: this._code, body, headers }); return this; }
        };
        rateLimit({ user: { user_id: userId, role_id: roleId } }, res,
            () => resolve({ code: 200, headers }));
    });

    let allowed = 0;
    let blocked = null;

    // One more than the per-minute allowance, so the limit must trip.
    for (let i = 0; i < studentLimits.perMinute + 1; i++) {
        const result = await runRequest(9001, 4);
        if (result.code === 200) allowed += 1;
        else blocked = result;
    }

    assert(`allows exactly the per-minute budget (${allowed}/${studentLimits.perMinute})`,
        allowed === studentLimits.perMinute);
    assert("blocks the request past the limit", blocked?.code === 429);
    assert("the refusal names the window", blocked?.body?.limit_window === "minute");
    assert("the refusal sets Retry-After",
        Number(blocked?.headers?.["Retry-After"]) > 0);
    assert("the refusal is written for a person to read",
        /wait|too quickly/i.test(blocked?.body?.message || ""));

    // Limits are per account: a different user is unaffected by the first
    // user's spending. An IP-keyed limiter would fail this.
    const otherUser = await runRequest(9002, 4);
    assert("a different account is unaffected", otherUser.code === 200);

    assert("usage is reported per account",
        rateLimit.usageFor(9001).minute === studentLimits.perMinute
        && rateLimit.usageFor(9002).minute === 1);

    rateLimit.reset();
    assert("reset clears the counters", rateLimit.usageFor(9001).minute === 0);

    /*
     * The prompt-builder section that stood here tested
     * services/assistant/prompt.js - the system prompt for the old
     * /api/assistant tool-calling loop. Both are deleted.
     *
     * The checks it made have not gone unguarded, they moved with the code
     * that replaced it: the chatbot's system prompt is a constant exported
     * as orchestrator.SYSTEM and exercised by chatbot.smoke.js, and the
     * analytics planner's prompt is covered by its own catalogue tests.
     *
     * WORTH RESTORING SOMEWHERE, THOUGH: the credential-leak assertion.
     * It checked that no prompt contained GROQ_API_KEY, AI_DB_PASSWORD or
     * DB_PASSWORD - a cheap guard against a careless template edit, and one
     * no other test currently makes.
     */

    console.log(
        process.exitCode
            ? "\nSMOKE TEST FAILED"
            : "\nAll smoke checks passed."
    );

    process.exit(process.exitCode || 0);

})().catch((error) => {
    console.error("\nSMOKE TEST CRASHED:", error);
    process.exit(1);
});
