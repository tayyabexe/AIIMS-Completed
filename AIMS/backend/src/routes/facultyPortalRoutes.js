// /api/faculty - the teacher portal's own read/write surface.
//
// These endpoints are scoped to the signed-in teacher's timetable rather than
// filtered on the client, which is what the portal used to do: it pulled
// /api/timetables, /api/students, /api/subjects and /api/sections in full and
// worked out the teacher's classes in the browser.
//
// ADMIN_TEACHER, not ADMINS: a teacher is the primary caller here. Admins are
// allowed through so they can open a teacher's portal with ?teacher_id=.

const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMIN_TEACHER } = require("../config/roles");

const {
    getDashboard,
    getNotifications,
    getActivity,
    getClasses,
    getClassRoster,
    getAttendanceSheet,
    saveAttendance,
    getAttendanceTrend,
    getExams,
    createExam,
    getMarksSheet,
    saveMarks,
    getStudents,
    getReport,
    getProfile,
    updateProfile,
    getBadges
} = require("../controllers/facultyPortalController");

router.use(authenticate, authorize(...ADMIN_TEACHER));

// ================= DASHBOARD =================
router.get("/dashboard", getDashboard);
// Own notifications merged with the announcements addressed to this role.
router.get("/notifications", getNotifications);
// What this teacher has actually done: registers marked, marks entered,
// exams scheduled on their subjects, announcements they posted.
router.get("/activity", getActivity);

// The counts behind the sidebar bubbles: unread notifications, and assignments
// that have appeared since this teacher last opened that screen.
router.get("/badges", getBadges);

// ================= PROFILE =================
// The teacher's own record. PUT is limited to contact details and
// specialization; name, designation and department are HR data and stay on
// PUT /api/teachers/:id.
router.get("/profile", getProfile);
router.put("/profile", updateProfile);

// ================= MY CLASSES =================
router.get("/classes", getClasses);
router.get("/classes/:subjectId/:sectionId", getClassRoster);

// ================= ATTENDANCE =================
// `/attendance/trend` is declared before `/attendance` only for readability;
// they are different paths, so order does not matter here.
router.get("/attendance/trend", getAttendanceTrend);
router.get("/attendance", getAttendanceSheet);
router.post("/attendance", saveAttendance);

// ================= MARKS =================
// Exams are per-subject; a marks sheet is one exam for one of that subject's
// sections, which is why both ids are required.
router.get("/exams", getExams);
router.post("/exams", createExam);
router.get("/marks", getMarksSheet);
router.post("/marks", saveMarks);

// ================= STUDENTS =================
router.get("/students", getStudents);

// ================= REPORTS =================
router.get("/reports", getReport);

module.exports = router;
