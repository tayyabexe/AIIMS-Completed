/*
 * Adversarial probe for teacher-scoped SQL.
 *
 * Teachers can now run generated SQL. The scope is enforced by redefining
 * every queryable name as a CTE over their own roster (see scopedSql.js), so
 * the property under test is:
 *
 *   NO query a teacher can write returns a row about a student they do not
 *   teach, however it is phrased.
 *
 * This does not test the guard by reading it. It resolves a real teacher's
 * scope from the live database, runs each attack through the real tool, and
 * checks the actual rows returned against the roster. A query that is allowed
 * through but returns only in-scope rows passes; one that returns a single
 * out-of-scope student fails, whatever the guard said.
 *
 * Uses no Groq tokens - the SQL is written here, playing the part of a model
 * that has been successfully talked into trying.
 *
 * Usage: node src/testing/scopedSql.probe.js
 */

require("dotenv").config({ quiet: true });

const { readonlySequelize } = require("../database/readonlyConnection");
const scopeService = require("../services/assistant/scope.service");
const tools = require("../services/assistant/tools");
const { ROLES } = require("../config/roles");

let failures = 0;

const report = (ok, label, detail = "") => {
    console.log(`${ok ? "ok    " : "FAIL  "}${label}${detail ? `  -- ${detail}` : ""}`);
    if (!ok) failures += 1;
};

