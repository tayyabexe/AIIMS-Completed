/*
 * Validates a plan before anything is executed.
 *
 * The planner's output is model-generated text, and model-generated text is
 * untrusted input no matter how well the prompt is written. Everything here
 * assumes the plan may be wrong, malicious, or nonsense, and that the correct
 * response to each is to degrade rather than to fail.
 *
 * The bias throughout is: a plan that is wrong about PRESENTATION gets
 * corrected silently (a bad chart becomes a table). A plan that is wrong about
 * ACCESS gets rejected outright. Never the other way round.
 */

const config = require("../../config/analytics");

const TEMPLATES = new Set(config.templates);

/*
 * Drops arguments the planner filled in with a placeholder.
 *
 * Told to omit unused optional arguments, models routinely send the key anyway
 * with an empty string: `{"program_id": "", "batch_id": ""}`. An empty string
 * against a parameter declared integer is rejected before the tool runs, so a
 * perfectly good plan fails over four fields the user never mentioned.
 *
 * Stripping them here is better than widening every tool's schema to accept
 * junk, because "absent" is what the planner meant in the first place.
 */
const cleanArgs = (args) => {

    if (!args || typeof args !== "object" || Array.isArray(args)) return {};

    const out = {};

    for (const [key, value] of Object.entries(args)) {

        if (value === null || value === undefined) continue;
        if (typeof value === "string" && !value.trim()) continue;

        /*
         * Numeric parameters arriving as strings ("3" for program_id) are
         * coerced rather than dropped: the intent is unambiguous and the tool
         * would otherwise reject a filter the user did ask for.
         */
        if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
            out[key] = Number(value.trim());
            continue;
        }

        out[key] = value;
    }

    return out;
};

/**
 * Checks the structural shape of a plan and the access implied by it.
 *
 * @param {Object} plan  the parsed planner output
 * @param {Object} scope the caller's resolved scope
 * @param {Set}    names tool names this scope may call, from the catalogue
 * @returns {Object} { ok, mode, tool, args, sql, title, render, reason }
 */
const validate = (plan, scope, names) => {

    if (!plan || typeof plan !== "object") {
        return { ok: false, reason: "The planner returned no usable plan." };
    }

    const mode = String(plan.mode || "").toLowerCase();

    if (mode === "refuse") {
        return {
            ok: false,
            refused: true,
            reason: String(plan.reason || "").trim()
                || "That question cannot be answered from this database."
        };
    }

    if (mode !== "tool" && mode !== "sql") {
        return { ok: false, reason: "The planner chose an unknown mode." };
    }

    /*
     * A tool name the scope may not call is the one case that is escalated
     * rather than degraded.
     *
     * In practice it means the model invented a name, since the catalogue only
     * ever listed permitted ones. But "the model asked for something it was
     * not offered" is exactly the shape a successful prompt injection would
     * take, so it is refused and logged rather than quietly dropped.
     */
    if (mode === "tool") {

        const tool = String(plan.tool || "").trim();

        if (!tool) {
            return { ok: false, reason: "The planner named no tool." };
        }

        if (!names.has(tool)) {
            return {
                ok: false,
                outOfScope: true,
                reason: `This account cannot run "${tool}".`
            };
        }
    }

    if (mode === "sql") {

        const sql = String(plan.sql || "").trim();

        if (!sql) {
            return { ok: false, reason: "The planner produced no SQL." };
        }

        /*
         * Only a shape check here. The real defences are sqlGuard.validate,
         * scopedSql's CTE prelude, and the SELECT-only database account, all
         * applied in the executor. This exists to fail early on obvious
         * nonsense, not to be the thing standing between a user and the
         * students table.
         */
        if (!/^\s*(WITH|SELECT)\b/i.test(sql)) {
            return { ok: false, reason: "Analytics can only run SELECT queries." };
        }
    }

    /*
     * Presentation from here down. Everything below degrades.
     */
    const render = plan.render && typeof plan.render === "object"
        ? plan.render
        : {};

    let template = String(render.template || "table").toLowerCase();

    if (!TEMPLATES.has(template)) template = "table";

    const xKey = typeof render.xKey === "string" ? render.xKey.trim() : "";

    const yKeys = Array.isArray(render.yKeys)
        ? render.yKeys.filter((k) => typeof k === "string" && k.trim())
            .map((k) => k.trim())
        : [];

    /*
     * The template is left exactly as the planner chose it, even when xKey and
     * yKeys are missing or wrong.
     *
     * Downgrading here would be premature: the columns are not known until the
     * query has run, and reconcile() can usually derive correct axes from the
     * real result. Deciding "this cannot be a chart" before seeing the data
     * turned every column-name mismatch into a table unnecessarily.
     *
     * Template choice is intent, and intent is the planner's job. Whether the
     * data supports it is a fact, and facts are settled in reconcile().
     */

    const title = String(plan.title || render.title || "").trim().slice(0, 120);

    return {
        ok: true,
        mode,
        tool: mode === "tool" ? String(plan.tool).trim() : null,
        args: cleanArgs(plan.args),
        sql: mode === "sql" ? String(plan.sql).trim() : null,
        correctedQuestion: String(plan.corrected_question || "").trim(),
        render: { template, xKey, yKeys, title }
    };
};

