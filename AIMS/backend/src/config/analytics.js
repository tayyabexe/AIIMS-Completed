/*
 * Configuration for the AI Analytics route.
 *
 * This is a deliberately separate service from the chatbot, and the split is
 * architectural rather than cosmetic.
 *
 * The chatbot answers "how do I" from a document corpus. It may talk freely,
 * because the worst case is a badly worded explanation.
 *
 * Analytics answers "what is the number". Here a model that talks freely is a
 * liability: the previous single-service design fed query results back through
 * the model and asked it to summarise them, which produced a confident report
 * of "200 fee defaulters" when there were 1,175. The model was not at fault —
 * it was handed a truncated array and a system-written instruction telling it
 * that 200 was the true total.
 *
 * The rule this service is built around:
 *
 *     ROW DATA NEVER ENTERS THE MODEL.
 *
 * The model converts a question into a plan. The database answers the plan.
 * The rows travel to the browser without passing back through a language
 * model, so there is nothing to truncate, average, or editorialise. A count
 * shown on screen is a count the database returned.
 */

const { ROLES } = require("./roles");
const groq = require("./groq");

/*
 * Who may use analytics at all.
 *
 * Narrower than the chatbot on purpose. Analytics can express any question the
 * schema supports, and a role without a scope resolver has no safe answer to
 * "which rows are yours". Students are excluded: every figure a student is
 * entitled to already has a purpose-built screen, and a free-form query
 * channel over their own single record buys nothing but risk.
 */
const ANALYTICS_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.TEACHER];

/*
 * Roles that may reach the generated-SQL fallback rather than only the
 * curated tools. A teacher qualifies because scopedSql rewrites their table
 * names to their own roster before the statement runs; see scopedSql.js.
 */
const SQL_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.TEACHER];

const config = {

    roles: ANALYTICS_ROLES,
    sqlRoles: SQL_ROLES,

    /*
     * The row ceiling for a result that is going to the SCREEN.
     *
     * High, because this is a memory guard and nothing else. The old 200 was a
     * token-budget cap wearing a safety costume — it existed because the rows
     * were about to be pasted into a prompt. Nothing is pasted into a prompt
     * any more, so the only real question is how much JSON the browser can
     * hold, and 50,000 rows of a dozen short columns is a few megabytes.
     *
     * If a query exceeds this the response says so explicitly, with the true
     * total from a COUNT run separately. It is never silently trimmed.
     */
    maxDisplayRows: Number(process.env.ANALYTICS_MAX_ROWS || 50000),

    /*
     * Rows rendered into the DOM at once. The rest are held in memory and
     * paged through. Recharts and a plain table both get unusable long before
     * 50,000 nodes.
     */
    pageSize: 100,

    /*
     * Above this many points a chart stops being readable and the renderer
     * falls back to a table regardless of what the planner asked for.
     */
    maxChartPoints: 300,

    groq: {
        apiKeys: groq.apiKeys,

        /*
         * ANALYTICS_MODEL pins this service alone; without it both services
         * follow GROQ_MODEL, and without that the shared default. Splitting
         * the two later is an environment variable, not a code change.
         */
        model: groq.modelFor(process.env.ANALYTICS_MODEL),

        baseUrl: groq.baseUrl,

        /*
         * Zero. The planner emits JSON describing a query — there is no prose
         * for warmth to improve, and two identical questions should produce
         * the same plan.
         */
        temperature: 0,

        /*
         * A plan is a small object. This is not a budget for an answer,
         * because the model does not write the answer.
         */
        maxTokens: 1200,

        /*
         * See groq.client.js. A plan is a classification, and the default
         * reasoning pass was large enough to truncate the JSON it was meant
         * to be producing.
         */
        reasoningEffort: "low",

        timeoutMs: 30000,
        maxRetries: 3
    },

    /*
     * The six chart templates the frontend implements.
     *
     * The planner may name one of these and nothing else. It never writes
     * chart code, never picks colours, and never emits JSX — it chooses from a
     * closed set and names which columns feed the axes. A template that does
     * not exist is rejected during validation and degraded to "table", so a
     * hallucinated name costs a plainer rendering rather than a broken page.
     */
    templates: ["bar", "line", "area", "pie", "stacked_bar", "scatter", "table"],

    enabled: process.env.ANALYTICS_ENABLED !== "false"
};

module.exports = { ...config, ANALYTICS_ROLES, SQL_ROLES };
