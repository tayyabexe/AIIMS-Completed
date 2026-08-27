/*
 * Single source of truth for the AI assistant's configuration.
 *
 * Everything the assistant needs to be told rather than to work out is here,
 * so a limit can be changed without hunting through the orchestrator, and so
 * the set of roles it serves is stated once in a place that is obviously the
 * place to look.
 */

const { ROLES } = require("./roles");
const groq = require("./groq");

/*
 * The roles the assistant answers at all.
 *
 * Parent, HR, Accountant and Library are deliberately absent. Excluding them
 * here means the route rejects them with a 403 before a single token is spent
 * — the assistant is not asked to decline politely, it is never reached. Each
 * of those roles would need its own scope resolver and its own tools (a parent
 * scoped to their wards, an accountant to fee operations), and shipping them
 * without that work would mean either a chatbot that cannot answer anything
 * they ask or one that answers from the wrong scope.
 */
const ASSISTANT_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.TEACHER,
    ROLES.STUDENT
];

/*
 * Roles allowed to reach the text-to-SQL tool.
 *
 * Note this is narrower than "can use the assistant". A teacher asking a
 * question the tool layer does not cover gets told so; they do not get a
 * general SQL channel, because their scope is a filter that would have to be
 * injected into generated SQL correctly every single time. For an admin there
 * is no scope filter to get wrong — they are already entitled to the whole
 * dataset through the admin portal — so the only thing standing between the
 * generated statement and the data is the read-only account, which holds.
 */
const SQL_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN];

const config = {
    roles: ASSISTANT_ROLES,
    sqlRoles: SQL_ROLES,

    groq: {
        /*
         * One or more API keys.
         *
         * Groq's free tier caps tokens per day per key (100,000), and a single
         * key ran out during one afternoon of testing. Holding several and
         * moving between them multiplies the daily budget and, more usefully,
         * means one exhausted key does not take the assistant down — the
         * client marks it as cooling off and uses the next.
         *
         * GROQ_API_KEYS is a comma-separated list. GROQ_API_KEY is still read
         * so an existing single-key deployment keeps working.
         */
        apiKeys: groq.apiKeys,

        // Kept for the boot-time check; the client reads apiKeys.
        apiKey: process.env.GROQ_API_KEY,

        /*
         * This is the fallback groq.client.js uses when a caller does not name
         * a model — which today means only ping(), the health check. It read
         * "llama-3.3-70b-versatile" long after Groq withdrew it, so a health
         * check on a deployment without GROQ_MODEL reported the service down
         * when the service was fine.
         */
        model: groq.modelFor(),
        baseUrl: groq.baseUrl,

        // Low but not zero. Tool selection wants determinism; the prose that
        // wraps a result reads badly at 0.
        temperature: 0.2,

        maxTokens: 2048,

        // Groq is fast enough that a slow call means something is wrong.
        timeoutMs: 45000,

        /*
         * Three, because the retries are now real waits rather than token
         * gestures. Groq's free tier caps tokens per minute, and an admin
         * request carrying the full tool set is large enough to hit it; the
         * client honours the wait the provider states, so a retry has a
         * genuine chance of succeeding rather than burning the budget against
         * a window that has not moved.
         */
        maxRetries: 3
    },

    /*
     * How many times the model may call tools before it has to answer.
     *
     * A real question sometimes needs two rounds — resolve a subject by name,
     * then read its marks. Beyond that it is almost always a loop, and each
     * turn costs a full round trip plus the growing transcript, so the cap is
     * a cost control as much as a safety one.
     */
    maxToolRounds: 4,

    // Rows a tool returns. These reach the frontend in full and render as the
    // table or chart the user actually reads.
    maxRows: 200,

    /*
     * Rows the MODEL is shown, which is a much smaller number.
     *
     * The model's job is to write two or three sentences about the result —
     * the notable figure, the outlier, the trend. It does not need 200 rows to
     * do that, and every row costs tokens twice: once going in, and again on
     * the next round because the transcript carries it.
     *
     * That was the single largest consumer of the 12,000 tokens-per-minute
     * budget. A 58-row attendance result was pushing a single question past
     * 5,000 tokens, which is two questions a minute before the limiter bites.
     *
     * The user loses nothing: the full result set is already in the envelope,
     * and the model is told the true total plus how many it was shown, so it
     * says "58 students, showing the lowest 40" rather than implying it saw
     * everything.
     */
    maxRowsToModel: Number(process.env.ASSISTANT_MAX_ROWS_TO_MODEL || 40),

    // Rows a generated SELECT may return. Enforced as a hard LIMIT rewritten
    // into the statement, not as a request in the prompt.
    maxSqlRows: 500,

    // Server-side statement timeout for generated SQL. A cartesian join across
    // 60,000 attendance rows is a plausible model mistake, and it must not be
    // able to hold a connection open while it resolves.
    sqlTimeoutMs: 10000,

    // Turns of history replayed to the model. Older turns stay in the database
    // and remain visible to the user; they are just not resent.
    historyTurns: 12,

    conversation: {
        // Long enough to be a recognisable heading, short enough for a sidebar.
        titleLength: 60,
        maxMessageLength: 4000
    },

    rag: {
        qdrantUrl: process.env.QDRANT_URL || "http://127.0.0.1:6333",
        collection: process.env.QDRANT_COLLECTION || "aims_knowledge",
        embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
        embeddingDim: Number(process.env.EMBEDDING_DIM || 384),

        // Chunks retrieved per question, and the floor a chunk must clear to
        // be shown at all. Without the floor, a question the corpus does not
        // cover still returns its three least-irrelevant chunks, and the model
        // answers confidently from them.
        topK: 5,
        minScore: 0.35
    },

    /*
     * Per-user request limits.
     *
     * Not abuse prevention so much as budget protection: every question costs
     * tokens from a shared daily pool, so one person holding the send key down
     * spends everybody else's allowance. The limits are set well above normal
     * conversational use — nobody types twelve genuine questions a minute —
     * and are per account rather than per IP, since a campus shares addresses
     * and IP-based limits would throttle a whole computer lab as one user.
     */
    rateLimit: {
        perMinute: Number(process.env.ASSISTANT_RATE_PER_MINUTE || 8),
        perHour: Number(process.env.ASSISTANT_RATE_PER_HOUR || 60),
        perDay: Number(process.env.ASSISTANT_RATE_PER_DAY || 200),

        // Admins run heavier analytical questions and are few in number.
        adminMultiplier: 3
    },

    /*
     * Whether the assistant is reachable at all.
     *
     * Set false to take it down without redeploying — a missing GROQ_API_KEY
     * already disables it, but this makes turning it off a decision rather
     * than an accident.
     */
    enabled: process.env.ASSISTANT_ENABLED !== "false"
};

/*
 * Configuration problems that must surface at boot rather than as a confusing
 * 500 on the first question somebody asks.
 */
const validate = () => {
    const problems = [];

    if (!config.groq.apiKeys.length) {
        problems.push(
            "No Groq API key is configured (set GROQ_API_KEYS or GROQ_API_KEY) - " +
            "the assistant cannot answer anything"
        );
    }

    if (!process.env.AI_DB_USER || !process.env.AI_DB_PASSWORD) {
        problems.push(
            "AI_DB_USER / AI_DB_PASSWORD are not set - the assistant would have to " +
            "fall back to the application's write-capable database account, which " +
            "is exactly what the read-only account exists to prevent"
        );
    }

    return problems;
};

module.exports = { ...config, validate, ASSISTANT_ROLES, SQL_ROLES };
