const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { requireStudentAccess } = require("../middlewares/selfScope.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");

const {
    attendanceValidation
} = require("../validators/attendanceValidator");

const {

    markAttendance,
    getAttendance,
    getAttendanceById,
    getStudentAttendance,
    updateAttendance,
    deleteAttendance,
    getAttendancePercentage,
    getAttendanceReport

} = require("../controllers/attendanceController");

// ================= MARK ATTENDANCE =================
router.post(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    attendanceValidation,
    markAttendance
);

// ================= GET ALL ATTENDANCE =================
router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getAttendance
);

// ================= GET STUDENT ATTENDANCE =================
// These three name a student in the URL and were `authenticate` only, so any
// signed-in student could read another student's attendance by changing the id.
// requireStudentAccess lets staff through, a student through for their own id
// and a parent through for a ward.
router.get(
    "/student/:id",
    authenticate,
    requireStudentAccess("id"),
    getStudentAttendance
);

// ================= ATTENDANCE REPORT =================
router.get(
    "/report/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    getAttendanceReport
);

// ================= ATTENDANCE PERCENTAGE =================
router.get(
    "/percentage/:id",
    authenticate,
    requireStudentAccess("id"),
    getAttendancePercentage
);

// ================= GET ATTENDANCE BY ID =================
router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    getAttendanceById
);

// ================= UPDATE ATTENDANCE =================
router.put(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    updateAttendance
);

// ================= DELETE ATTENDANCE =================
router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    deleteAttendance
);

module.exports = router;
