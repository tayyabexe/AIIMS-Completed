/*
 * Response caching for GET routes, and invalidation for the writes that
 * contradict them.
 *
 * See utils/cache.js for what is cached and why. This file is only the
 * plumbing that attaches it to Express.
 *
 * TWO PIECES
 * ----------
 * `cached(...)`     wraps a GET handler: serve from the cache, or run the
 *                   handler and record what it produced.
 * `invalidates(...)` wraps a write route: after a successful response, drop
 *                   every cached entry carrying the named tags.
 *
 * Keeping invalidation in middleware rather than inside each controller is
 * deliberate. A controller that forgets to invalidate produces a stale read
 * that survives until the TTL — a bug that reproduces only intermittently and
 * looks like "the UI sometimes does not update". Declaring it beside the route
 * puts it where it is visible when the route is read.
 */

const cache = require("../utils/cache");

/*
 * WHAT GOES INTO A CACHE KEY, AND WHY IT MATTERS MORE THAN ANYTHING ELSE HERE
 * ---------------------------------------------------------------------------
 * A key that is too coarse serves one user's data to another. That is the
 * failure mode to design against, because it is silent, it is a privacy
 * breach, and it does not show up in testing with a single account.
 *
 * So scope is EXPLICIT per route and there is no default:
 *
 *   'global'  the response is identical for everyone. Only correct for
 *             reference data — the list of programmes does not depend on who
 *             asks. This is the only scope that shares an entry between users.
 *
 *   'role'    the response depends on the caller's role but not their
 *             identity, e.g. a summary an admin sees in full and a teacher
 *             sees narrowed.
 *
 *   'user'    the response is personal. Keyed by user id, so nothing is ever
 *             shared. The default for anything that is not obviously global.
 *
 * The query string is always part of the key: `?program_id=3` and
 * `?program_id=4` are different answers to the same route.
 */
const buildKey = (req, scope) => {
    const base = `${req.baseUrl}${req.path}`;

    // Query keys are sorted so ?a=1&b=2 and ?b=2&a=1 hit the same entry
    // instead of caching the same response twice.
    const query = new URLSearchParams(req.query);
    query.sort();
    const qs = query.toString();

    const suffix = qs ? `?${qs}` : "";

    if (scope === "global") return `g:${base}${suffix}`;

    if (scope === "role") {
        return `r${req.user ? req.user.role_id : "anon"}:${base}${suffix}`;
    }

    return `u${req.user ? req.user.user_id : "anon"}:${base}${suffix}`;
};

/**
 * Caches a GET route's JSON response.
 *
 * @param options {
 *   ttl,    milliseconds — use one of cache.TTL
 *   tags,   labels for invalidation, e.g. ['programs']
 *   scope,  'global' | 'role' | 'user'  (required — see buildKey)
 * }
 *
 * Placed AFTER authenticate and authorize in a route's middleware chain, never
 * before. Ahead of them it would serve a cached body to a caller who was never
 * authorised to see it — the cache would become an authentication bypass.
 */
const cached = ({ ttl, tags = [], scope }) => {

    if (!scope) {
        throw new Error("cached() requires an explicit scope: 'global', 'role' or 'user'");
    }

    return (req, res, next) => {

        // Only GET. A cached POST would return a stale result for a request
        // that was supposed to change something.
        if (req.method !== "GET") return next();

        const key = buildKey(req, scope);
        const hit = cache.get(key);

        if (hit !== undefined) {
            // Marked so the effect is visible in devtools and in logs. Without
            // it, "is the cache working" can only be answered by timing.
            res.setHeader("X-Cache", "HIT");
            return res.status(hit.status).json(hit.body);
        }

        res.setHeader("X-Cache", "MISS");

        /*
         * res.json is wrapped rather than res.send or res.end: the body is
         * still a plain object at this point, so it can be stored without
         * being re-parsed, and every JSON route in this codebase answers
         * through res.json.
         */
        const originalJson = res.json.bind(res);

        res.json = (body) => {

            /*
             * Only successful responses are cached. Caching a 500 would pin a
             * transient database failure in front of a working route for the
             * whole TTL; caching a 403 would freeze an authorisation decision
             * that a role change should have altered.
             */
            if (res.statusCode >= 200 && res.statusCode < 300) {
                cache.set(key, { status: res.statusCode, body }, ttl, tags);
            }

            return originalJson(body);
        };

        return next();
    };

};

/**
 * Drops cached entries after a write succeeds.
 *
 * @param tags  the labels this write makes stale
 *
 * AFTER, not before. Invalidating on the way in leaves a window between the
 * flush and the commit in which a concurrent read repopulates the cache with
 * the pre-write value — and that entry then lives for the full TTL. Hooking
 * the response means the flush happens once the write has actually happened.
 *
 * The status check matters for the same reason in reverse: a rejected write
 * changed nothing, and flushing on it would throw away a warm cache for free.
 */
const invalidates = (...tags) => (req, res, next) => {

    const flat = tags.flat().filter(Boolean);

    res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
            cache.invalidate(flat);
        }
    });

    next();
};

/*
 * The tag vocabulary.
 *
 * Named constants rather than bare strings so a typo is a crash at startup
 * rather than an invalidation that silently matches nothing — which would
 * present as "the list does not refresh after I save", the hardest kind of
 * cache bug to track down.
 */
const TAGS = {
    PROGRAMS: "programs",
    DEPARTMENTS: "departments",
    BATCHES: "batches",
    SECTIONS: "sections",
    SUBJECTS: "subjects",
    SEMESTERS: "semesters",
    GRADES: "grades",
    FEE_STRUCTURES: "fee-structures",
    CLASSROOMS: "classrooms",
    TIMETABLE: "timetable",
    STUDENTS: "students",
    TEACHERS: "teachers",
    DASHBOARD: "dashboard",
    ACADEMICS: "academics",
    SEARCH: "search",

    /*
     * One admin's pinned-analytics library and screen layouts.
     *
     * Unlike every other tag here this one is per-account data, so its entries
     * are cached at 'user' scope and never shared. It earns a cache because
     * both customisable screens read it on every open and it is otherwise a
     * network round trip to a remote database for a dozen rows that change
     * only when that admin drags something.
     */
    PINNED: "pinned-analytics"
};

/*
 * Reference data is read by name all over the portals, and a change to any of
 * it invalidates the dashboards and the search catalogue that are derived from
 * it. Grouped so a write route can declare one constant instead of listing
 * seven tags and getting one wrong.
 */
const ACADEMIC_STRUCTURE_TAGS = [
    TAGS.PROGRAMS,
    TAGS.DEPARTMENTS,
    TAGS.BATCHES,
    TAGS.SECTIONS,
    TAGS.SUBJECTS,
    TAGS.SEMESTERS,
    TAGS.ACADEMICS,
    TAGS.DASHBOARD,
    TAGS.SEARCH
];

module.exports = {
    cached,
    invalidates,
    TAGS,
    ACADEMIC_STRUCTURE_TAGS,
    TTL: cache.TTL,
    stats: cache.stats,
    clear: cache.clear
};
