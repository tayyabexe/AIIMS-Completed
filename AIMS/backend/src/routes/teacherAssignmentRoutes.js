const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");

const {
    createTeacherAssignmentValidation,
    updateTeacherAssignmentValidation
} = require("../validators/teacherModuleValidator");

const teacherAssignmentController = require("../controllers/teacherAssignmentController");

router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherAssignmentController.getAssignments
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherAssignmentController.getAssignment
);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    createTeacherAssignmentValidation,
    teacherAssignmentController.createAssignment
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    updateTeacherAssignmentValidation,
    teacherAssignmentController.updateAssignment
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    teacherAssignmentController.deleteAssignment
);

module.exports = router;