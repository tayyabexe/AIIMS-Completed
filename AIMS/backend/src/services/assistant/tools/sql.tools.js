/*
 * The admin-only text-to-SQL escape hatch.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The ~20 templated tools cover the questions people actually ask, but they
 * cover them by anticipating them. An admin analysing something nobody
 * predicted — "which sections have both low attendance and high fee arrears,
 * broken down by intake year" — has no tool, and adding one for every such
 * question is not a plan.
 *
 * So admins get a general channel. What makes that acceptable is that an
 * admin already has unrestricted read access to this data through the admin
 * portal: there is no scope predicate for the model to omit, because there is
 * no scope predicate. The generated SQL cannot reach anything its author could
 * not already open in another tab.
 *
 * WHAT CONSTRAINS IT
 * ------------------
 *   1. The `aims_ai_ro` account — SELECT only, and blind to password hashes,
 *      CNICs, salaries, payroll and the assistant's own transcripts. This is
 *      the control that actually holds.
 *   2. sqlGuard.validate() — shape checks and a forced LIMIT.
 *   3. A statement timeout, so a bad join cannot hold a connection.
 *   4. Every attempt logged with its SQL, successful or refused.
 *
 * The schema handed to the model is generated from what the read-only account
 * can genuinely see, so the model is never told about a column it would be
 * refused for selecting.
 */

const { readonlySequelize } = require("../../../database/readonlyConnection");
const config = require("../../../config/assistant");
const sqlGuard = require("../sqlGuard");
const scopedSql = require("../scopedSql");

/*
 * The schema digest, built once per process.
 *
 * Generated rather than hand-maintained: a static copy would drift from the
 * database the same way Live_DB_Schema_Reference.txt did, and a model told
 * about a column that no longer exists writes queries that fail.
 *
 * Note this reads information_schema through the backend, which is fine — it
 * is the *model* that is forbidden from querying it, so that an injected
 * prompt cannot enumerate the database before asking for something from it.
 */
/*
 * Columns whose NAME says one thing and whose CONTENTS say another.
 *
 * The digest already carries every column's SQL type, and that turned out not
 * to be enough. vw_exam_schedule_full.marks_published is
 * `SUM(m.status = 'Published')` - a count, in the hundreds - and the planner
 * read the name, wrote `WHERE marks_published = 0`, matched no rows, and
 * reported that nothing was unpublished. The true figure was 2,356.
 *
 * Note what did NOT fail there. The database was asked a question and its
 * answer was reported faithfully; the guarantee this service is built on held
 * exactly as designed. It was the wrong question, and no amount of protecting
 * the number from the model protects the reader from that.
 *
 * The durable fix is to rename the column, which is a migration against a view
 * three other callers read and a decision for whoever owns the schema. Until
 * then the meaning travels beside the type, where the planner reads it at the
 * moment it picks the column, rather than as a rule further up the prompt that
 * it has to remember to apply.
 *
 * Keep this list SHORT. It exists for columns that actively mislead, not as a
 * place to describe the schema - a data dictionary in the prompt is a cost on
 * every question and drifts the moment the database changes.
 */
const COLUMN_NOTES = {
    "vw_exam_schedule_full.marks_published":
        "COUNT of published marks for this exam, NOT a 0/1 flag, and NULL "
        + "(never 0) for an exam with no marks at all - so '= 0' matches "
        + "nothing and the no-marks case needs IS NULL or COALESCE. To "
        + "count marks by workflow state use marks.status ('Verified' = "
        + "not yet published, 'Published' = released)",

    "vw_exam_schedule_full.marks_entered":
        "COUNT of marks entered for this exam, NOT a flag"
};

let schemaCache = null;

