/*
 * HTTP surface for AI Analytics.
 *
 * One question in, one result set out. There is no conversation here and no
 * transcript, because a query result is not a dialogue — asking the same
 * question twice should run the same query twice, not append to a context that
 * grows until it costs more than the answer.
 *
 * Dropping history is also the single largest saving in the rewrite. The old
 * assistant resent up to 24 prior messages on every round of every turn,
 * roughly 4,800 tokens, which dwarfed the question itself.
 */

const config = require("../config/analytics");
const scopeService = require("../services/assistant/scope.service");
const planner = require("../services/analytics/planner");
const planValidator = require("../services/analytics/planValidator");
const executor = require("../services/analytics/executor");
const catalogue = require("../services/analytics/catalogue");
const planCache = require("../services/analytics/planCache");
const auditLog = require("../services/assistant/auditLog");

/*
 * The statement, as much of it as this caller should see.
 *
 * Returning the SQL is a real feature: an administrator reading a figure off a
 * dashboard is entitled to know which rows produced it, and "trust me" is the
 * posture this whole service exists to avoid. But it was being returned to
 * everyone, and for a teacher it carried two things it should not:
 *
 *   - the scoped prelude, which spells out the internal view names and the
 *     column list of every table in the catalogue, and
 *   - their entire roster as a literal list of student ids.
 *
 * Neither is data the teacher could not reach another way, which is why this
 * is a hardening rather than a breach. But a roster of primary keys is an
 * invitation to enumerate, and schema is the first thing anyone probing the
 * service wants. So: administrators see the statement, everyone else sees the
 * SELECT they actually asked for with the machinery stripped off.
 */
const visibleSql = (scope, sql) => {

    const text = String(sql || "");

    if (scope.kind === "admin") return text;
    if (!/^\s*WITH\s/i.test(text)) return text;

    /*
     * Walk the prelude and return what follows it.
     *
     * The CTE list is a run of `name AS ( ... )` at depth zero, so the end of
     * the prelude is the last point where the nesting depth falls back to
     * zero. Everything after that is the SELECT the planner wrote, which is
     * the only part the caller asked about.
     *
     * Scanning rather than pattern-matching because the CTEs contain SELECTs
     * of their own - a regex for the last SELECT finds one of those.
     */
    let depth = 0;
    let inString = false;
    let quote = "";
    let preludeEnd = -1;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (ch === quote) inString = false;
            continue;
        }

        if (ch === "'" || ch === '"') { inString = true; quote = ch; continue; }

        if (ch === "(") depth += 1;
        else if (ch === ")") {
            depth -= 1;

            /*
             * A depth-zero close ends one CTE. If a comma follows,
             * another CTE begins and the prelude continues; if anything
             * else does, that was the last one.
             *
             * Taking the last depth-zero close in the whole statement
             * instead runs straight past the prelude, because the
             * caller's own SELECT closes plenty of parentheses of its
             * own - AVG(percentage) alone is enough to lose the cut.
             */
            if (depth === 0) {
                const next = text.slice(i + 1).match(/^\s*(.)/);
                if (!next || next[1] !== ",") {
                    preludeEnd = i + 1;
                    break;
                }
            }
        }
    }

    const rest = preludeEnd === -1 ? "" : text.slice(preludeEnd).trim();

    return /^SELECT\b/i.test(rest)
        ? `${rest}\n\n-- runs against your own classes only`
        : "-- runs against your own classes only";
};

const requireScope = async (req, res) => {

    const scope = await scopeService.resolveFor(req.user);

    if (!scope.ok) {
        res.status(403).json({ success: false, message: scope.reason });
        return null;
    }

    return scope;
};

/**
 * POST /api/analytics/ask
 * { question }
 *
 * Response shape is fixed regardless of what was asked, so the canvas has one
 * thing to render rather than a branch per question type.
 */
