// Per-user settings: what the Settings screen writes and the portals read.
//
// Only preferences the application can actually honour live here. The faculty
// Settings screen used to offer "Email me when attendance is pending", "Push
// reminders for upcoming classes" and a weekly digest; this project has no
// mail transport and no push service, so those switches could never have done
// anything and are not represented below. What is here is enforced somewhere
// real:
//
//   notifications.unreadBadge     - the bell / sidebar bubble (Sidebar, Header)
//   notifications.assignmentBadge - the Assignments bubble    (Sidebar)
//   notifications.mutedTypes      - categories hidden from the feed
//                                   (notificationController.getMyNotifications)
//   appearance.theme              - applied by ThemeContext on every portal
//   appearance.density            - row/padding scale, applied by
//                                   PreferencesContext as data-density on <html>
//   appearance.fontSize           - base type scale, applied the same way
//   seen.assignments              - acknowledgement watermark that clears the
//                                   Assignments bubble (facultyPortalService)
//
// The admin Settings screen used to keep ALL of its values in localStorage, and
// nothing in the codebase read any of them back — so every switch on it was
// write-only and device-local. Density and font size moved here because they
// are honourable: they are pure presentation and the CSS to apply them is real.
// Institute name, academic year, language, date format and timezone did NOT,
// because nothing in this project could act on them.

const UserPreference = require("../models/userPreference.model");

const DEFAULTS = {
    notifications: {
        unreadBadge: true,
        assignmentBadge: true,
        mutedTypes: []
    },
    appearance: {
        theme: "light",
        density: "comfortable",
        fontSize: "medium"
    },
    seen: {
        assignments: 0
    }
};

const THEMES = ["light", "dark", "system"];
const DENSITIES = ["compact", "comfortable", "spacious"];
const FONT_SIZES = ["small", "medium", "large"];

const clone = (value) => JSON.parse(JSON.stringify(value));

// A stored document is merged onto the defaults rather than replacing them, so
// a preference added after the row was written still has a value.
const withDefaults = (stored) => {
    const source = stored && typeof stored === "object" ? stored : {};

    return {
        notifications: {
            ...DEFAULTS.notifications,
            ...(source.notifications || {}),
            mutedTypes: Array.isArray(source.notifications?.mutedTypes)
                ? source.notifications.mutedTypes
                : []
        },
        appearance: {
            ...DEFAULTS.appearance,
            ...(source.appearance || {})
        },
        seen: {
            ...DEFAULTS.seen,
            ...(source.seen || {})
        }
    };
};

/**
 * Whitelist of what a caller may write, applied on top of what is stored.
 *
 * Anything not named here is dropped rather than merged, so the preferences
 * document cannot be used as arbitrary per-user storage by a client that posts
 * extra keys.
 */
const sanitize = (current, incoming) => {
    const next = clone(current);
    const source = incoming && typeof incoming === "object" ? incoming : {};

    const notifications = source.notifications;
    if (notifications && typeof notifications === "object") {
        if (notifications.unreadBadge !== undefined) {
            next.notifications.unreadBadge = Boolean(notifications.unreadBadge);
        }
        if (notifications.assignmentBadge !== undefined) {
            next.notifications.assignmentBadge = Boolean(notifications.assignmentBadge);
        }
        if (notifications.mutedTypes !== undefined) {
            next.notifications.mutedTypes = Array.isArray(notifications.mutedTypes)
                ? [...new Set(
                    notifications.mutedTypes
                        .filter((t) => typeof t === "string" && t.trim())
                        .map((t) => t.trim().slice(0, 50))
                )]
                : [];
        }
    }

    const appearance = source.appearance;
    if (appearance && typeof appearance === "object") {
        if (THEMES.includes(appearance.theme)) {
            next.appearance.theme = appearance.theme;
        }
        // Whitelisted rather than stored as given: these land in a data-
        // attribute on <html>, and an arbitrary string there is a selector the
        // stylesheet has no rule for — the setting would silently do nothing.
        if (DENSITIES.includes(appearance.density)) {
            next.appearance.density = appearance.density;
        }
        if (FONT_SIZES.includes(appearance.fontSize)) {
            next.appearance.fontSize = appearance.fontSize;
        }
    }

    const seen = source.seen;
    if (seen && typeof seen === "object") {
        if (seen.assignments !== undefined) {
            const watermark = Number(seen.assignments);
            // Watermarks only ever move forward. A stale client replaying an
            // older value must not un-read what the user has already seen.
            next.seen.assignments = Number.isFinite(watermark)
                ? Math.max(next.seen.assignments || 0, Math.trunc(watermark))
                : next.seen.assignments;
        }
    }

    return next;
};

/**
 * Reads fail soft.
 *
 * The notification feed and the sidebar badges both consult preferences on
 * every request. If `user_preferences` has not been created yet - the
 * migration is 20260808140000-create-user-preferences - a throw here would
 * take the notifications endpoint down with it, which is a far worse outcome
 * than everyone seeing the default settings. Writes are not covered by this:
 * a save that cannot be stored has to be reported to the user.
 */
const getPreferences = async (userId) => {
    try {
        const row = await UserPreference.findByPk(userId);
        return withDefaults(row ? row.preferences : null);
    } catch (error) {
        console.error("Could not read user preferences; using defaults.", error.message);
        return withDefaults(null);
    }
};

const savePreferences = async (userId, incoming) => {
    const current = await getPreferences(userId);
    const next = sanitize(current, incoming);

    await UserPreference.upsert({
        user_id: userId,
        preferences: next,
        updated_at: new Date()
    });

    return next;
};

module.exports = {
    DEFAULTS,
    THEMES,
    withDefaults,
    getPreferences,
    savePreferences
};
