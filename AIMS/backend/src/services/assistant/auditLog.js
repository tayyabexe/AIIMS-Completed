/*
 * Records every tool call the assistant makes.
 *
 * The question this exists to answer is "did the assistant ever return data it
 * should not have", and that cannot be reconstructed after the fact from the
 * chat transcript alone. The transcript shows what was said; this shows which
 * tool ran, what the model asked for, what scope the backend actually enforced,
 * and — for the admin SQL path — the exact statement executed.
 *
 * Writes go through the APPLICATION pool, not the read-only one. The assistant's
 * own account cannot write, which is the point of it, and cannot read these
 * tables either.
 *
 * A logging failure must never break a chat turn. Every write here is
 * best-effort and swallowed: losing an audit row is bad, but taking down a
 * user's conversation because the log table is briefly unavailable is worse,
 * and the alternative failure mode (the assistant refusing to answer whenever
 * logging is degraded) would be discovered at the worst possible moment.
 */

const { sequelize } = require("../../database/connection");
const { describe } = require("./scope.service");

/*
 * Arguments are stored as the model produced them, before scope was applied.
 * That is deliberate: a refused call where the model asked for student_id 9999
 * is exactly the row an investigation wants to find, and normalising it away
 * would erase the evidence.
 */
const record = async ({
    conversationId,
    scope,
    toolName,
    args,
    result,
    durationMs
}) => {

    try {

        const outcome =
            result?.type === "refused" ? "refused"
                : result?.type === "error" ? "error"
                    : "success";

        const rowCount = Array.isArray(result?.rows) ? result.rows.length : null;

        await sequelize.query(
            `INSERT INTO assistant_query_log
                (conversation_id, user_id, role_id, tool_name, tool_args,
                 resolved_scope, executed_sql, row_count, duration_ms,
                 outcome, error_message)
             VALUES
                (:conversationId, :userId, :roleId, :toolName, :toolArgs,
                 :resolvedScope, :executedSql, :rowCount, :durationMs,
                 :outcome, :errorMessage)`,
            {
                replacements: {
                    conversationId: conversationId || null,
                    userId: scope.userId,
                    roleId: scope.roleId,
                    toolName,
                    toolArgs: JSON.stringify(args ?? {}),
                    resolvedScope: JSON.stringify(describe(scope)),

                    // Only the SQL tool sets this. For templated tools the
                    // statement is fixed in the source, so recording it on
                    // every row would be noise rather than evidence.
                    executedSql: result?.executedSql || null,

                    rowCount,
                    durationMs: durationMs ?? null,
                    outcome,

                    // Truncated to the column width. A long MySQL error is
                    // diagnostic at its start.
                    errorMessage: outcome === "success"
                        ? null
                        : String(result?.message || "").slice(0, 500)
                }
            }
        );

    } catch (error) {
        console.error("[assistant] audit log write failed:", error.message);
    }
};

module.exports = { record };