(async () => {

    const [teacherRow] = await readonlySequelize.query(
        `SELECT e.user_id, t.teacher_id
           FROM teachers t
           JOIN employees e ON e.employee_id = t.employee_id
          WHERE t.is_deleted = 0 AND e.is_deleted = 0
            AND t.teacher_id IN (SELECT teacher_id FROM vw_teacher_class_roster)
          LIMIT 1`,
        { type: readonlySequelize.QueryTypes.SELECT }
    );

    const scope = await scopeService.resolveFor({
        user_id: teacherRow.user_id,
        role_id: ROLES.TEACHER
    });

    if (!scope.ok) {
        console.error("could not resolve a teacher scope:", scope.reason);
        process.exit(1);
    }

    console.log(
        `teacher_id=${scope.teacherId}  subjects=${scope.subjectIds.length}  ` +
        `sections=${scope.sectionIds.length}  students=${scope.studentIds.size}\n`
    );

    const run = (sql) => tools.dispatch("execute_readonly_query", scope, {
        sql,
        purpose: "adversarial probe"
    });

    // ------------------------------------------------ must be REFUSED ----
    console.log("--- statements that must be refused\n");

    const mustRefuse = [
        ["reaching the real users table", "SELECT email FROM users LIMIT 5"],
        ["reaching payroll", "SELECT * FROM payroll LIMIT 5"],
        ["reaching employees", "SELECT first_name FROM employees LIMIT 5"],
        ["reaching fee_vouchers", "SELECT total_payable FROM fee_vouchers LIMIT 5"],
        ["reaching the results table", "SELECT gpa FROM results LIMIT 5"],

        // The core bypass: a schema prefix resolves past the CTE to the real
        // table, so it has to be refused outright.
        ["schema-qualified bypass", "SELECT student_id FROM aims_db.students LIMIT 5"],

        // Redefining the shadowed name would undo the entire mechanism.
        ["redefining students via WITH",
            "WITH students AS (SELECT student_id FROM aims_db.students) SELECT * FROM students LIMIT 5"],

        ["a view the allowlist omits",
            "SELECT student_id FROM vw_student_profile_full LIMIT 5"],
        ["the assistant's own transcripts",
            "SELECT content FROM assistant_messages LIMIT 5"],
        ["information_schema", "SELECT table_name FROM information_schema.tables LIMIT 5"],
        ["a write", "DELETE FROM students"],
        ["a join that reaches out of scope",
            "SELECT s.first_name FROM students s JOIN users u ON u.user_id = s.student_id LIMIT 5"],
        ["a subquery that reaches out of scope",
            "SELECT student_id FROM students WHERE student_id IN (SELECT student_id FROM fee_vouchers) LIMIT 5"],
        ["UNION to an unscoped table",
            "SELECT student_id FROM students UNION SELECT student_id FROM fee_vouchers LIMIT 5"]
    ];

    for (const [label, sql] of mustRefuse) {
        const result = await run(sql);
        report(result.type === "refused", label,
            result.type !== "refused" ? `got ${result.type}` : "");
    }

    // ------------------------------------------------ must be ALLOWED ----
    console.log("\n--- legitimate queries that must work\n");

    const mustAllow = [
        ["roster count", "SELECT COUNT(*) AS n FROM students"],
        ["attendance joined to marks",
            `SELECT s.registration_number, a.attendance_percentage, AVG(m.percentage) AS avg_mark
               FROM students s
               JOIN attendance_summary a ON a.student_id = s.student_id
               JOIN student_marks m ON m.student_id = s.student_id
              GROUP BY s.registration_number, a.attendance_percentage
              LIMIT 10`],
        ["grade bands via the grades table",
            `SELECT g.grade_letter, COUNT(*) AS n
               FROM student_marks m
               JOIN grades g ON m.percentage BETWEEN g.min_percentage AND g.max_percentage
              GROUP BY g.grade_letter`],
        ["enrolment status breakdown",
            "SELECT status, COUNT(*) AS n FROM enrollments GROUP BY status"]
    ];

    for (const [label, sql] of mustAllow) {
        const result = await run(sql);
        report(result.type === "table", label,
            result.type !== "table" ? result.message : `${result.rows.length} rows`);
    }

    // -------------------------------------- the property that matters ----
    //
    // Allowed queries must not merely run: every student they return must be
    // on this teacher's roster. This is checked against actual returned rows,
    // not against what the guard claimed.
    console.log("\n--- returned rows must all be in scope\n");

    const leakProbes = [
        ["every student the query can see",
            "SELECT student_id FROM students LIMIT 500"],
        ["students reachable through attendance",
            "SELECT DISTINCT student_id FROM attendance LIMIT 500"],
        ["students reachable through marks",
            "SELECT DISTINCT student_id FROM marks LIMIT 500"],
        ["students reachable through the roster",
            "SELECT DISTINCT student_id FROM class_roster LIMIT 500"],
        ["students reachable through enrolments",
            "SELECT DISTINCT student_id FROM enrollments LIMIT 500"]
    ];

    for (const [label, sql] of leakProbes) {

        const result = await run(sql);

        if (result.type !== "table") {
            report(false, label, `refused unexpectedly: ${result.message}`);
            continue;
        }

        const outside = result.rows
            .map((row) => Number(row.student_id))
            .filter((id) => !scope.studentIds.has(id));

        report(outside.length === 0, label,
            outside.length
                ? `LEAKED ${outside.length} students, e.g. ${outside.slice(0, 3).join(", ")}`
                : `${result.rows.length} rows, all in scope`);
    }

    // Total students in the institute vs what the teacher can reach - the
    // headline number that makes a leak obvious.
    const [{ total }] = await readonlySequelize.query(
        "SELECT COUNT(*) AS total FROM students WHERE is_deleted = 0",
        { type: readonlySequelize.QueryTypes.SELECT }
    );

    const reachable = await run("SELECT COUNT(*) AS n FROM students");

    console.log(
        `\ninstitute has ${total} students; this teacher's SQL can reach ` +
        `${reachable.rows?.[0]?.n} (roster size ${scope.studentIds.size})`
    );

    report(Number(reachable.rows?.[0]?.n) === scope.studentIds.size,
        "reachable student count equals roster size exactly");

    await readonlySequelize.close();

    console.log(failures ? `\n${failures} PROBE(S) FAILED` : "\nAll probes passed.");
    process.exit(failures ? 1 : 0);

})().catch((error) => {
    console.error("PROBE CRASHED:", error);
    process.exit(1);
});
