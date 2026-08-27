const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ACADEMIC_REFERENCE } = require("../config/roles");
const {
    cached,
    invalidates,
    TAGS,
    ACADEMIC_STRUCTURE_TAGS,
    TTL
} = require("../middlewares/cache.middleware");

const subjectController = require("../controllers/subjectController");

// Reads are open to every portal including Parent: the subject catalogue is
// reference data (code, name, credit hours) and names no student. Writes stay
// on ADMINS.
/*
 * Cached globally. The subject catalogue is on the bootstrap path of three
 * portals — the student, parent and faculty loaders all request it inside
 * their opening Promise.all — and it changes when a registrar edits the
 * catalogue, a few times a semester.
 *
 * Global sharing is correct because the handler ignores who is asking, and the
 * cache sits AFTER authorize, so the role gate is never bypassed. See
 * middlewares/cache.middleware.js.
 */
router.get(
    "/",
    authenticate,
    authorize(...ACADEMIC_REFERENCE),
    cached({ ttl: TTL.REFERENCE, tags: [TAGS.SUBJECTS, TAGS.ACADEMICS], scope: "global" }),
    subjectController.getSubjects
);

router.get("/search", authenticate, authorize(...ACADEMIC_REFERENCE), subjectController.searchSubjects);

router.get("/:id", authenticate, authorize(...ACADEMIC_REFERENCE), subjectController.getSubject);

// Writes drop the whole academic-structure group: subject names are joined
// into enrolments, timetables, the overview and the search catalogue, so
// invalidating `subjects` alone would leave a renamed subject stale in all of
// them. See the same reasoning in academicStructureRoutes.js.
const flushSubjects = invalidates(ACADEMIC_STRUCTURE_TAGS);

router.post("/", authenticate, authorize(...ADMINS), flushSubjects, subjectController.createSubject);

router.put("/:id", authenticate, authorize(...ADMINS), flushSubjects, subjectController.updateSubject);

router.delete("/:id", authenticate, authorize(...ADMINS), flushSubjects, subjectController.deleteSubject);

module.exports = router;