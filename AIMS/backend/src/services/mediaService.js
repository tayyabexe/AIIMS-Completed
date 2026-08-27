/*
 * mediaService — storing and serving uploaded media held as binary in the
 * database.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Uploads used to land on the API server's disk, with the row storing only a
 * path. See migrations/20260815090000-store-media-as-binary.js for why that
 * had to change; this module is the code side of it.
 *
 * THE TWO HALVES
 * --------------
 * `describeUpload` turns a multer memory-storage file into the column set a
 * row needs. `send` writes one of those rows back to an HTTP response, with
 * the caching that makes serving images out of MySQL viable.
 *
 * THE FALLBACK IS THE POINT
 * -------------------------
 * Nothing was migrated. Roughly every avatar and document that exists today
 * still lives on disk with a path in the row, so `send` checks for bytes
 * first and falls back to the legacy path second. That is what lets the
 * change ship without a migration window and without breaking a single
 * existing image — a row converts the next time its file is uploaded, and
 * until then it is served exactly as it was before.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { UPLOAD_ROOT } = require("../middlewares/upload.middleware");

/*
 * How long a browser may reuse a downloaded image without asking.
 *
 * `immutable` is NOT used here, and the distinction matters: an avatar is
 * served from a stable URL (/api/users/42/avatar) whose CONTENT changes when
 * the user uploads a new picture. `immutable` promises the opposite and would
 * strand a stale portrait in the cache until it aged out. Instead the response
 * carries an ETag, so a revalidation is a 304 with no body — the cost of
 * checking is a header exchange, and the bytes only move when they change.
 *
 * `private` because these are personal: an avatar or a scanned B-Form must not
 * be held in a shared proxy cache where it could be served to another account.
 */
const CACHE_CONTROL = "private, max-age=300, must-revalidate";

/**
 * Bytes -> the columns a media-bearing row stores.
 *
 * @param file  a multer file from memoryStorage (it has `.buffer`)
 * @returns     { data, mime, size, checksum, name }
 */
const describeUpload = (file) => {

    if (!file || !file.buffer) return null;

    return {
        data: file.buffer,

        /*
         * multer reports the mimetype the CLIENT claimed. It is not trusted
         * for safety — the upload middleware sniffs the real magic bytes and
         * rejects mismatches before this is reached — but by that point it has
         * been verified, so it is the right value to store and serve back.
         */
        mime: file.mimetype,

        size: file.size,

        /*
         * SHA-256 of the content, used as the ETag. Computed once here rather
         * than per request: hashing 2MB on every avatar GET would undo the
         * point of caching.
         *
         * Not a security control — it identifies a version of the bytes, it
         * does not authenticate them.
         */
        checksum: crypto.createHash("sha256").update(file.buffer).digest("hex"),

        /*
         * `originalname` is attacker-controlled and is only ever used as a
         * Content-Disposition filename, so it is stripped to its basename to
         * make sure a name like "../../etc/passwd" cannot travel anywhere.
         */
        name: path.basename(file.originalname || "").slice(0, 255) || null
    };
};

/**
 * Writes a stored media row to the response.
 *
 * @param res      express response
 * @param record   { data, mime, size, checksum, name, updatedAt, legacyPath }
 * @param options  { download } — send as an attachment rather than inline
 * @returns        true if something was sent, false if there was nothing to send
 */
const send = (res, record, options = {}) => {

    if (!record) return false;

    const { download = false } = options;

    // ---------------------------------------------------- database-backed

    if (record.data && record.data.length) {

        const etag = record.checksum ? `"${record.checksum}"` : undefined;

        if (etag) res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", CACHE_CONTROL);
        res.setHeader("Content-Type", record.mime || "application/octet-stream");
        res.setHeader("Content-Length", record.data.length);

        if (record.updatedAt) {
            res.setHeader("Last-Modified", new Date(record.updatedAt).toUTCString());
        }

        /*
         * `nosniff` is not decoration here. These bytes were uploaded by a
         * user, and without it a browser is free to ignore the declared
         * Content-Type and re-interpret a file as HTML — which is how an
         * "image" upload becomes stored XSS on the API's own origin.
         */
        res.setHeader("X-Content-Type-Options", "nosniff");

        if (download) {
            const filename = (record.name || "document").replace(/["\\]/g, "");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`
            );
        }

        /*
         * The conditional request. A browser that already has this version
         * sends If-None-Match; answering 304 means the response is a few
         * hundred bytes of headers instead of a 2MB body. Without this, every
         * page that shows an avatar would re-read it from MySQL.
         */
        if (etag && res.req.headers["if-none-match"] === etag) {
            res.status(304).end();
            return true;
        }

        res.status(200).end(record.data);
        return true;
    }

    // ------------------------------------------------------ legacy on disk

    /*
     * No bytes in the row, so this predates the move to binary storage. The
     * stored value is a web path like "/uploads/avatars/1786018356314.png";
     * it is resolved back to a real file and streamed.
     *
     * The containment check below is not optional. `file_url` is a database
     * value, and treating any database value as a filesystem path is a
     * traversal waiting to happen — a row holding "/uploads/../../../.env"
     * would otherwise read whatever the process can reach. The resolved path
     * is required to sit inside UPLOAD_ROOT and anything else is treated as a
     * missing file.
     */
    if (record.legacyPath) {

        const relative = String(record.legacyPath).replace(/^\/?uploads\/?/, "");
        const resolved = path.resolve(UPLOAD_ROOT, relative);

        if (
            resolved !== UPLOAD_ROOT
            && !resolved.startsWith(UPLOAD_ROOT + path.sep)
        ) {
            return false;
        }

        if (!fs.existsSync(resolved)) return false;

        res.setHeader("Cache-Control", CACHE_CONTROL);
        res.setHeader("X-Content-Type-Options", "nosniff");

        if (download) {
            return !!res.download(resolved, record.name || path.basename(resolved));
        }

        res.sendFile(resolved);
        return true;
    }

    return false;
};

/**
 * Whether a row has media at all, by either route. Lets a caller answer 404
 * before committing to a scoped read of the blob.
 */
const hasMedia = (record) =>
    !!record && (!!(record.data && record.data.length) || !!record.legacyPath);

module.exports = {
    describeUpload,
    send,
    hasMedia,
    CACHE_CONTROL
};