/**
 * Second-stage render check, run once the columns are actually known.
 *
 * The planner guessed at column names from a schema; the query returned real
 * ones. Where they disagree the real ones win, and a chart that references a
 * column the result does not contain becomes a table rather than an empty
 * canvas with a legend.
 *
 * This is the part the old design had no equivalent of — it asked the model to
 * describe results it had only partly seen, instead of checking the results
 * against the plan.
 */
/*
 * A one-row, all-numeric result is a row of METRICS, not a series.
 *
 * "How big is the institute?" returns ONE row of eight independent counts.
 * deriveAxes read that the only way it could — the first numeric column
 * becomes the category, the next becomes the measure — and produced a pie
 * with a single slice labelled "2004" (the value of total_students) whose
 * size was 1732 (the value of active_students). A chart of nothing, drawn
 * confidently.
 *
 * The shape is not wrong, it is transposed. Eight columns across one row are
 * eight (name, value) pairs, and once read that way every comparison template
 * works and the labels are the metric names a person actually asked about.
 *
 * The pivot is flagged rather than performed here: the TABLE must keep the
 * wide row, because that is what the database returned and what the CSV must
 * contain. Only the chart sees the transposed form.
 */
const PIVOT_X = "metric";
const PIVOT_Y = "value";

/* Templates that mean something for a set of independent totals. */
const PIVOT_TEMPLATES = new Set(["bar", "line", "area", "table"]);

const isMetricRow = (columns, rows) => {

    if (rows.length !== 1 || columns.length < 2) return false;

    const row = rows[0];
    let numeric = 0;

    for (const column of columns) {
        const value = row[column];

        if (value === null || value === undefined || value === "") continue;

        if (typeof value === "number") { numeric++; continue; }

        if (typeof value === "string" && Number.isFinite(Number(value.trim()))) {
            numeric++;
            continue;
        }

        // One text column and this is a labelled record, not a metric row.
        return false;
    }

    return numeric >= 2;
};

