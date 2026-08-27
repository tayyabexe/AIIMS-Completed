const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");

const teacherController = require("../controllers/teacherController");

const {
    createTeacherValidation,
    updateTeacherValidation
} = require("../validators/teacherValidator");

// Reads: Super Admin, Admin, Teacher, HR
router.get(
    "/",
    authenticate,
    authorize(1, 2, 3, 6),
    teacherController.getTeachers
);

router.get(
    "/:id",
    authenticate,
    authorize(1, 2, 3, 6),
    teacherController.getTeacher
);

// Writes: Super Admin, Admin, HR
router.post(
    "/",
    authenticate,
    authorize(1, 2, 6),
    createTeacherValidation,
    teacherController.createTeacher
);

router.put(
    "/:id",
    authenticate,
    authorize(1, 2, 6),
    updateTeacherValidation,
    teacherController.updateTeacher
);

router.delete(
    "/:id",
    authenticate,
    authorize(1, 2),
    teacherController.deleteTeacher
);

module.exports = router;
