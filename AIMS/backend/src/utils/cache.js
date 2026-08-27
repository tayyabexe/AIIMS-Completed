/*
 * An in-process, TTL-bounded cache with tag invalidation.
 *
 * WHAT THE UI ACTUALLY DOES, WHICH IS WHY THIS EXISTS
 * ---------------------------------------------------
 * Signing in to any portal fires the same fan-out of reference reads. The
 * student bootstrap (api/studentData.js) requests programs, batches, sections
 * and subjects in one Promise.all; the parent bootstrap (api/parentData.js)
 * requests those four plus semesters; the faculty bootstrap requests subjects
 * and sections; the admin announcement audience builder requests programs,
 * batches, sections, semesters and a page of users.
 *
 * Every one of those is a full-table read of data that changes when a
 * registrar edits the academic structure — which is to say a handful of times
 * a semester. The institute has ~4,000 accounts. At a morning sign-in peak
 * that is thousands of identical `SELECT * FROM programs` inside a few
 * minutes, each one returning bytes identical to the last.
 *
 * The second tier is the dashboards: /api/admin/dashboard and
 * /api/academics/overview are multi-join aggregates over students, fees and
 * attendance, and an admin reloading a tab re-runs the whole thing.
 *
 * WHY IN-PROCESS AND NOT REDIS
 * ----------------------------
 * There is no Redis in this project's dependencies and adding one would make
 * a cache a deployment prerequisite. A Map in the API process needs no
 * infrastructure and is faster than a network round trip.
 *
 * The honest cost of that choice: the cache is PER PROCESS. Run two API
 * instances behind a load balancer and they hold separate copies, so a write
 * handled by instance A invalidates A's entries and not B's — B keeps serving
 * its stale copy until the TTL runs out. That is why the TTLs below are
 * minutes and not hours, and why nothing whose staleness would be visible as
 * a WRONG NUMBER (a fee balance, an attendance mark, an exam result) is
 * cached at all. If this ever runs multi-instance, the fix is to move this
 * module behind Redis; the call sites do not change.
 *
 * WHY NOT HTTP CACHING INSTEAD
 * ----------------------------
 * Cache-Control would put this in the browser, which is cheaper still — but it
 * cannot be invalidated. An admin who edits a programme would keep seeing the
 * old list until the header expired, with no way to force it. Caching on the
 * server keeps the invalidation in the hands of the code that does the write.
 */

/*
 * entry: { value, expiresAt, tags: Set<string> }
 *
 * A plain Map, deliberately. An LRU would add a dependency and an eviction
 * policy to reason about, and the bound here is not memory pressure — the
 * whole cached set is a few hundred kilobytes of reference rows — it is
 * staleness, which the TTL already handles.
 */
const store = new Map();

/*
 * tag -> Set<key>. The reverse index that makes invalidation O(keys with that
 * tag) instead of a full scan of the store. Without it, "a programme changed,
 * drop everything derived from programmes" would mean walking every entry on
 * every write.
 */
const tagIndex = new Map();

/* Observability. Cheap to keep, and the only way to answer "is this actually
   helping" without guessing. Exposed through stats(). */
const counters = { hits: 0, misses: 0, sets: 0, invalidations: 0, expired: 0 };

const now = () => Date.now();

/** Detaches a key from every tag that pointed at it. */
const unindex = (key, tags) => {
    for (const tag of tags) {
        const keys = tagIndex.get(tag);
        if (!keys) continue;
        keys.delete(key);
        if (!keys.size) tagIndex.delete(tag);
    }
};

const drop = (key) => {
    const entry = store.get(key);
    if (!entry) return;
    unindex(key, entry.tags);
    store.delete(key);
};

/**
 * Reads a live entry.
 *
 * An expired entry is deleted on read rather than by a background timer. A
 * sweep interval would keep the process alive and would have to be unref'd to
 * let it exit cleanly; expiring lazily costs nothing and cannot leak a timer.
 * The periodic sweep below exists only for entries that are never read again.
 *
 * @returns the cached value, or undefined on a miss. `undefined` is the miss
 *          signal, so a cached value of `undefined` is not representable —
 *          which is correct here, since a handler that produced nothing has
 *          nothing worth caching.
 */
const get = (key) => {
    const entry = store.get(key);

    if (!entry) {
        counters.misses += 1;
        return undefined;
    }

    if (entry.expiresAt <= now()) {
        drop(key);
        counters.misses += 1;
        counters.expired += 1;
        return undefined;
    }

    counters.hits += 1;
    return entry.value;
};

