const express = require("express");

const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");

const {

    enterMarks,
    getStudentMarks,
    getStudentAssessments,
    getMarksSummary,
    updateMarks,
    verifyMarks

} = require("../controllers/markController");

const authorize = require("../middlewares/rbac.middleware");
const { ADMIN_TEACHER, ADMINS } = require("../config/roles");

const {

    enterMarksValidation

} = require("../validators/markValidator");

const {
    requireStudentAccess
} = require("../middlewares/selfScope.middleware");

/*
 * WHO MAY WRITE A MARK
 * --------------------
 * These three routes carried `authenticate` and nothing else. Any signed-in
 * account was therefore a marks clerk, and that was confirmed against the
 * running server with a real student's token before it was closed: the student
 * entered a 50/50 for themselves on an assignment, VERIFIED their own Mid-Term,
 * and changed an existing 45 to 50. All three returned 200.
 *
 * `requireStudentAccess` on the read route below is what these were missing —
 * ownership was enforced on the way out and not at all on the way in.
 */

// ================= ENTER MARKS =================
// Entering and correcting a score is the teacher's job, and an admin's.

router.post(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    enterMarksValidation,
    enterMarks
);
// ================= GET STUDENT MARKS =================

// ================= MARKS SUMMARY (BULK) =================
// One aggregated score per student, for staff screens that list many students.
// Declared before "/student/:student_id" so it is not captured by it.
router.get(
    "/summary",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getMarksSummary
);

// Same ownership rule as documents: staff read anyone, a student only their
// own marks, a parent only a ward's.
router.get(
    "/student/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    getStudentMarks
);

// ================= STUDENT ASSESSMENT LEDGER =================
// The same student, read the other way round: every assessment their registered
// courses carry, whether or not it has been marked. Behind the identical
// ownership check, and the controller applies the identical Published gate to
// the scores - see the long note there for why an ungraded sitting still has to
// come back. Declared after "/student/:student_id" so the longer path wins;
// Express matches in declaration order and "/student/:student_id" would not
// have captured this one anyway, but the order says the intent.

router.get(
    "/student/:student_id/assessments",
    authenticate,
    requireStudentAccess("student_id"),
    getStudentAssessments
);

// ================= UPDATE MARKS =================

router.put(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    updateMarks
);

// ================= VERIFY MARKS =================
// Admins only. Verification is the sign-off on somebody else's work: a teacher
// countersigning their own entry is not a check, and a mark that is Verified is
// one step from being released to the student.

router.put(
    "/verify/:id",
    authenticate,
    authorize(...ADMINS),
    verifyMarks
);
module.exports = router;