const ask = async (req, res) => {

    if (!config.enabled) {
        return res.status(503).json({
            success: false,
            message: "Analytics is currently disabled."
        });
    }

    const question = String(req.body?.question || "").trim();

    if (!question) {
        return res.status(400).json({
            success: false,
            message: "A question is required."
        });
    }

    if (question.length > 500) {
        return res.status(400).json({
            success: false,
            message: "That question is too long. Keep it under 500 characters."
        });
    }

    const scope = await requireScope(req, res);
    if (!scope) return;

    const started = Date.now();

    try {

        // ---- 1. plan (the only model call) ---------------------------------

        /*
         * A plan this caller has already had for these exact words.
         *
         * Nothing about the plan depends on when it was made, so a hit skips
         * the model entirely. The rows are still fetched below, so the numbers
         * are current — only the decision about WHICH query to run is reused.
         *
         * This matters most for the pinned dashboard, where six saved cards
         * re-plan themselves on every page load and between them could spend
         * the whole per-minute token budget re-deriving plans that had not
         * changed since they were pinned.
         */
        const cached = planCache.get(scope, question);

        const { plan: raw, usage: planUsage } = cached
            ? { plan: cached, usage: null }
            : await planner.plan(scope, question);

        // Mutable, because a repair attempt adds its own cost to the total.
        const usage = {
            prompt_tokens: planUsage?.prompt_tokens || 0,
            completion_tokens: planUsage?.completion_tokens || 0
        };

        const { names } = await catalogue.forScope(scope, question);
        let validated = planValidator.validate(raw, scope, names);

        if (!validated.ok) {

            /*
             * A plan naming a tool outside the caller's catalogue is recorded
             * even though it never ran. Nothing was offered to the model that
             * it was not entitled to, so this should be impossible in normal
             * use; if it starts appearing, that is worth being able to see.
             */
            if (validated.outOfScope) {
                await auditLog.record({
                    scope,
                    toolName: String(raw?.tool || "unknown"),
                    args: raw?.args || {},
                    result: { type: "refused", message: validated.reason },
                    durationMs: Date.now() - started
                }).catch(() => {});
            }

            return res.status(validated.refused ? 200 : 422).json({
                success: true,
                result: {
                    question,
                    corrected_question: String(raw?.corrected_question || "").trim() || question,
                    status: "refused",
                    message: validated.reason,
                    render: { template: "none" },
                    rows: [],
                    columns: []
                }
            });
        }

        // ---- 2. execute (no model involved) --------------------------------

        let active = validated;
        let outcome = await executor.execute(scope, active);
        let repaired = false;

        /*
         * One corrective attempt when the database rejects the SQL for naming
         * something that does not exist.
         *
         * Only for schema mistakes, and only for generated SQL. A refusal is
         * the grants working and must never be retried; a curated tool cannot
         * have this fault because its SQL is written by hand.
         *
         * This is worth a second model call because the diagnosis is exact —
         * MySQL names the column — and the usual cause is a join the planner
         * left out. A live request for section attendance failed outright on
         * "Unknown column 's.full_name'", which is recoverable information the
         * first design simply discarded.
         */
        if (outcome.type === "error"
            && outcome.schemaMistake
            && active.mode === "sql") {

            try {
                const { plan: fixed, usage: repairUsage } = await planner.repair(
                    scope, question, outcome.sql, outcome.message
                );

                const revalidated = planValidator.validate(fixed, scope, names);

                if (revalidated.ok && revalidated.mode === "sql") {
                    const second = await executor.execute(scope, revalidated);

                    /*
                     * The retry is kept only if it actually worked. A second
                     * failure leaves the original error in place, so the user
                     * is told what first went wrong rather than what the
                     * repair then got wrong instead.
                     */
                    if (second.type === "table") {
                        active = revalidated;
                        outcome = second;
                        repaired = true;

                        usage.prompt_tokens += repairUsage?.prompt_tokens || 0;
                        usage.completion_tokens += repairUsage?.completion_tokens || 0;
                    }
                }
            } catch {
                // A failed repair is not a new failure; the original stands.
            }
        }

        validated = active;

        await auditLog.record({
            scope,
            toolName: validated.mode === "tool" ? validated.tool : "generated_sql",
            args: validated.mode === "tool" ? validated.args : { sql: outcome.sql },
            result: outcome,
            durationMs: Date.now() - started
        }).catch(() => {});

        if (outcome.type === "refused" || outcome.type === "error") {
            return res.status(outcome.type === "refused" ? 200 : 422).json({
                success: true,
                result: {
                    question,
                    corrected_question: validated.correctedQuestion || question,
                    status: outcome.type,
                    message: outcome.message,
                    render: { template: "none" },
                    rows: [],
                    columns: [],
                    sql: outcome.sql || null
                }
            });
        }

        // ---- 3. reconcile the chart against the real columns ---------------

        /*
         * The rows are passed so reconcile can derive axes from real values
         * when the planner's guessed column names do not match what the query
         * returned. Without them every mismatch silently became a table.
         */
        /*
         * Only a plan that survived validation AND returned rows is worth
         * replaying. Caching one that errored would make a single bad plan
         * permanent for six hours, and the repair path exists precisely
         * because the first attempt is sometimes wrong.
         */
        if (!cached) {
            /*
             * The plan that WORKED, which after a repair is not the one the
             * planner first produced. Storing the original would replay a
             * statement already known to fail and pay for the repair again on
             * every hit — a cache that reliably reproduces a bug.
             */
            planCache.set(scope, question, repaired
                ? {
                    corrected_question: validated.correctedQuestion,
                    mode: validated.mode,
                    tool: validated.tool,
                    args: validated.args,
                    sql: validated.sql,
                    render: validated.render
                }
                : raw);
        }

        const render = planValidator.reconcile(
            validated.render,
            outcome.columns,
            outcome.rowCount,
            outcome.rows
        );

        /*
         * Everything below is measured, not described. No sentence in this
         * response was written by a model, which is the whole point: the count
         * is a count, and if the caller sees "1,175 rows" then 1,175 rows are
         * attached.
         */
        return res.json({
            success: true,
            result: {
                question,
                corrected_question: validated.correctedQuestion || question,
                status: "ok",

                render,

                /*
                 * The switcher's menu. `axes` is the best-effort x/y derived
                 * from the real data, so a result the planner chose to render
                 * as a table can still be flipped to a bar chart in the
                 * browser without another request.
                 *
                 * Sent even when every option is unavailable — the UI shows
                 * the reasons, which is more useful than an absent control.
                 */
                ...planValidator.describeOptions(
                    outcome.columns,
                    outcome.rows,
                    outcome.rowCount
                ),

                columns: outcome.columns,
                rows: outcome.rows,
                row_count: outcome.rowCount,
                total_rows: outcome.totalRows,
                truncated: Boolean(outcome.truncated),

                source: validated.mode === "tool"
                    ? { kind: "tool", name: validated.tool, args: validated.args }
                    : { kind: "sql", sql: visibleSql(scope, outcome.sql) },

                timing_ms: Date.now() - started,
                planner_tokens: usage.prompt_tokens + usage.completion_tokens,

                /*
                 * Stated rather than inferred from a zero token count, so the
                 * UI can say "plan reused" instead of leaving a reader to
                 * wonder why an identical question cost nothing.
                 */
                planner_cached: Boolean(cached),

                /*
                 * Surfaced rather than hidden. If the first query was wrong
                 * often enough to matter, that is visible in the logs and in
                 * the UI instead of being smoothed over.
                 */
                repaired
            }
        });

    } catch (error) {

        if (error.planFailure) {
            return res.status(422).json({
                success: false,
                message:
                    "That question could not be turned into a query. Try " +
                    "rephrasing it more concretely."
            });
        }

        console.error("[analytics] ask failed:", error);

        return res.status(500).json({
            success: false,
            message: "The analytics service could not complete that request."
        });
    }
};

/**
 * GET /api/analytics/capabilities
 *
 * Drives the suggestion chips on the canvas. Derived from the same
 * scope-filtered catalogue the planner sees, so a suggestion shown is always a
 * question that can actually be answered.
 */
const capabilities = async (req, res) => {

    const scope = await requireScope(req, res);
    if (!scope) return;

    const { tools } = await catalogue.forScope(scope);

    const names = tools
        .split("\n")
        .map((line) => line.split("(")[0].trim())
        .filter((n) => n && !n.startsWith("("));

    return res.json({
        success: true,
        capabilities: {
            scope: scope.kind,
            tool_count: names.length,
            tools: names,
            templates: config.templates,
            max_rows: config.maxDisplayRows,
            can_write_sql: scope.kind === "admin" || scope.kind === "teacher"
        }
    });
};

module.exports = { ask, capabilities };
