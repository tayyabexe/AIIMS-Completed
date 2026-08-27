/*
 * Per-account request limits for the AI assistant.
 *
 * WHY THIS IS NOT THE USUAL ABUSE LIMITER
 * ---------------------------------------
 * Every question spends tokens from a shared daily pool. One person holding
 * the send key down does not degrade their own experience — it spends
 * everybody else's allowance, and the failure lands on a student asking about
 * their fees tomorrow morning. So this protects a budget, not a server.
 *
 * KEYED ON THE ACCOUNT, NOT THE IP
 * --------------------------------
 * A campus shares addresses. An IP-based limit would throttle an entire
 * computer lab as though it were one person, and would do nothing about one
 * account signed in from several devices. `req.user.user_id` comes from a
 * verified token, so it cannot be spoofed by a header.
 *
 * IN-PROCESS STATE
 * ----------------
 * Counters live in memory, which means they reset on restart and are per
 * instance rather than shared across a cluster. That is a deliberate trade:
 * the alternative is a Redis dependency for a limit whose purpose is to stop
 * runaway loops and impatient clicking, both of which a per-process counter
 * catches. If AIMS is ever run multi-instance behind a load balancer this
 * should move to a shared store — noted here rather than discovered later.
 */

const config = require("../config/assistant");
const { ROLES } = require("../config/roles");

/*
 * user_id -> array of request timestamps, newest last.
 *
 * Timestamps rather than fixed-window counters, so the limit is a genuine
 * sliding window. A fixed window lets someone spend a full allowance at
 * 10:59:59 and another at 11:00:00 — double the intended rate at the seam.
 */
const history = new Map();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * Dropping entries older than a day keeps the map from growing without bound.
 * Run on write rather than on a timer, so an idle process does no work.
 */
const prune = (timestamps, now) => {
    const cutoff = now - DAY;
    let i = 0;
    while (i < timestamps.length && timestamps[i] < cutoff) i += 1;
    return i ? timestamps.slice(i) : timestamps;
};

const countSince = (timestamps, now, window) => {
    const cutoff = now - window;
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
        if (timestamps[i] < cutoff) break;
        count += 1;
    }
    return count;
};

/*
 * Admins run heavier analytical questions, are few, and are the people most
 * likely to be doing legitimate bulk work. Their allowance is multiplied
 * rather than removed — an admin in a retry loop can still exhaust the pool.
 */
const limitsFor = (roleId) => {

    const { perMinute, perHour, perDay, adminMultiplier } = config.rateLimit;

    const factor = (roleId === ROLES.SUPER_ADMIN || roleId === ROLES.ADMIN)
        ? adminMultiplier
        : 1;

    return {
        perMinute: perMinute * factor,
        perHour: perHour * factor,
        perDay: perDay * factor
    };
};

const assistantRateLimit = (req, res, next) => {

    // Unauthenticated requests never reach here — authenticate runs first —
    // but failing closed costs nothing.
    if (!req.user?.user_id) return next();

    const userId = req.user.user_id;
    const now = Date.now();

    const timestamps = prune(history.get(userId) || [], now);
    const limits = limitsFor(req.user.role_id);

    const windows = [
        ["minute", MINUTE, limits.perMinute],
        ["hour", HOUR, limits.perHour],
        ["day", DAY, limits.perDay]
    ];

    for (const [name, window, allowed] of windows) {

        if (countSince(timestamps, now, window) >= allowed) {

            /*
             * Retry-After is set so a client can back off sensibly instead of
             * hammering, and the message says which window was hit — "wait a
             * minute" and "you are done for today" call for very different
             * responses from the person reading it.
             */
            const oldest = timestamps[timestamps.length - allowed] ?? now;
            const retryAfter = Math.max(1, Math.ceil((oldest + window - now) / 1000));

            res.set("Retry-After", String(retryAfter));

            // Record the rejected attempt too, so a client that ignores the
            // limit cannot reset its own window by continuing to send.
            history.set(userId, timestamps);

            return res.status(429).json({
                success: false,
                message: name === "day"
                    ? "You have reached the daily limit for assistant questions. "
                      + "It resets 24 hours after your first question today."
                    : `You are sending questions too quickly. Please wait ${retryAfter} `
                      + `second${retryAfter === 1 ? "" : "s"} and try again.`,
                retry_after_seconds: retryAfter,
                limit_window: name
            });
        }
    }

    timestamps.push(now);
    history.set(userId, timestamps);

    // Useful to a client that wants to show remaining budget, and to anyone
    // debugging why a request was refused.
    res.set("X-Assistant-Limit-Minute", String(limits.perMinute));
    res.set("X-Assistant-Remaining-Minute",
        String(Math.max(0, limits.perMinute - countSince(timestamps, now, MINUTE))));
    res.set("X-Assistant-Remaining-Day",
        String(Math.max(0, limits.perDay - countSince(timestamps, now, DAY))));

    return next();
};

/** Current usage for one account, for the health endpoint and tests. */
const usageFor = (userId) => {
    const now = Date.now();
    const timestamps = prune(history.get(userId) || [], now);

    return {
        minute: countSince(timestamps, now, MINUTE),
        hour: countSince(timestamps, now, HOUR),
        day: countSince(timestamps, now, DAY)
    };
};

/** Clears all counters. Test support only. */
const reset = () => history.clear();

module.exports = assistantRateLimit;
module.exports.usageFor = usageFor;
module.exports.reset = reset;
module.exports.limitsFor = limitsFor;
