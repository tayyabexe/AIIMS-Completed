/*
 * The qualification registry: which subjects each teacher may teach.
 *
 * WHAT THESE ROUTES REPLACE
 * -------------------------
 * Three routes with **no authenticate() and no authorize() on any of them**.
 * `POST /api/teacher-subjects` accepted a body from any browser tab on the
 * internet that could reach the port, and `DELETE
 * /api/teacher-subjects/3/12/4` removed a qualification the same way. That is
 * the same hole the academic-structure module closed for programmes, batches
 * and sections; this router was missed because nothing in the portal called
 * it, so nothing ever exercised it.
 *
 * WHO CAN DO WHAT
 * ---------------
 * Writes are ADMINS. Recording who may teach a subject is an academic-council
 * decision, and it feeds the staffing shortlist that decides who ends up in
 * front of a class.
 *
 * Reads are ADMIN_TEACHER. A teacher seeing which subjects they are recorded
 * for is reasonable and is the fastest way for a wrong entry to be reported.
 * The rows carry a name, a designation and subject codes - no personal data
 * about anybody else.
 *
 * The delete no longer takes a batch id: qualification is not batch-scoped
 * (migration `…140000`).
 */

const express = require("express");

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");

const controller = require("../controllers/teacherSubjectController");

const router = express.Router();

router.get("/", authenticate, authorize(...ADMIN_TEACHER), controller.listQualifications);

/*
 * Declared before any "/:something" route so "subject" is never read as an id.
 * This is the registry from the staffing direction: who may teach CS-501.
 */
router.get(
    "/subject/:subjectId",
    authenticate,
    authorize(...ADMIN_TEACHER),
    controller.listTeachersForSubject
);

router.post("/", authenticate, authorize(...ADMINS), controller.grant);

/*
 * The whole set for one teacher, replaced in one call. This is what the editor
 * submits - see setQualifications for why a set beats a list of deltas.
 */
router.put(
    "/teacher/:teacherId",
    authenticate,
    authorize(...ADMINS),
    controller.setQualifications
);

router.delete(
    "/:teacherId/:subjectId",
    authenticate,
    authorize(...ADMINS),
    controller.revoke
);

module.exports = router;
