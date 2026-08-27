"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  Every profile picture ends up IN THE DATABASE. No picture is served off
 *  this machine's disk any more.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHERE THINGS STOOD
 * ------------------
 * 20260815090000-store-media-as-binary.js added the columns that hold an avatar
 * as bytes in the row — profile_picture_data and its mime / size / checksum /
 * updated_at companions — and pointed new uploads at them. It deliberately
 * migrated nothing: `mediaService.send` falls back to the legacy path column,
 * so existing pictures kept working and a row converted the next time that
 * person uploaded.
 *
 * Most people never upload again. Counted against aims_db before this ran:
 *
 *     in the database ..........       2
 *     path only, on disk .......   2,235
 *     no picture ...............   1,815
 *
 * So the storage was still, in practice, the filesystem. That is the thing this
 * removes: a picture in a row survives a redeploy, a container rebuild and a
 * restore from a database backup, and a path does none of those.
 *
 * THE SECOND, LARGER FINDING
 * --------------------------
 * Of those 2,235 paths, SIX have a file behind them. The rest — values like
 * `uploads/avatars/1.jpg`, one per row, sequential — were written by seeding and
 * no file was ever created. Every one of them is a lie in the data with three
 * costs:
 *
 *   - the avatar route 404s, so the portal draws initials; the column has been
 *     claiming a picture exists that nobody has ever seen;
 *   - `has_profile_picture` is computed from that column, so every screen that
 *     uses it to decide whether to fetch fires a request that cannot succeed —
 *     on a fifty-row roster that is fifty pointless round trips;
 *   - anyone reading the table cannot tell the six real ones from the 2,229
 *     imaginary ones.
 *
 * So a dangling path is cleared to NULL, which is what the row actually means.
 *
 * NOTHING IS DELETED FROM DISK
 * ----------------------------
 * The files that are migrated are left exactly where they are. The row is the
 * source of truth once its bytes are in, and the copy on disk costs a few
 * hundred kilobytes — cheap insurance against having got this wrong. Reclaiming
 * that space is a separate, later decision.
 *
 * The cleared paths are written to database/backups/cleared-avatar-paths.json
 * before the UPDATE, so a value removed here is recoverable even though `down`
 * cannot put it back automatically.
 *
 * WHY BYTES AND NOT BASE64
 * ------------------------
 * "Store the image as code in the column" is normally base64. It is the wrong
 * encoding here and by a wide margin: base64 is 4 bytes of text per 3 bytes of
 * image (+33% on every row, every dump, every backup), it has to be decoded
 * before a browser can render it, and a BLOB already holds arbitrary bytes. The
 * goal — the picture lives in the database, not in a file store — is met by
 * the binary column, without paying a third more for the privilege.
 */

const CHUNK = 200;

/** MEDIUMBLOB is 16MB; the upload route caps an avatar at 2MB. A file larger
 *  than the column could hold would fail the UPDATE and take the batch with
 *  it, so it is reported and skipped instead. */
const MAX_BYTES = 16 * 1024 * 1024;

/*
 * The type is read from the file's own magic bytes, not from its extension.
 *
 * The stored Content-Type is what a browser is told these bytes are, and half
 * of these files are named .jpg by a seeding script that did not look inside
 * them. Trusting the extension would mean serving a PNG labelled as a JPEG.
 */