const buildSchemaContext = async () => {

    if (schemaCache) return schemaCache;

    const columns = await readonlySequelize.query(
        `SELECT c.table_name  AS tableName,
                c.column_name AS columnName,
                c.data_type   AS dataType,
                t.table_type  AS tableType
           FROM information_schema.columns c
           JOIN information_schema.tables  t
             ON t.table_schema = c.table_schema
            AND t.table_name   = c.table_name
          WHERE c.table_schema = DATABASE()
          ORDER BY t.table_type DESC, c.table_name, c.ordinal_position`,
        { type: readonlySequelize.QueryTypes.SELECT }
    );

    const grouped = new Map();

    for (const row of columns) {
        const key = row.tableName;
        if (!grouped.has(key)) {
            grouped.set(key, { type: row.tableType, cols: [] });
        }
        const note = COLUMN_NOTES[`${key}.${row.columnName}`];

        grouped.get(key).cols.push(
            `${row.columnName} ${row.dataType}${note ? ` /* ${note} */` : ""}`
        );
    }

    const views = [];
    const tables = [];

    for (const [name, { type, cols }] of grouped) {
        const line = `${name}(${cols.join(", ")})`;
        if (type === "VIEW") views.push(line);
        else tables.push(line);
    }

    schemaCache = [
        "VIEWS - prefer these, they already apply the correct filters:",
        ...views.map((v) => `  ${v}`),
        "",
        "BASE TABLES:",
        ...tables.map((t) => `  ${t}`)
    ].join("\n");

    return schemaCache;
};

