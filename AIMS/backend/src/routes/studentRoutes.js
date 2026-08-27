const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");
// receiveDocument buffers to memory and validates by file signature; the old
// disk-writing default uploader is no longer used here.
const { receiveDocument } = require("../middlewares/upload.middleware");
// The global sanitiser in app.js runs before multer, so a multipart body is
// still unparsed at that point. Re-applied after receiveDocument below so the
// text fields travelling alongside the file are edge-trimmed too.
const sanitizeRequest = require("../middlewares/sanitize.middleware");
const {
    requireStudentAccess,
    requireDocumentAccess
} = require("../middlewares/selfScope.middleware");

const { invalidates, TAGS } = require("../middlewares/cache.middleware");

/*
 * Every student write moves a figure on a cached dashboard — the roll count,
 * the per-programme breakdown, the enrolment tiles — and changes the search
 * catalogue. Declared once here and attached to each write below, so the
 * dashboard cannot keep serving a student count that no longer matches the
 * table it was counted from.
 *
 * Reads on this router are NOT cached: a student record is personal data with
 * a per-caller access rule (requireStudentAccess), and caching a response
 * whose contents depend on who asked is exactly the mistake that leaks one
 * account's data to another.
 */
const flushStudents = invalidates([TAGS.STUDENTS, TAGS.DASHBOARD, TAGS.SEARCH]);

const {
    registerStudentValidation
} = require("../validators/studentValidator");

const {

    getStudents,
    registerStudent,
    getStudentProfile,
    updateStudent,
    deleteStudent,
    restoreStudent,
    enrollStudent,
    uploadStudentDocument,
    downloadStudentDocument,
    getStudentDocuments,
    deleteStudentDocument,
    searchStudents,
    getStudentGuardians,
    getOwnStudentRecord,
    updateOwnStudentRecord

} = require("../controllers/studentController");

// ================= GET ALL STUDENTS =================
router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getStudents
);

// ================= SEARCH & FILTER STUDENTS =================
// The signed-in student's own record. /api/students and /api/students/:id are
// Admin+Teacher only, so without this a student could not read their own row.
// Declared before "/:id" so it is not captured by it.
router.get(
    "/me",
    authenticate,
    getOwnStudentRecord
);

// The student's own contact details. Declared before "/:id" for the same
// reason as GET /me, and kept off the Admin-only PUT /:id.
router.put(
    "/me",
    authenticate,
    updateOwnStudentRecord
);

router.get(
    "/search",
    authenticate,
    authorize(...ADMIN_TEACHER),
    searchStudents
);

// ================= GET STUDENT DOCUMENTS =================
// requireStudentAccess: staff may read any student, a student only their own
// row and a parent only a ward's. Without it any signed-in account could read
// another student's identity documents by changing the id.
router.get(
    "/documents/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    getStudentDocuments
);

// ================= GET STUDENT GUARDIANS =================
router.get(
    "/guardians/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    getStudentGuardians
);

// ================= GET STUDENT PROFILE =================
router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getStudentProfile
);

// ================= REGISTER STUDENT =================
router.post(
    "/register",
    authenticate,
    authorize(...ADMINS),
    flushStudents,
    registerStudentValidation,
    registerStudent
);

// ================= UPLOAD DOCUMENT =================
// The student id arrives in the multipart body, so the file has to be parsed
// before ownership can be checked.
router.post(
    "/upload-document",
    authenticate,
    // Buffers to memory (the bytes go into the row now) and verifies the file
    // really is a PDF or an image by its signature rather than by its claimed
    // Content-Type. See middlewares/upload.middleware.js.
    receiveDocument,
    sanitizeRequest,
    requireStudentAccess("student_id"),
    uploadStudentDocument
);

// ================= DOWNLOAD STUDENT DOCUMENT =================
// Addressed by doc_id, so requireDocumentAccess resolves the owning student
// from the row itself — the same guard the delete below uses, and the reason
// changing the id in the URL cannot reach someone else's CNIC.
router.get(
    "/documents/:id/file",
    authenticate,
    requireDocumentAccess,
    downloadStudentDocument
);

// ================= ENROLL STUDENT =================
router.put(
    "/:id/enroll",
    authenticate,
    authorize(...ADMINS),
    flushStudents,
    enrollStudent
);

// ================= RESTORE STUDENT =================
// Undoes the soft delete below. Declared before "/:id" so "restore" is never
// read as part of an id, and Admin-only for the same reason the delete is.
router.post(
    "/:id/restore",
    authenticate,
    authorize(...ADMINS),
    flushStudents,
    restoreStudent
);

// ================= UPDATE STUDENT =================
router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    flushStudents,
    updateStudent
);

// ================= DELETE STUDENT DOCUMENT =================
// Addressed by doc_id, so the owning student is resolved from the row itself.
router.delete(
    "/documents/:id",
    authenticate,
    requireDocumentAccess,
    deleteStudentDocument
);

// ================= SOFT DELETE STUDENT =================
router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    flushStudents,
    deleteStudent
);

module.exports = router;