const reconcile = (render, columns, rowCount, rows = []) => {

    /*
     * Checked before the table short-circuit below, because the flag has to
     * travel even when the planner chose a table — the browser's chart
     * switcher can still flip that result to a bar, and it needs to know the
     * rows must be transposed first.
     */
    if (isMetricRow(columns, rows)) {

        const template = PIVOT_TEMPLATES.has(render.template)
            ? render.template
            : "bar";

        return {
            ...render,
            xKey: PIVOT_X,
            yKeys: [PIVOT_Y],
            pivot: true,
            template,
            /*
             * A pie of these figures would be a lie about them: active
             * students are a SUBSET of total students, so the slices overlap
             * and sum to nothing. Said out loud rather than silently redrawn.
             */
            degraded: template === render.template
                ? render.degraded
                : "metric_row"
        };
    }

    if (render.template === "table") return render;

    const present = new Set(columns);

    let xKey = present.has(render.xKey) ? render.xKey : "";
    let yKeys = render.yKeys.filter((k) => present.has(k));

    /*
     * The planner guessed column names from the schema, but a curated tool
     * returns whatever names ITS query aliases them to, and the two disagree
     * often. Asked for students per programme, the planner predicted
     * program_name/student_count while the tool actually returns
     * programme/students — a chart that would have silently become a table.
     *
     * Rather than annotate thirty tools with their output columns and keep
     * that in step forever, the axes are derived from the result itself. The
     * planner picks the template, because that is a judgement about intent.
     * The columns are a fact about the data, so they are measured here.
     */
    if (!xKey || !yKeys.length) {
        const derived = deriveAxes(columns, rows);
        xKey = xKey || derived.xKey;

        if (!yKeys.length) {
            /*
             * Order the derived measures by how closely their names resemble
             * what the planner asked for, rather than taking whichever column
             * happens to come first.
             *
             * Asked for attendance percentage by programme, the planner named
             * `attendance_percentage`; the tool returns `students` and
             * `avg_attendance`. Taking the first measure drew a pie of student
             * counts under a title about attendance — the right shape showing
             * the wrong number, which is worse than no chart at all.
             */
            yKeys = rankByAffinity(derived.yKeys, render.yKeys);
        }
    }

    if (!xKey || !yKeys.length) {
        /*
         * The resolved keys are returned, not the planner's originals. Echoing
         * back column names that are not in the result made the response look
         * like a chart had been configured when nothing had matched.
         */
        return {
            ...render,
            xKey: "",
            yKeys: [],
            template: "table",
            degraded: "no_plottable_columns"
        };
    }

    /*
     * Too many points to read. An honest table beats a smear of 4,000 bars,
     * and every row is still on screen.
     */
    if (rowCount > config.maxChartPoints) {
        return {
            ...render, xKey, yKeys,
            template: "table",
            degraded: "too_many_points"
        };
    }

    if (render.template === "pie") {

        if (rowCount > 12) {
            return { ...render, xKey, yKeys, template: "bar", degraded: "too_many_slices" };
        }

        /*
         * A pie shows one series: each slice is a share of a single total.
         * Derived axes can return several numeric columns, and rendering two
         * of them as one ring would draw a chart whose slices sum to nothing
         * meaningful. The first measure is kept and the rest dropped.
         */
        return { ...render, xKey, yKeys: yKeys.slice(0, 1) };
    }

    if (render.template === "stacked_bar" && yKeys.length < 2) {
        return { ...render, xKey, yKeys, template: "bar" };
    }

    return { ...render, xKey, yKeys };
};

/*
 * Sorts actual column names by word overlap with the names the planner wanted.
 *
 * Word-level rather than character-level, because the useful signal is a
 * shared term: `attendance_percentage` and `avg_attendance` share
 * "attendance", which is the whole reason they refer to the same measure.
 * Columns matching nothing keep their original relative order behind those
 * that do, so the result is always a full list and never empty.
 */
