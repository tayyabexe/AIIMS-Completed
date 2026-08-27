const fs = require("fs");
const multer = require("multer");
const path = require("path");

// Resolved from this file rather than the process CWD. The previous relative
// "uploads/" only landed in the right place when the server happened to be
// started from backend/, and multer does not create a missing directory.
const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");
const AVATAR_DIR = path.join(UPLOAD_ROOT, "avatars");

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const diskStorage = (dir) => multer.diskStorage({

    destination: (req, file, cb) => {

        ensureDir(dir);

        cb(null, dir);

    },

    filename: (req, file, cb) => {

        cb(
            null,
            Date.now() + path.extname(file.originalname)
        );

    }

});

// Documents: unchanged behaviour, only the destination is now absolute.
const upload = multer({
    storage: diskStorage(UPLOAD_ROOT)
});

// Profile pictures. Kept separate from the document uploader because that one
// must keep accepting PDFs, while an avatar that is not an image would render
// as a broken image in every portal.
/*
 * THE AVATAR SIZE LIMIT
 * ---------------------
 * 1MB, enforced here and, independently, in the browser before the crop stage
 * opens (frontend/src/components/common/AvatarUploader.jsx).
 *
 * The two checks are not redundant. The browser one exists so a 40MP photo is
 * never decoded into a tab's memory; this one exists because a client-side
 * check is not a control — anything that can reach the route can skip the UI.
 *
 * It is generous for what actually arrives. The picker re-encodes every
 * upload to a 512x512 JPEG, measured at 11-60 KB, so 1MB is roughly fifteen
 * times the real payload while still refusing an unmodified phone photograph.
 *
 * One constant, used by both uploaders and by the error copy, so the number
 * and the message it is reported in cannot drift apart.
 */
const AVATAR_MAX_BYTES = 1 * 1024 * 1024;
const AVATAR_MAX_LABEL = "1MB";

const AVATAR_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
];

const imageUpload = multer({

    storage: diskStorage(AVATAR_DIR),

    // 1MB, the product rule for a profile picture (task 5). Kept in step with
    // avatarMemoryUpload below deliberately: this legacy disk uploader is no
    // longer on the avatar route, but leaving it at the old 2MB would mean the
    // codebase still contained a path that accepts an avatar the rule refuses.
    limits: { fileSize: AVATAR_MAX_BYTES },

    fileFilter: (req, file, cb) => {

        if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {

            return cb(
                new Error("Profile picture must be a JPEG, PNG, WEBP or GIF image")
            );

        }

        cb(null, true);

    }

});

/* ═══════════════════════════════════════════════════════════════════
   Memory storage — uploads bound for the database
   ═══════════════════════════════════════════════════════════════════

   Media is now stored as binary in the row rather than as a file on this
   machine's disk (see migrations/20260815090000-store-media-as-binary.js).
   That needs the bytes in memory, not written out to a path, so these
   uploaders use multer's memoryStorage and hand `file.buffer` to
   services/mediaService.

   The disk uploaders above are kept and still exported. They are what the
   legacy paths in existing rows point at, and removing them would break
   `require` calls that have nothing to do with this change.                */

/*
 * WHY THE MIME TYPE IS SNIFFED AND NOT BELIEVED
 * ---------------------------------------------
 * `file.mimetype` is whatever the client's multipart part CLAIMED. It is
 * trivially forged — an HTML file announced as image/png passes any check that
 * only reads that field, which is what the avatar filter above does on its own.
 *
 * That matters more now than it did. When the bytes were a file on disk served
 * by express.static, the damage was limited; now they are served back by an
 * application route, and a file that a browser decides is HTML executes on the
 * API's own origin — stored XSS with a session cookie in scope.
 *
 * So the first bytes are compared against the actual file signatures. Combined
 * with the `X-Content-Type-Options: nosniff` that mediaService sets on the way
 * out, an upload has to BE an image to be stored as one, and is never
 * reinterpreted on the way back.
 */
