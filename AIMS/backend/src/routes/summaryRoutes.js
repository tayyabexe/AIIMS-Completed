const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const {
    ADMINS,
    ADMIN_TEACHER,
    ADMIN_STUDENT,
    ADMIN_TEACHER_STUDENT
} = require("../config/roles");

const {
    getAttendanceSummary,
    getFeeStatusSummary,
    getTeacherWorkload,
    getClassPerformance
} = require("../controllers/summaryController");

// Per-student attendance percentages, already aggregated by the database.
router.get(
    "/attendance",
    authenticate,
    authorize(...ADMIN_TEACHER_STUDENT),
    getAttendanceSummary
);

// Payable, paid and remaining balance per student fee row.
router.get(
    "/fee-status",
    authenticate,
    authorize(...ADMIN_STUDENT),
    getFeeStatusSummary
);

// Weekly sessions and contact hours per teacher.
router.get(
    "/teacher-workload",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getTeacherWorkload
);

// Average score and pass rate per section and subject.
router.get(
    "/class-performance",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getClassPerformance
);

module.exports = router;