/**
 * Stores a value.
 *
 * @param key    full cache key, already scoped by the caller
 * @param value  anything; stored by reference, see the warning below
 * @param ttlMs  lifetime in milliseconds
 * @param tags   labels for bulk invalidation, e.g. ['programs', 'academics']
 *
 * WARNING: the value is stored BY REFERENCE, not cloned. Cloning every cached
 * response would cost more than the database read it replaces. The contract is
 * therefore that callers must not mutate a value after handing it over, and
 * must not mutate one they read back. The response middleware satisfies this
 * by caching a serialised body rather than a live object.
 */
const set = (key, value, ttlMs, tags = []) => {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return value;

    // Replacing an existing key must clear its old tags, or a re-tagged entry
    // stays reachable through a tag it no longer carries.
    drop(key);

    const tagSet = new Set(tags);

    store.set(key, { value, expiresAt: now() + ttlMs, tags: tagSet });

    for (const tag of tagSet) {
        if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
        tagIndex.get(tag).add(key);
    }

    counters.sets += 1;
    return value;
};

/**
 * Drops every entry carrying any of these tags.
 *
 * This is what makes the cache safe to put in front of data an admin edits: a
 * write tagged `programs` removes every cached response derived from
 * programmes, so the next read rebuilds. Called from the write middleware, so
 * a route does not have to remember.
 *
 * @returns how many entries were removed
 */
const invalidate = (...tags) => {
    const flat = tags.flat().filter(Boolean);
    let removed = 0;

    for (const tag of flat) {
        const keys = tagIndex.get(tag);
        if (!keys) continue;

        // Copied before iterating: drop() mutates this very Set.
        for (const key of [...keys]) {
            drop(key);
            removed += 1;
        }
    }

    counters.invalidations += removed;
    return removed;
};

/** Empties everything. Used by tests and by the admin cache-flush endpoint. */
const clear = () => {
    store.clear();
    tagIndex.clear();
};

/**
 * Read-through: return the cached value, or produce it, cache it and return it.
 *
 * NOTE ON CONCURRENCY. Two requests that miss at the same moment both run
 * `producer`. That is a deliberate simplification — deduplicating would mean
 * holding a promise per key and inheriting its failure semantics (one slow
 * query stalling every waiter, a rejection needing to be un-cached). The
 * duplicated work here is a reference-table SELECT, and the window is
 * milliseconds.
 *
 * A rejected producer is NOT cached; a failed read must not be served as an
 * answer for the next five minutes.
 */
const remember = async (key, ttlMs, producer, tags = []) => {
    const hit = get(key);
    if (hit !== undefined) return hit;

    const value = await producer();

    // A handler that produced nothing is not cached — see the note on get().
    if (value !== undefined) set(key, value, ttlMs, tags);

    return value;
};

/*
 * Removes entries that expired and were never read again.
 *
 * Lazy expiry alone leaves those in the Map forever, which for a key space
 * that includes a user id (the per-account dashboard entries) grows with the
 * number of people who have ever signed in.
 *
 * `unref()` is the important part: without it this timer keeps the Node event
 * loop alive and the process refuses to exit on SIGTERM.
 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sweeper = setInterval(() => {
    const cutoff = now();
    for (const [key, entry] of store) {
        if (entry.expiresAt <= cutoff) drop(key);
    }
}, SWEEP_INTERVAL_MS);

if (typeof sweeper.unref === "function") sweeper.unref();

/** Hit rate and size, for the admin diagnostics endpoint. */
const stats = () => {
    const lookups = counters.hits + counters.misses;

    return {
        entries: store.size,
        tags: tagIndex.size,
        ...counters,
        hitRate: lookups ? Number((counters.hits / lookups).toFixed(3)) : null
    };
};

/*
 * How long each kind of data may be stale.
 *
 * Chosen against how visible a stale answer would be, not against how
 * expensive the query is:
 *
 * REFERENCE — programmes, batches, sections, subjects, semesters,
 *   departments, grade bands. Edited by a registrar a few times a semester.
 *   Every write path invalidates it, so the TTL is only a backstop against a
 *   write this process did not handle. 10 minutes.
 *
 * AGGREGATE — dashboard tiles and academic overviews. Counts and totals, where
 *   "as of a minute ago" is an honest thing for a dashboard to show. Short
 *   enough that an admin who changes something and switches tabs sees it.
 *   60 seconds.
 *
 * SHORT — anything close to a live figure. A reload-storm damper rather than
 *   a cache. 15 seconds.
 *
 * NOT CACHED AT ALL, deliberately: fee balances, attendance marks, exam
 * results, notifications and anything under /api/auth. A stale number on any
 * of those is not a slow screen, it is a wrong answer that someone may act on.
 */
const TTL = {
    REFERENCE: 10 * 60 * 1000,
    AGGREGATE: 60 * 1000,
    SHORT: 15 * 1000
};

module.exports = {
    get,
    set,
    remember,
    invalidate,
    clear,
    stats,
    TTL
};
