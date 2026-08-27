/*
 * ONE POLICY FOR EVERY SIGN-IN, AND ONE ANSWER FOR EVERY FAILURE.
 *
 * Two requirements meet in this file and they pull against each other:
 *
 *   1. A failed sign-in must not say WHICH half was wrong. Before this, the
 *      four portals answered a bad email, a bad password, a disabled account
 *      and a valid-credentials-wrong-portal attempt with four distinguishable
 *      responses - different wording, different status codes, and in the
 *      wrong-portal case a 200 carrying a real token that the browser then
 *      threw away. Anyone watching the network tab could confirm a password.
 *
 *   2. After two failures the person is told how many tries remain before the
 *      account locks. That message is only meaningful for an account that
 *      exists - which is exactly the fact requirement 1 exists to hide.
 *
 * The resolution is the `ghosts` map below: a made-up email address is counted
 * too, in memory, so it produces the same countdown and the same lock notice
 * as a real one. From outside, a real account and an invented one are
 * indistinguishable at every step.
 *
 * Nothing here decides whether a password is correct. The callers
 * (authController.login, parentController.parentLogin) do that and then report
 * the outcome through recordFailure / recordSuccess, so both portals share one
 * counter, one threshold and one set of words.
 */

const bcrypt = require("bcrypt");

const User = require("../models/user.model");
const audit = require("./auditService");
const notify = require("./notificationService");
const { ROLES } = require("../config/roles");

// Failures allowed before the account is locked.
const MAX_ATTEMPTS = 5;

/*
 * The remaining-tries countdown starts once three are left - i.e. from the
 * second failure onwards, which is what was asked for: "3 more tries", then
 * "2 more tries", then "1 more try", then locked.
 */
const COUNTDOWN_FROM = 3;

// The one thing every failed sign-in says, on every portal.
const GENERIC_FAILURE = "Email or password is incorrect.";

const LOCKED_MESSAGE =
    "This account is locked after "
    + MAX_ATTEMPTS
    + " failed sign-in attempts. Ask an administrator to unlock it.";

/*
 * A real bcrypt hash of a string nobody uses, compared against when the email
 * does not exist.
 *
 * Without it the unknown-email path returns in under a millisecond while the
 * wrong-password path spends ~100ms hashing, and that difference alone answers
 * "does this address have an account here" no matter how carefully the two
 * responses are worded.
 */
const DUMMY_HASH = bcrypt.hashSync("no-account-with-this-address", 10);

// ---------------------------------------------------------------- ghost store
//
// Failures against an address that has no account. Deliberately in memory and
// deliberately not a database table: these are attempts against nothing, they
// must not accumulate rows, and losing them on restart costs nothing.

const GHOST_TTL_MS = 30 * 60 * 1000;

const ghosts = new Map();

const pruneGhosts = () => {
    const cutoff = Date.now() - GHOST_TTL_MS;

    for (const [key, entry] of ghosts) {
        if (entry.seenAt < cutoff) ghosts.delete(key);
    }
};

const ghostKey = (email) => String(email || "").trim().toLowerCase();

// --------------------------------------------------------------- the wording

const failureMessage = (attempts) => {
    const remaining = MAX_ATTEMPTS - attempts;

    if (remaining <= 0) return LOCKED_MESSAGE;

    if (remaining > COUNTDOWN_FROM) return GENERIC_FAILURE;

    return `${GENERIC_FAILURE} ${remaining} more `
        + (remaining === 1 ? "try" : "tries")
        + " before this account is locked.";
};

/*
 * 423 Locked for a locked account, 401 for everything else. The status is the
 * only thing that varies, and it varies identically for a real account and a
 * ghost, so it reveals nothing the message does not already say out loud.
 */
const responseFor = (attempts) => ({
    status: attempts >= MAX_ATTEMPTS ? 423 : 401,
    message: failureMessage(attempts)
});

// ------------------------------------------------------------- announcing it

/*
 * Told to the administrators who can act on it, and to the account holder,
 * who is the only person able to say "that was not me".
 *
 * The account holder is normally excluded from notifications about their own
 * account's activity - see the note in authController - but a lock is the same
 * class of event as a password change: if they did not cause it, somebody else
 * is trying to get in, and they need to know once they are back in.
 */
