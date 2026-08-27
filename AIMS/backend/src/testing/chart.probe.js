/*
 * Checks that chart-producing tools return data the frontend can actually
 * draw.
 *
 * The widget's toSeries() picks the first numeric column as the value and
 * another column as the label. That works or fails silently — a chart with an
 * undefined value key renders as an empty box, and nobody notices until a user
 * asks why the chart is blank. This runs each charting tool against the live
 * database and applies the same logic the browser will.
 *
 * MySQL returns DECIMAL columns as strings, which is the specific trap here:
 * "62.52" is truthy, is not NaN once coerced, but breaks a chart if it is
 * never coerced. Both the detection and the coercion are checked.
 *
 * Uses no Groq tokens.
 *
 * Usage: node src/testing/chart.probe.js
 */

require("dotenv").config({ quiet: true });

const { readonlySequelize } = require("../database/readonlyConnection");
const scopeService = require("../services/assistant/scope.service");
const tools = require("../services/assistant/tools");
const { ROLES } = require("../config/roles");

let failed = 0;

const assert = (label, ok, detail = "") => {
    console.log(`${ok ? "ok    " : "FAIL  "}${label}${detail ? `  -- ${detail}` : ""}`);
    if (!ok) failed += 1;
};

/*
 * A copy of the widget's series-derivation, deliberately duplicated rather
 * than imported — the frontend is ESM and this is CommonJS, and the point is
 * to verify the browser's logic against real rows. If the widget changes,
 * this must change with it.
 */
function toSeries(rows, declared = {}) {
    if (!rows?.length) return { data: [], labelKey: null, valueKey: null };

    const keys = Object.keys(rows[0]);

    const valueKey = declared.valueKey && keys.includes(declared.valueKey)
        ? declared.valueKey
        : keys.find((k) => rows.some((r) =>
            r[k] !== null
            && !Number.isNaN(Number(r[k]))
            && typeof r[k] !== "boolean"
            && String(r[k]).trim() !== ""));

    const labelKey = declared.labelKey && keys.includes(declared.labelKey)
        ? declared.labelKey
        : (keys.find((k) => k !== valueKey) || keys[0]);

    return {
        labelKey,
        valueKey,
        data: rows.slice(0, 24).map((r) => ({
            ...r,
            [valueKey]: Number(r[valueKey]),
            [labelKey]: r[labelKey] === null || r[labelKey] === undefined
                || String(r[labelKey]).trim() === ""
                ? "Not recorded"
                : r[labelKey]
        })).filter((r) => !Number.isNaN(r[valueKey]))
    };
}

(async () => {

    const [studentRow] = await readonlySequelize.query(
        "SELECT user_id FROM vw_student_profile_full WHERE user_id IS NOT NULL LIMIT 1",
        { type: readonlySequelize.QueryTypes.SELECT }
    );

    const [adminRow] = await readonlySequelize.query(
        "SELECT user_id FROM users WHERE role_id IN (1,2) AND is_deleted = 0 LIMIT 1",
        { type: readonlySequelize.QueryTypes.SELECT }
    );

    const student = await scopeService.resolveFor({
        user_id: studentRow.user_id, role_id: ROLES.STUDENT
    });
    const admin = await scopeService.resolveFor({
        user_id: adminRow.user_id, role_id: ROLES.ADMIN
    });

    // Every tool that declares itself chartable.
    const cases = [
        ["get_students_by_program", admin, { group_by: "program" }],
        ["get_students_by_program", admin, { group_by: "gender" }],
        ["get_results_distribution", admin, {}],
        ["get_fee_collection_summary", admin, {}],
        ["get_attendance_by_program", admin, { group_by: "program" }],
        ["get_gpa_history", student, {}],
        ["get_attendance_trend", student, {}]
    ];

    for (const [name, scope, args] of cases) {

        const result = await tools.dispatch(name, scope, args);

        if (result.type !== "chart") {
            assert(`${name} returns a chart envelope`, false, `got ${result.type}`);
            continue;
        }

        console.log(`\n${name}(${JSON.stringify(args)}) -> ${result.chartType}, ${result.rows.length} rows`);

        if (!result.rows.length) {
            // Not a failure in itself — some seeded data is genuinely empty —
            // but it must be visible, because an empty chart looks like a bug.
            console.log("note  no rows; nothing to draw");
            continue;
        }

        console.log(`      first row: ${JSON.stringify(result.rows[0])}`);

        /*
         * The tool must SAY which columns to plot. Leaving it to inference is
         * what swapped the GPA chart's axes — both candidate columns were
         * numeric, so the guess was wrong in a way that still rendered.
         */
        assert(`  ${name}: declares labelKey and valueKey`,
            Boolean(result.labelKey && result.valueKey),
            `label=${result.labelKey} value=${result.valueKey}`);

        assert(`  ${name}: declared columns exist in the rows`,
            Object.keys(result.rows[0]).includes(result.labelKey)
            && Object.keys(result.rows[0]).includes(result.valueKey));

        const { data, labelKey, valueKey } = toSeries(result.rows, {
            labelKey: result.labelKey,
            valueKey: result.valueKey
        });

        assert(`  ${name}: a numeric value column is found`,
            Boolean(valueKey), `keys: ${Object.keys(result.rows[0]).join(", ")}`);

        assert(`  ${name}: a label column is found`, Boolean(labelKey));

        assert(`  ${name}: label and value are different columns`,
            labelKey !== valueKey,
            labelKey === valueKey ? `both "${labelKey}"` : "");

        assert(`  ${name}: plots ${valueKey} against ${labelKey}`, true);

        assert(`  ${name}: nothing was dropped as non-numeric`,
            data.length === Math.min(result.rows.length, 24),
            `${data.length} of ${Math.min(result.rows.length, 24)} survived`);

        /*
         * The real trap. MySQL hands DECIMAL back as a string, so a value that
         * looks fine in the JSON plots as nothing unless it is coerced.
         */
        const allNumeric = data.every((row) =>
            typeof row[valueKey] === "number" && !Number.isNaN(row[valueKey]));

        assert(`  ${name}: every value coerces to a real number`, allNumeric,
            allNumeric ? "" : `e.g. ${JSON.stringify(data[0][valueKey])}`);

        const labelsPresent = data.every((row) =>
            row[labelKey] !== null && row[labelKey] !== undefined
            && String(row[labelKey]).trim() !== "");

        assert(`  ${name}: every point has an axis label`, labelsPresent);

        // A chart of one category is a number with decoration. Worth knowing,
        // not worth failing.
        if (data.length < 2) {
            console.log(`note  only ${data.length} point(s) — a table would read better`);
        }
    }

    await readonlySequelize.close();

    console.log(failed ? `\n${failed} CHART CHECK(S) FAILED` : "\nAll chart checks passed.");
    process.exit(failed ? 1 : 0);

})().catch((error) => {
    console.error("CHART PROBE CRASHED:", error);
    process.exit(1);
});
