/*
 * A cache of plans, keyed by who asked and what they asked.
 *
 * WHY THIS IS SAFE
 * ----------------
 * The planner runs at temperature 0 and is given no history, no timestamp and
 * no row data — its entire input is the system prompt, the catalogue, the
 * schema digest and the question. Two identical questions from the same kind
 * of caller therefore have identical input, and the model is being asked to
 * produce identical output. Caching that is not an approximation; it is
 * skipping a call whose answer is already known.
 *
 * What makes it worth doing is the pinned dashboard. Every saved card re-runs
 * its question on every load, and each of those was a full planner call —
 * roughly 4,600 prompt tokens against an 8,000 TPM ceiling, to re-derive a
 * plan that had not changed since the card was pinned. A dashboard with six
 * cards could exhaust the budget on its own.
 *
 * WHAT IS NOT CACHED
 * ------------------
 * The RESULT. Only the plan. The SQL is re-executed on every request, so the
 * numbers on screen are always current — a cached plan for "how many students
 * are enrolled" still counts the students today. Caching rows would be a
 * correctness bug of exactly the kind this service was rewritten to remove.
 *
 * The repair path is also not cached. A repair is a response to one specific
 * database error, and its input includes that error text.
 *
 * KEYING
 * ------
 * Admins share one namespace, because every admin gets the same catalogue and
 * the same schema. Teachers do not: the identity block names them, their
 * department and the size of their roster, so two teachers can legitimately
 * receive different plans for the same words. They are keyed per user.
 *
 * A teacher's cached plan is still safe to replay because it is SQL against
 * the scoped CTE names, and scopedSql rewrites those to the caller's own
 * roster at execution time — the ownership filter is applied after the cache,
 * never stored in it. The plan is also re-validated against the live scope on
 * every hit, in the controller, exactly as a fresh plan is.
 */

/*
 * Six hours. The thing that can invalidate a plan is a schema change, and
 * `invalidate()` below is called from the same place that drops the schema
 * digest, so the TTL is a backstop rather than the mechanism.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

/*
 * A ceiling on entries, evicted oldest-first. Plans are small objects and this
 * is a few hundred kilobytes at worst, but an unbounded map keyed on free text
 * is a memory leak with extra steps.
 */
const MAX_ENTRIES = 500;

const store = new Map();

/*
 * Normalises the question so that trivial differences share an entry.
 *
 * Case, surrounding whitespace, runs of spaces and trailing punctuation are
 * all noise — "How many students?" and "how many students" produce the same
 * plan. Nothing further is normalised: word order and phrasing genuinely can
 * change what is being asked, and a cache that guesses otherwise returns the
 * wrong answer confidently, which is the failure mode this whole service
 * exists to avoid.
 */
const normalise = (question) =>
    String(question || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[?!.\s]+$/, "")
        .trim();

const keyFor = (scope, question) => {

    const who = scope?.kind === "admin"
        ? "admin"
        : `${scope?.kind || "unknown"}:${scope?.userId || 0}`;

    return `${who}|${normalise(question)}`;
};

/**
 * A previously planned answer for this question, or null.
 *
 * Returns a deep copy. The caller mutates the plan during validation — args
 * are cleaned, a bad template is degraded to "table" — and handing out the
 * stored object would let one request's corrections leak into the next one's
 * starting point.
 */
const get = (scope, question) => {

    const key = keyFor(scope, question);
    const hit = store.get(key);

    if (!hit) return null;

    if (Date.now() - hit.at > TTL_MS) {
        store.delete(key);
        return null;
    }

    /*
     * Re-inserted so that recency, not insertion order, decides eviction. A
     * Map preserves insertion order, so delete-then-set moves it to the end.
     */
    store.delete(key);
    store.set(key, hit);

    return JSON.parse(JSON.stringify(hit.plan));
};

/**
 * Records a plan. Only ever called with a plan that validated and executed.
 */
const set = (scope, question, plan) => {

    if (!plan || typeof plan !== "object") return;

    const key = keyFor(scope, question);

    store.delete(key);
    store.set(key, { plan, at: Date.now() });

    while (store.size > MAX_ENTRIES) {
        store.delete(store.keys().next().value);
    }
};

/** Dropped alongside the schema digest, since a plan names its columns. */
const invalidate = () => store.clear();

const stats = () => ({ entries: store.size, ttlMs: TTL_MS });

module.exports = { get, set, invalidate, stats, normalise };