const announceLock = async (user, req) => {
    try {
        await audit.record({
            userId: user.user_id,
            action: audit.ACTIONS.ACCOUNT_LOCKED,
            module: audit.MODULES.AUTH,
            entity: `users#${user.user_id}`,
            after: {
                targetUserId: user.user_id,
                email: user.email,
                failedAttempts: user.failed_login_attempts,
                // As a string: the audit scrubber walks the object it is given
                // and a Date comes out the other side as {}, which is how the
                // timestamp on this row would otherwise be lost.
                lockedAt: new Date(user.locked_at).toISOString()
            },
            req
        });

        const admins = await notify.staffAudience([
            ROLES.SUPER_ADMIN,
            ROLES.ADMIN
        ]);

        const holder = await notify.userAudience(user.user_id);

        await notify.emit({
            audience: [...admins, ...holder],
            type: notify.TYPES.ACCOUNT,
            priority: notify.PRIORITY.HIGH,
            title: "Account locked after failed sign-ins",
            message:
                `${user.full_name || user.email} was locked after `
                + `${MAX_ATTEMPTS} failed sign-in attempts. `
                + "An administrator can unlock it from User Management."
            // No link: the admin screen is not one route for every audience,
            // and the account holder has nothing to open. See the LINKS note
            // in notificationService.
        });

    } catch (error) {
        /*
         * A lock must never fail because the bell could not ring. The row is
         * already saved by recordFailure below; this is only the announcement.
         */
        console.error("[loginSecurity] failed to announce a lock", error);
    }
};

// ------------------------------------------------------------------- the API

const isLocked = (user) => !!(user && user.locked_at);

const lockedResponse = () => ({
    status: 423,
    message: LOCKED_MESSAGE
});

/*
 * Burns the time a real password check would have taken.
 *
 * Called on the paths that never reach bcrypt.compare - an unknown email, an
 * account whose portal does not match - so all of them cost the same.
 */
const equaliseTiming = async () => {
    try {
        await bcrypt.compare("no-account-with-this-address", DUMMY_HASH);
    } catch {
        /* nothing to do: this call exists only to spend the time */
    }
};

/*
 * Record one failed sign-in and return exactly what to send back.
 *
 * `user` is the row when the address exists and null when it does not; the
 * caller does not otherwise branch on that, which is the point.
 */
const recordFailure = async ({ user, email, req }) => {
    if (!user) {
        pruneGhosts();

        const key = ghostKey(email);
        const entry = ghosts.get(key) || { attempts: 0 };

        entry.attempts = Math.min(entry.attempts + 1, MAX_ATTEMPTS);
        entry.seenAt = Date.now();
        ghosts.set(key, entry);

        return responseFor(entry.attempts);
    }

    const attempts = Math.min(
        (user.failed_login_attempts || 0) + 1,
        MAX_ATTEMPTS
    );

    user.failed_login_attempts = attempts;

    const lockingNow = attempts >= MAX_ATTEMPTS && !user.locked_at;

    if (lockingNow) user.locked_at = new Date();

    await user.save();

    if (lockingNow) await announceLock(user, req);

    return responseFor(attempts);
};

// A clean sign-in wipes the slate: the counter, and any ghost entry left by
// somebody mistyping this address earlier.
const recordSuccess = async (user) => {
    ghosts.delete(ghostKey(user.email));

    user.failed_login_attempts = 0;
    user.locked_at = null;
    user.last_login = new Date();

    await user.save();
};

/*
 * The administrator's unlock. Clears the lock and the counter together - a
 * lock lifted with 5 attempts still on the clock would re-lock on the next
 * typo, which would look to the user like the unlock never happened.
 */
const unlockAccount = async (userId, { actorUserId, req } = {}) => {
    const user = await User.findByPk(userId);

    if (!user) return null;

    const wasLocked = !!user.locked_at;

    ghosts.delete(ghostKey(user.email));

    user.locked_at = null;
    user.failed_login_attempts = 0;

    await user.save();

    await audit.record({
        userId: actorUserId || userId,
        action: audit.ACTIONS.ACCOUNT_UNLOCKED,
        module: audit.MODULES.AUTH,
        entity: `users#${user.user_id}`,
        before: { targetUserId: user.user_id, locked: wasLocked },
        after: { targetUserId: user.user_id, locked: false },
        req
    });

    if (wasLocked) {
        try {
            await notify.emit({
                audience: await notify.userAudience(user.user_id),
                type: notify.TYPES.ACCOUNT,
                priority: notify.PRIORITY.NORMAL,
                title: "Your account has been unlocked",
                message:
                    "An administrator unlocked your account. "
                    + "You can sign in again with your usual password.",
                actorUserId: actorUserId || null
            });
        } catch (error) {
            console.error("[loginSecurity] failed to announce an unlock", error);
        }
    }

    return user;
};

module.exports = {
    MAX_ATTEMPTS,
    GENERIC_FAILURE,
    LOCKED_MESSAGE,
    isLocked,
    lockedResponse,
    equaliseTiming,
    recordFailure,
    recordSuccess,
    unlockAccount
};
