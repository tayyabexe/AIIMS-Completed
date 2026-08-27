/*
 * Edge-trims every string arriving on a request.
 *
 * The bug this closes: the admit-student form sent `last_name` exactly as
 * typed, so " abdullah" was stored with its leading space. Nothing downstream
 * removed it — provisioningService binds the value straight into the INSERT,
 * and `last_name` is a varchar, which preserves edge whitespace verbatim.
 *
 * The result was a row that disagreed with itself: `users.full_name` went
 * through displayName(), which trims, while `students.last_name` did not. So
 * the account read "Tayayb abdullah" and every screen building a name with
 * CONCAT(first_name, ' ', last_name) read "Tayayb  abdullah". A leading space
 * is worse than a trailing one, because utf8mb4_unicode_ci is a PAD SPACE
 * collation: `= 'abdullah'` still matches a trailing space, but a leading one
 * breaks exact lookups, sorts the row before every "A", and defeats LIKE.
 *
 * Doing this once here rather than field-by-field is deliberate. Trimming was
 * already happening in nine different files — asText() in the academic
 * structure, displayName() in provisioning, ad-hoc String(x).trim() elsewhere
 * — which is precisely why the gaps were invisible: every module looked like
 * somebody had thought about it. One middleware over every route means a new
 * endpoint is covered on the day it is written, without anyone remembering.
 *
 * Edges only. Inner runs of whitespace are left exactly as typed, because
 * addresses, announcement bodies and assistant prompts are free text and their
 * spacing belongs to whoever wrote it.
 */

/*
 * Values whose whitespace is part of the secret and must survive untouched.
 *
 * A password is compared against a bcrypt hash of what was typed at the time
 * it was set. Trimming here would silently change the credential, and would
 * lock out any account whose stored hash was made from a password with edge
 * whitespace — the one case where "cleaning" the input destroys the thing it
 * is checked against. Tokens are matched byte-for-byte for the same reason.
 *
 * Matched case-insensitively against the key with separators removed, so
 * `newPassword`, `new_password` and `NewPassword` are all recognised.
 */
const PRESERVED_KEYS = new Set([
    "password",
    "currentpassword",
    "newpassword",
    "confirmpassword",
    "oldpassword",
    "passwordhash",
    "passwordconfirmation",
    "token",
    "resettoken",
    "refreshtoken",
    "accesstoken"
]);

const isPreserved = (key) =>
    PRESERVED_KEYS.has(String(key).toLowerCase().replace(/[-_\s]/g, ""));

/*
 * A ceiling on nesting. Nothing this API accepts is deeply nested — the
 * deepest real payload is an admission with its parent block, or a timetable
 * write with an array of slots — so a body that recurses past this is
 * malformed or hostile, and is left alone rather than walked.
 */
const MAX_DEPTH = 8;

const sanitizeValue = (value, depth) => {
    if (typeof value === "string") return value.trim();

    // Anything that is not a string or a plain container is returned as-is:
    // numbers, booleans, null, Date, Buffer.
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_DEPTH) return value;

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
            value[i] = sanitizeValue(value[i], depth + 1);
        }
        return value;
    }

    // Only walk plain objects. A Date, a Buffer or a class instance that
    // reached the body parser is left intact.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;

    for (const key of Object.keys(value)) {
        // Never walk into a prototype-pollution key, and never rewrite a secret.
        if (key === "__proto__" || key === "constructor") continue;
        if (isPreserved(key)) continue;

        value[key] = sanitizeValue(value[key], depth + 1);
    }

    return value;
};

/*
 * Mutates in place rather than rebuilding.
 *
 * Controllers destructure `req.body` and services are handed the same object,
 * so replacing it wholesale would be fine for the body but pointless work —
 * and `req.query` cannot be replaced by assignment at all under Express 5,
 * where it is a lazily-evaluated getter on the request prototype with no
 * setter. Writing `req.query = {}` there fails silently.
 */
const sanitizeRequest = (req, res, next) => {
    if (req.body && typeof req.body === "object") {
        sanitizeValue(req.body, 0);
    }

    /*
     * Query and params matter as much as the body: a filter of "  Computer
     * Science " must find the department, and an id arriving as " 42 " must
     * still parse. Express 5 memoises req.query on first read, so reading it,
     * sanitising the object and pinning the result with defineProperty is what
     * makes the cleaned copy the one every later reader sees.
     */
    try {
        const query = req.query;
        if (query && typeof query === "object" && Object.keys(query).length) {
            Object.defineProperty(req, "query", {
                value: sanitizeValue(query, 0),
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
    } catch {
        // A request whose query string cannot be parsed is the router's
        // problem to report, not this middleware's to crash on.
    }

    /*
     * req.params is deliberately not touched. It is populated by the router at
     * match time, which is after this middleware has run, so there would be
     * nothing here to clean — and a path segment cannot carry raw edge
     * whitespace anyway without being percent-encoded first.
     */
    next();
};

module.exports = sanitizeRequest;
module.exports.isPreserved = isPreserved;
module.exports.sanitizeValue = sanitizeValue;
