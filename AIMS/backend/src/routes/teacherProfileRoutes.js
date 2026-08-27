const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");

const {
    createTeacherProfileValidation,
    updateTeacherProfileValidation
} = require("../validators/teacherModuleValidator");

const teacherProfileController = require("../controllers/teacherProfileController");

router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherProfileController.getProfiles
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherProfileController.getProfile
);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    createTeacherProfileValidation,
    teacherProfileController.createProfile
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    updateTeacherProfileValidation,
    teacherProfileController.updateProfile
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    teacherProfileController.deleteProfile
);

module.exports = router;