const tools = {

    execute_readonly_query: {
        description:
            "Run a read-only SQL SELECT against the AIMS database. Use ONLY " +
            "when no other tool can answer the question - the purpose-built " +
            "tools are more reliable. Call describe_database_schema first if " +
            "unsure of the column names. Always select named columns rather " +
            "than *, and always include a LIMIT. " +
            "For teachers the queryable names are already restricted to the " +
            "students and subjects they teach, so no extra filtering is needed.",
        roles: ["admin", "teacher"],
        parameters: {
            type: "object",
            properties: {
                sql: {
                    type: "string",
                    description:
                        "A single SELECT statement. No semicolons, no DDL, no DML."
                },
                purpose: {
                    type: "string",
                    description:
                        "One line stating what this query is meant to find out. " +
                        "Recorded in the audit log."
                }
            },
            required: ["sql", "purpose"]
        },

        run: async (scope, args) => {

            /*
             * A teacher's statement is validated against an allowlist and then
             * prefixed with CTEs that redefine every one of those names in
             * terms of their own roster. The scope is therefore applied by
             * changing what the table names mean, not by injecting a WHERE
             * clause the model could omit from a subquery. See scopedSql.js.
             */
            const check = scope.kind === "teacher"
                ? sqlGuard.validateScoped(
                    args?.sql,
                    scopedSql.buildPrelude(scope),
                    scopedSql.ALLOWED_TABLES
                )
                : sqlGuard.validate(args?.sql);

            if (!check.ok) {
                /*
                 * The refusal reason is returned to the model, not just logged.
                 * A model told "only SELECT is allowed" will usually rewrite
                 * the query correctly on the next round; one told nothing
                 * repeats the same mistake until the round limit stops it.
                 */
                return {
                    type: "refused",
                    message: check.reason,
                    executedSql: args?.sql || null
                };
            }

            const started = Date.now();

            try {

                /*
                 * MAX_EXECUTION_TIME is a MySQL optimiser hint that caps a
                 * SELECT server-side. A client-side timeout would abandon the
                 * result but leave the query running on a shared database;
                 * this actually stops it.
                 */
                //
                // The hint must attach to the FIRST SELECT keyword. A teacher's
                // statement begins with the scoped WITH prelude, so anchoring
                // at the start of the string would miss it and leave the query
                // untimed.
                const hinted = check.sql.replace(
                    /\bSELECT\b/i,
                    `SELECT /*+ MAX_EXECUTION_TIME(${config.sqlTimeoutMs}) */`
                );

                const rows = await readonlySequelize.query(hinted, {
                    type: readonlySequelize.QueryTypes.SELECT
                });

                return {
                    type: "table",
                    rows: rows.slice(0, config.maxSqlRows),

                    /*
                     * For a teacher this logs the full statement including the
                     * scoping prelude — that is the point. "Was this answer
                     * correctly scoped" has to be answerable from the audit row
                     * alone, and the prelude is where the scoping lives.
                     */
                    executedSql: check.sql,
                    durationMs: Date.now() - started
                };

            } catch (error) {

                /*
                 * A denied column or table surfaces here as a MySQL access
                 * error. It is reported as a refusal rather than an error,
                 * because that is what it is — the grants doing their job —
                 * and the model needs to understand it cannot retry its way
                 * around it.
                 */
                const denied = /denied|ER_TABLEACCESS|ER_COLUMNACCESS/i
                    .test(error.message);

                if (denied) {
                    return {
                        type: "refused",
                        message:
                            "That query touches data the assistant is not permitted " +
                            "to read. This restriction is enforced by the database " +
                            "and cannot be worked around.",
                        executedSql: check.sql,
                        durationMs: Date.now() - started
                    };
                }

                /*
                 * A wrong column or table name is the model's mistake, not a
                 * permission problem — and the two must never be conflated.
                 *
                 * This was reported live: an admin asked for the names of fee
                 * defaulters, the model guessed a column `student_name` that
                 * does not exist, and then told the user the information was
                 * "outside what your account can see". That is false and
                 * alarming — an administrator is entitled to that data, and
                 * the query failed only because of a typo.
                 *
                 * The message now says plainly what went wrong and what to do
                 * about it, so the model corrects itself instead of narrating
                 * a permission failure that never happened.
                 */
                const schemaMistake = /Unknown column|Unknown table|doesn't exist|ER_BAD_FIELD_ERROR|ER_NO_SUCH_TABLE/i
                    .test(error.message);

                if (schemaMistake) {
                    return {
                        type: "error",
                        message:
                            `SCHEMA MISTAKE, NOT A PERMISSION PROBLEM. ${error.message}. ` +
                            `You guessed a name that does not exist. This is NOT an ` +
                            `authorization failure and you must NOT tell the user the ` +
                            `data is outside their access. Call describe_database_schema ` +
                            `to get the real column names, then run the query again.`,
                        executedSql: check.sql,
                        durationMs: Date.now() - started
                    };
                }

                return {
                    type: "error",
                    message:
                        `The query failed for a technical reason, not a permission ` +
                        `one: ${error.message}. Do not describe this to the user as ` +
                        `an access restriction.`,
                    executedSql: check.sql,
                    durationMs: Date.now() - started
                };
            }
        }
    },

    describe_database_schema: {
        description:
            "List the tables and columns available to query, so a SQL query " +
            "can be written against real column names. Call this before " +
            "execute_readonly_query if unsure of the schema.",
        roles: ["admin", "teacher"],
        parameters: {
            type: "object",
            properties: {
                filter: {
                    type: "string",
                    description:
                        "Optional substring, e.g. 'fee' or 'attendance', to " +
                        "return only matching tables."
                }
            }
        },

        run: async (scope, args) => {

            /*
             * A teacher is shown the scoped names only — not the real schema.
             * Telling them `users` and `payroll` exist would be pointless,
             * since the allowlist refuses both, and the shape of the database
             * is itself information they have no need for.
             */
            if (scope.kind === "teacher") {
                return {
                    type: "answer",
                    rows: [{ schema: scopedSql.describeForTeacher() }]
                };
            }

            const schema = await buildSchemaContext();
            const filter = String(args?.filter || "").trim().toLowerCase();

            if (!filter) {
                return { type: "answer", rows: [{ schema }] };
            }

            const matching = schema
                .split("\n")
                .filter((line) => line.toLowerCase().includes(filter))
                .join("\n");

            return {
                type: "answer",
                rows: [{
                    schema: matching || `No tables or views match "${filter}".`
                }]
            };
        }
    }
};

module.exports = { tools, buildSchemaContext };
