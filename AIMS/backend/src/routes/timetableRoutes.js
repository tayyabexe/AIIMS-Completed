const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER_STUDENT } = require("../config/roles");

const {
    createTimetableValidation,
    updateTimetableValidation
} = require("../validators/timetableValidator");

const timetableController = require("../controllers/timetableController");

router.get("/", authenticate, authorize(...ADMIN_TEACHER_STUDENT), timetableController.getTimetables);

// The caller's own live timetable. No authorize() list here because a parent
// (role 5) needs it too and the service scopes every role itself - a student
// gets their section, a teacher their classes, a parent their child's, and
// anyone without a timetable view is refused there. Declared before "/:id" so
// "current" is not read as an id.
router.get("/current", authenticate, timetableController.getCurrentTimetable);

router.get("/:id", authenticate, authorize(...ADMIN_TEACHER_STUDENT), timetableController.getTimetable);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    createTimetableValidation,
    timetableController.createTimetable
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    updateTimetableValidation,
    timetableController.updateTimetable
);

router.delete("/:id", authenticate, authorize(...ADMINS), timetableController.deleteTimetable);

module.exports = router;