const IMAGE_SIGNATURES = [
    // JPEG: FF D8 FF
    { mime: "image/jpeg", offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    { mime: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    // GIF87a / GIF89a
    { mime: "image/gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
    // WEBP is a RIFF container: "RIFF" then 4 size bytes then "WEBP"
    { mime: "image/webp", offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }
];

// PDF: "%PDF-"
const PDF_SIGNATURE = { mime: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2D] };

const matchesSignature = (buffer, signature) => {

    const end = signature.offset + signature.bytes.length;

    if (!buffer || buffer.length < end) return false;

    return signature.bytes.every(
        (byte, index) => buffer[signature.offset + index] === byte
    );

};

/**
 * The real type of a buffer, or null if it is not one of the accepted formats.
 * Returning the DETECTED type rather than the claimed one is deliberate — it
 * is what gets stored, so the Content-Type served later describes the bytes.
 */
const detectMediaType = (buffer, { allowPdf = false } = {}) => {

    const candidates = allowPdf
        ? [...IMAGE_SIGNATURES, PDF_SIGNATURE]
        : IMAGE_SIGNATURES;

    const match = candidates.find((signature) => matchesSignature(buffer, signature));

    return match ? match.mime : null;

};

/*
 * Avatars, bound for users.profile_picture_data.
 *
 * AVATAR_MAX_BYTES (1MB) — the same limit the disk uploader carries and the
 * same one the picker states. It stops a mistaken upload of a 40MP photograph
 * and it bounds a database row.
 */
const avatarMemoryUpload = multer({

    storage: multer.memoryStorage(),

    limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },

    // The claimed type is still checked, as a cheap first pass that rejects
    // the obvious case before the whole body is buffered. The authoritative
    // check is the signature test, which needs the bytes and therefore has to
    // run after this.
    fileFilter: (req, file, cb) => {

        if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
            return cb(new Error("Profile picture must be a JPEG, PNG, WEBP or GIF image"));
        }

        cb(null, true);

    }

});

/*
 * Student documents, bound for student_documents.file_data.
 *
 * 8MB rather than the avatar's 1MB: these are scans — a multi-page transcript
 * out of a photocopier is legitimately several megabytes — and PDFs are
 * accepted alongside images because most of what is uploaded here is one.
 */
const documentMemoryUpload = multer({

    storage: multer.memoryStorage(),

    limits: { fileSize: 8 * 1024 * 1024, files: 1 },

    fileFilter: (req, file, cb) => {

        const accepted = [...AVATAR_MIME_TYPES, "application/pdf"];

        if (!accepted.includes(file.mimetype)) {
            return cb(new Error("Document must be a PDF or an image (JPEG, PNG, WEBP, GIF)"));
        }

        cb(null, true);

    }

});

/**
 * Wraps one of the memory uploaders so that multer's failure modes and the
 * signature check both arrive as a 400 with a readable message.
 *
 * Without this every one of them surfaces as a 500: multer rejects by calling
 * `next(error)`, and the generic error middleware has no way to tell "this
 * file is 9MB" apart from a database being down.
 *
 * @param uploader  avatarMemoryUpload or documentMemoryUpload
 * @param field     the multipart field name
 * @param options   { allowPdf, maxLabel }
 */
const handleUpload = (uploader, field, options = {}) => (req, res, next) => {

    uploader.single(field)(req, res, (error) => {

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.code === "LIMIT_FILE_SIZE"
                    ? `File must be ${options.maxLabel || "within the size limit"} or smaller`
                    : error.message
            });
        }

        if (!req.file) return next();

        const detected = detectMediaType(req.file.buffer, options);

        if (!detected) {
            return res.status(400).json({
                success: false,
                message: options.allowPdf
                    ? "That file is not a readable PDF or image."
                    : "That file is not a readable image."
            });
        }

        // The detected type wins over the claimed one, and is what gets stored.
        req.file.mimetype = detected;

        return next();

    });

};

// Default export stays the document uploader so existing `require(...)` calls
// keep working; everything added since is reached through a named property.
module.exports = upload;
module.exports.imageUpload = imageUpload;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
module.exports.AVATAR_DIR = AVATAR_DIR;

module.exports.AVATAR_MAX_BYTES = AVATAR_MAX_BYTES;
module.exports.AVATAR_MAX_LABEL = AVATAR_MAX_LABEL;
module.exports.avatarMemoryUpload = avatarMemoryUpload;
module.exports.documentMemoryUpload = documentMemoryUpload;
module.exports.detectMediaType = detectMediaType;
module.exports.handleUpload = handleUpload;

/** Ready-made middleware for the two upload routes. */
module.exports.receiveAvatar = handleUpload(
    avatarMemoryUpload,
    "profile_picture",
    { maxLabel: AVATAR_MAX_LABEL }
);

module.exports.receiveDocument = handleUpload(
    documentMemoryUpload,
    "document",
    { allowPdf: true, maxLabel: "8MB" }
);
