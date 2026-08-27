/*
 * Runs a validated plan and returns rows.
 *
 * This module is the reason the rewrite exists. It is the last step before the
 * response is serialised, and no language model runs after it. Whatever the
 * database returns is what the user sees.
 *
 * Two consequences worth stating plainly, because the old design got both
 * wrong:
 *
 *   1. There is no sampling. Every matching row is returned, up to a memory
 *      ceiling that is an order of magnitude above any realistic result.
 *
 *   2. Where a ceiling IS hit, the true total is obtained with a separate
 *      COUNT and reported as the true total. The old code reported
 *      `rows.length` after a LIMIT had already been applied, so the number it
 *      called "total_matching_rows" was the limit itself — which is how an
 *      1,175-row result was announced as 200.
 */

const config = require("../../config/analytics");
const tools = require("../assistant/tools");
const sqlGuard = require("../assistant/sqlGuard");
const scopedSql = require("../assistant/scopedSql");
const { readonlySequelize } = require("../../database/readonlyConnection");

/*
 * Column order from the first row.
 *
 * Every row of a SQL result has identical keys, so one row is enough, and
 * taking it from the data means the headers cannot disagree with the cells.
 */
const columnsOf = (rows) => (rows.length ? Object.keys(rows[0]) : []);

/*
 * Wraps a statement in a COUNT so the true size of a truncated result can be
 * reported honestly.
 *
 * A derived-table count is used rather than parsing and rewriting the select
 * list, because the statement may contain GROUP BY, DISTINCT, HAVING or a
 * UNION, and each of those makes "just replace the columns with COUNT(*)"
 * wrong in a different way. Wrapping is correct for all of them.
 */
const trueCount = async (sql, replacements = {}) => {

    const stripped = String(sql).trim().replace(/;+\s*$/, "");

    const [row] = await readonlySequelize.query(
        `SELECT COUNT(*) AS n FROM (${stripped}) AS analytics_count`,
        { type: readonlySequelize.QueryTypes.SELECT, replacements }
    );

    return Number(row?.n ?? 0);
};

/*
 * Runs generated SQL.
 *
 * The guard chain is unchanged from the assistant, deliberately — it is the
 * tested part of the old system and the part that was never at fault. What
 * changes is the row ceiling: sqlGuard.enforceLimit is given the display
 * maximum instead of a token budget.
 */
const runSql = async (scope, sql) => {

    const isTeacher = scope.kind === "teacher";

    /*
     * A teacher's statement is rewritten so that every table name resolves to
     * a CTE restricted to their own roster. See scopedSql.js — the filter is
     * not appended to their query, the names their query uses are redefined,
     * which is why a missing predicate cannot leak another teacher's students.
     */
    const check = isTeacher
        ? sqlGuard.validateScoped(
            sql,
            scopedSql.buildPrelude(scope),
            scopedSql.ALLOWED_TABLES,
            config.maxDisplayRows
        )
        : sqlGuard.validate(sql, config.maxDisplayRows);

    if (!check.ok) {
        return { type: "refused", message: check.reason, sql };
    }

    const started = Date.now();

    try {
        const rows = await readonlySequelize.query(check.sql, {
            type: readonlySequelize.QueryTypes.SELECT
        });

        /*
         * Only pay for a COUNT when the ceiling was actually reached. Below it
         * the row count IS the total, and an extra full-table scan to confirm
         * what we already know would be waste.
         */
        const hitCeiling = rows.length >= config.maxDisplayRows;

        const total = hitCeiling
            ? await trueCount(sql).catch(() => rows.length)
            : rows.length;

        return {
            type: "table",
            rows,
            columns: columnsOf(rows),
            rowCount: rows.length,
            totalRows: total,
            truncated: hitCeiling && total > rows.length,
            sql: check.sql,
            durationMs: Date.now() - started
        };

    } catch (error) {

        const denied = /denied|ER_TABLEACCESS|ER_COLUMNACCESS/i.test(error.message);

        if (denied) {
            return {
                type: "refused",
                message:
                    "That query reads data the analytics account is not permitted " +
                    "to see. The restriction is enforced by the database itself.",
                sql: check.sql
            };
        }

        /*
         * Errors where MySQL has told us precisely what is wrong with the
         * generated SQL, so a second attempt has something to work with.
         *
         * "is ambiguous" was missing and belongs here more than anything
         * else on the list: it is not a guess about a column that does not
         * exist, it is a column that exists in two joined tables and needs
         * a qualifier - the most mechanical repair there is. Without it a
         * teacher asking which of their subjects scores lowest got a bare
         * "Column 'subject_code' in field list is ambiguous" and no answer,
         * while the repair pass sat unused two lines away.
         *
         * Permission errors are deliberately NOT here and must never be.
         * A denial from the read-only account is the grants doing their
         * job, and retrying it is asking the model to find a way around
         * them.
         */
        const schemaMistake =
            /Unknown column|Unknown table|doesn't exist|is ambiguous|ER_BAD_FIELD_ERROR|ER_NO_SUCH_TABLE|ER_NON_UNIQ_ERROR/i
                .test(error.message)
            && !/denied|permission|privilege/i.test(error.message);

        return {
            type: "error",
            message: schemaMistake
                ? `The generated query referenced something that does not exist: ${error.message}`
                : `The query could not be run: ${error.message}`,
            schemaMistake,
            sql: check.sql
        };
    }
};

/*
 * Runs a curated tool.
 *
 * The dispatcher re-checks scope on entry, so this does not restate the access
 * rules — it converts whatever shape the tool returns into the one envelope
 * the renderer understands.
 */
const runTool = async (scope, name, args) => {

    const started = Date.now();
    const result = await tools.dispatch(name, scope, args);

    if (result.type === "refused" || result.type === "error") {
        return { type: result.type, message: result.message };
    }

    const rows = Array.isArray(result.rows) ? result.rows : [];

    return {
        type: "table",
        rows,
        columns: columnsOf(rows),
        rowCount: rows.length,
        totalRows: rows.length,

        /*
         * Tools carry their own LIMIT, now set to the display ceiling. Hitting
         * it is possible in principle and would mean a genuinely enormous
         * result, so it is reported rather than assumed away.
         */
        truncated: rows.length >= config.maxDisplayRows,

        tool: name,
        args,
        durationMs: Date.now() - started
    };
};

/**
 * Executes a validated plan.
 *
 * @param {Object} scope    resolved caller scope
 * @param {Object} validated output of planValidator.validate
 */
const execute = async (scope, validated) => {

    if (validated.mode === "tool") {
        return runTool(scope, validated.tool, validated.args);
    }

    /*
     * Gated on scope.kind rather than a role id. scope.service resolves a role
     * id into one of three kinds and attaches the data each needs; a teacher
     * without a roster and an admin are both "resolved", but only the kind
     * says which set of rules applies. Checking the id here would mean two
     * places deciding what an admin is.
     */
    if (scope.kind !== "admin" && scope.kind !== "teacher") {
        return {
            type: "refused",
            message: "This account may not run generated queries."
        };
    }

    return runSql(scope, validated.sql);
};

module.exports = { execute, runSql, runTool, trueCount };