const SIGNATURES = [
    { mime: "image/jpeg", offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
    { mime: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    { mime: "image/gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: "image/webp", offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }
];

const detect = (buffer) => {
    const match = SIGNATURES.find((sig) => {
        const end = sig.offset + sig.bytes.length;
        if (buffer.length < end) return false;
        return sig.bytes.every((b, i) => buffer[sig.offset + i] === b);
    });

    return match ? match.mime : null;
};

/*
 * A database value used as a filesystem path is a traversal waiting to happen —
 * a row holding "../../.env" would otherwise be read and stored as somebody's
 * avatar. The resolved path is required to sit inside the uploads root, and
 * anything else is treated as missing.
 */
const resolveInside = (root, stored) => {
    const relative = String(stored).replace(/^\/?uploads\/?/, "");
    const full = path.resolve(root, relative);

    if (full !== root && !full.startsWith(root + path.sep)) return null;

    return full;
};

module.exports = {

    async up(queryInterface) {

        const sequelize = queryInterface.sequelize;
        const { QueryTypes } = sequelize.constructor;

        const uploadRoot = path.resolve(
            __dirname, "..", "..", "backend", "uploads"
        );

        const rows = await sequelize.query(
            `SELECT user_id, profile_picture
               FROM users
              WHERE profile_picture IS NOT NULL
                AND profile_picture <> ''
                AND profile_picture_data IS NULL`,
            { type: QueryTypes.SELECT }
        );

        console.log(`[avatars] ${rows.length} rows still hold a path and no bytes`);

        const moved = [];
        const dangling = [];
        const rejected = [];

        for (const row of rows) {

            const full = resolveInside(uploadRoot, row.profile_picture);

            if (!full || !fs.existsSync(full)) {
                dangling.push(row);
                continue;
            }

            let buffer;

            try {
                buffer = fs.readFileSync(full);
            } catch (error) {
                rejected.push({ ...row, reason: `unreadable: ${error.message}` });
                continue;
            }

            if (!buffer.length || buffer.length > MAX_BYTES) {
                rejected.push({ ...row, reason: `size ${buffer.length}` });
                continue;
            }

            const mime = detect(buffer);

            if (!mime) {
                // Not an image by its own bytes. Storing it would mean the
                // avatar route serves something a browser cannot draw, which is
                // strictly worse than the initials it falls back to.
                rejected.push({ ...row, reason: "not a readable image" });
                continue;
            }

            moved.push({
                userId: row.user_id,
                data: buffer,
                mime,
                size: buffer.length,
                checksum: crypto.createHash("sha256").update(buffer).digest("hex")
            });
        }

        // ------------------------------------------------ write the bytes in

        for (const item of moved) {
            await sequelize.query(
                `UPDATE users
                    SET profile_picture_data       = :data,
                        profile_picture_mime       = :mime,
                        profile_picture_size       = :size,
                        profile_picture_checksum   = :checksum,
                        profile_picture_updated_at = NOW(),
                        -- Cleared in the same statement. Bytes and a path
                        -- together are two answers to "where is this picture",
                        -- and mediaService checks the path second — so a stale
                        -- one would quietly win for any caller that reached it
                        -- first.
                        profile_picture            = NULL
                  WHERE user_id = :userId`,
                { replacements: item }
            );
        }

        // -------------------------------------- record, then clear the lies

        if (dangling.length || rejected.length) {

            const backupDir = path.resolve(__dirname, "..", "backups");

            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

            fs.writeFileSync(
                path.join(backupDir, "cleared-avatar-paths.json"),
                JSON.stringify({
                    clearedAt: new Date().toISOString(),
                    note: "profile_picture values removed by "
                        + "20260822160000-move-avatars-into-the-database. Each pointed at "
                        + "a file that does not exist or is not a readable image, so none "
                        + "of them has ever rendered.",
                    dangling: dangling.map((r) => ({ user_id: r.user_id, path: r.profile_picture })),
                    rejected: rejected.map((r) => ({ user_id: r.user_id, path: r.profile_picture, reason: r.reason }))
                }, null, 2)
            );

            const ids = [...dangling, ...rejected].map((r) => r.user_id);

            for (let i = 0; i < ids.length; i += CHUNK) {
                await sequelize.query(
                    `UPDATE users SET profile_picture = NULL WHERE user_id IN (:ids)`,
                    { replacements: { ids: ids.slice(i, i + CHUNK) } }
                );
            }
        }

        console.log(
            `[avatars] moved into the database: ${moved.length}\n`
            + `[avatars] paths cleared (no file behind them): ${dangling.length}\n`
            + `[avatars] paths cleared (unreadable / not an image): ${rejected.length}`
        );
    },

    /*
     * Deliberately not a true inverse, and it says so rather than pretending.
     *
     * Putting the bytes back on disk would mean inventing filenames, and the
     * paths that were cleared pointed at files that never existed — there is
     * nothing to restore them to. What `down` CAN safely do is nothing
     * destructive: the bytes stay in the rows, where they render correctly, and
     * the JSON written by `up` is the record for anyone who needs the old
     * values.
     */
    async down() {
        console.log(
            "[avatars] down() is a no-op. The pictures live in the rows and "
            + "still render; the cleared paths are listed in "
            + "database/backups/cleared-avatar-paths.json."
        );
    }

};