const rankByAffinity = (candidates, wanted) => {

    if (!wanted?.length || candidates.length < 2) return candidates;

    const wantedWords = new Set(
        wanted.flatMap((w) => String(w).toLowerCase().split(/[^a-z0-9]+/))
            .filter((w) => w.length > 2)
    );

    if (!wantedWords.size) return candidates;

    const score = (column) =>
        String(column).toLowerCase().split(/[^a-z0-9]+/)
            .filter((w) => wantedWords.has(w))
            .length;

    return candidates
        .map((column, index) => ({ column, index, score: score(column) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((entry) => entry.column);
};

/*
 * Picks a category column and numeric columns by inspecting real values.
 *
 * Types are read from the data rather than from column names, because a
 * MySQL DECIMAL arrives as a string through this driver and a name like
 * `total_payable` says nothing reliable about what came back. A sample of the
 * first rows is enough — a SQL result is column-homogeneous by construction.
 */
const deriveAxes = (columns, rows) => {

    if (!columns.length || !rows.length) return { xKey: "", yKeys: [] };

    const sample = rows.slice(0, 20);

    const isNumeric = (col) => {
        let seen = 0;

        for (const row of sample) {
            const v = row[col];
            if (v === null || v === undefined || v === "") continue;
            if (typeof v === "number") { seen++; continue; }
            if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
                seen++;
                continue;
            }
            return false;
        }

        return seen > 0;
    };

    const numeric = columns.filter(isNumeric);
    const categorical = columns.filter((c) => !numeric.includes(c));

    /*
     * An id column is numeric but is a label, not a measure. Plotting
     * student_id as a bar height is meaningless, so ids are pushed out of the
     * y candidates — while staying available as an x axis for a scatter.
     */
    const isId = (c) => /(^|_)id$/i.test(c) || /number$/i.test(c);

    const measures = numeric.filter((c) => !isId(c));

    /*
     * Prefer a text column for the category axis. Falling back to a numeric
     * one covers a scatter, where both axes are genuinely numbers.
     */
    const xKey = categorical[0] || numeric.find((c) => !measures.includes(c)) || numeric[0] || "";

    const yKeys = (measures.length ? measures : numeric)
        .filter((c) => c !== xKey)
        .slice(0, 6);

    return { xKey, yKeys };
};

/**
 * Which templates this result could be drawn as, and why the others cannot.
 *
 * Computed server-side even though the switcher is a browser control, because
 * these are the same rules reconcile() applies. Re-implementing them in React
 * would give two answers to "can this be a pie chart", and the copy is the one
 * that drifts.
 *
 * Every reason is a fact about the data, so the UI can disable a button and
 * say why rather than offering a choice that silently draws nothing.
 *
 * @returns {Object} { axes, options: { [template]: true | "reason" } }
 */
const describeOptions = (columns, rows, rowCount) => {

    /*
     * The switcher's rules for a transposed metric row. Stated here as well as
     * in reconcile() because these two must never disagree — a button the
     * switcher enables and reconcile then refuses to draw is a click that
     * appears to do nothing.
     */
    if (isMetricRow(columns, rows)) {
        return {
            axes: { xKey: PIVOT_X, yKeys: [PIVOT_Y], pivot: true },
            options: {
                table: true,
                bar: true,
                line: true,
                area: true,
                pie: "These are separate totals, not parts of one whole",
                stacked_bar: "Needs two or more measures per category",
                scatter: "Needs a numeric x axis (metric is a name)"
            }
        };
    }

    const axes = deriveAxes(columns, rows);
    const options = { table: true };

    const categories = axes.xKey
        ? new Set(rows.map((r) => r[axes.xKey])).size
        : 0;

    const numericX = axes.xKey
        ? rows.slice(0, 20).every((r) => {
            const v = r[axes.xKey];
            return v === null || v === undefined || v === ""
                || Number.isFinite(Number(v));
        })
        : false;

    const noPlot = !axes.xKey || !axes.yKeys.length
        ? "No numeric column to plot"
        : null;

    const tooMany = rowCount > config.maxChartPoints
        ? `Too many rows to chart (${rowCount})`
        : null;

    for (const template of ["bar", "line", "area", "pie", "stacked_bar", "scatter"]) {

        if (noPlot) { options[template] = noPlot; continue; }
        if (tooMany) { options[template] = tooMany; continue; }

        if (template === "pie" && categories > 12) {
            options[template] = `Too many categories for a pie (${categories})`;
            continue;
        }

        if (template === "stacked_bar" && axes.yKeys.length < 2) {
            options[template] = "Needs two or more numeric columns";
            continue;
        }

        if (template === "scatter" && !numericX) {
            options[template] = `Needs a numeric x axis (${axes.xKey} is text)`;
            continue;
        }

        options[template] = true;
    }

    return { axes, options };
};

module.exports = { validate, reconcile, describeOptions, isMetricRow, PIVOT_X, PIVOT_Y };
