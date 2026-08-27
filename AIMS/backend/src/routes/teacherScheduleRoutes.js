const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");

const {
    createTeacherScheduleValidation,
    updateTeacherScheduleValidation
} = require("../validators/teacherModuleValidator");

const teacherScheduleController = require("../controllers/teacherScheduleController");

router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherScheduleController.getSchedules
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherScheduleController.getSchedule
);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    createTeacherScheduleValidation,
    teacherScheduleController.createSchedule
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    updateTeacherScheduleValidation,
    teacherScheduleController.updateSchedule
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    teacherScheduleController.deleteSchedule
);

module.exports = router;
