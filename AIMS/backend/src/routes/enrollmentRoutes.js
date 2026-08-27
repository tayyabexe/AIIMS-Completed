const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const {
    scopeStudentToSelf,
    requireStudentAccess
} = require("../middlewares/selfScope.middleware");
const { ADMIN_TEACHER_STUDENT } = require("../config/roles");

const {
    getEnrollments,
    getStudentEnrollments
} = require("../controllers/enrollmentController");

// ================= GET ENROLLMENTS =================
// Filters: student_id, semester_id, subject_id, status.
// scopeStudentToSelf pins a STUDENT caller to their own rows, so an unfiltered
// request returns that student's courses instead of every enrollment on record.
router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER_STUDENT),
    scopeStudentToSelf,
    getEnrollments
);

// ================= GET A STUDENT'S ENROLLMENTS =================
// Staff may read any student; a student only their own; a parent only a ward.
router.get(
    "/student/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    getStudentEnrollments
);

module.exports = router;
