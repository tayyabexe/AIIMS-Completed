/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  One shared, deduplicated cache of everybody's profile picture
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS AND useAuthedImage DOES NOT COVER IT
 * ----------------------------------------------------
 * `hooks/useAuthedImage.js` is correct for ONE image on a screen: it fetches,
 * hands back a blob: URL, and revokes it on unmount. That is exactly wrong for
 * a directory. The admin student list, the attendance register, the fee ledger
 * and the parent's ward list all draw the same faces over and over, and with a
 * per-component fetch:
 *
 *   - fifty rows are fifty requests, most of which 404 because most accounts
 *     have no picture on record;
 *   - switching tabs and coming back re-fetches every one of them, because the
 *     previous blob was revoked on unmount;
 *   - the same person appearing twice on one screen (a child in the sidebar
 *     and again in the ward card) is downloaded twice.
 *
 * So the fetch is hoisted out of the component. A user's avatar is requested at
 * most once per session per version, and every place that draws that person
 * shares the result.
 *
 * WHY THE BLOB IS NOT REVOKED PER COMPONENT
 * -----------------------------------------
 * An object URL is only valid while it is alive, so a cache whose entries are
 * revoked when one consumer unmounts is not a cache — the next consumer gets a
 * dead URL and a broken image. Entries are therefore held until they are
 * evicted, and eviction is what bounds the memory: `LIMIT` entries, oldest
 * first, revoked on the way out. At 2MB a picture that is a hard ceiling rather
 * than the unbounded growth a naive cache would have.
 *
 * VERSIONS
 * --------
 * The key includes a version string — the checksum the upload response returns,
 * or the row's updated_at. Uploading a new picture produces a new key, so the
 * new portrait is fetched and the old entry ages out on its own. Without it the
 * cache would be the reason "I uploaded a new photo and nothing changed".
 */

import { fetchBlobUrl } from './client';

/** Most avatars held at once. Past this the oldest is revoked. */
const LIMIT = 160;

/** key -> { promise, url } — insertion-ordered, which is what makes eviction
 *  "oldest first" without a second structure. */
const entries = new Map();

const keyFor = (userId, version) => `${userId}::${version || ''}`;

const evictIfNeeded = () => {
    while (entries.size > LIMIT) {
        const oldestKey = entries.keys().next().value;
        const oldest = entries.get(oldestKey);
        entries.delete(oldestKey);
        // Only a resolved URL can be revoked; an in-flight one is left to the
        // next eviction pass rather than being torn out from under its caller.
        if (oldest?.url) URL.revokeObjectURL(oldest.url);
    }
};

/**
 * The blob: URL for a user's avatar, or null when there is no picture on
 * record. Never rejects — a missing portrait is a normal state, and no screen
 * should be able to fail on one.
 *
 * @param {number|string} userId
 * @param {string} [version]  checksum or updated_at; changes bust the entry
 * @returns {Promise<string|null>}
 */
export function getAvatarUrl(userId, version) {
    if (!userId) return Promise.resolve(null);

    const key = keyFor(userId, version);
    const hit = entries.get(key);
    if (hit) return hit.promise;

    const entry = { promise: null, url: null };

    entry.promise = fetchBlobUrl(`/api/users/${userId}/avatar`)
        .then((url) => {
            entry.url = url;
            return url;
        })
        .catch(() => null);

    entries.set(key, entry);
    evictIfNeeded();

    return entry.promise;
}

/**
 * Forgets one user's cached picture, whatever version it was stored under.
 *
 * Called after an upload or a delete. The version in the key would usually be
 * enough on its own, but a caller that has no fresh checksum to hand (the
 * delete response returns none) still needs the old portrait to stop being
 * served from here.
 */
export function invalidateAvatar(userId) {
    const prefix = `${userId}::`;

    for (const [key, entry] of entries) {
        if (!key.startsWith(prefix)) continue;
        entries.delete(key);
        if (entry.url) URL.revokeObjectURL(entry.url);
    }
}

/** Drops everything. Called on sign-out: the next account must not be able to
 *  see the previous one's faces, and the blobs should not outlive the session. */
export function clearAvatarCache() {
    for (const entry of entries.values()) {
        if (entry.url) URL.revokeObjectURL(entry.url);
    }
    entries.clear();
}
