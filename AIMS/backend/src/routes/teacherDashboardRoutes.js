// const express = require("express");
// const router = express.Router();


// const {
//     getTeacherDashboard
// } = require("../controllers/teacherDashboardController");


// // Teacher Dashboard
// router.get(
//     "/",
//     verifyToken,
//     authorizeRole("teacher"),
//     getTeacherDashboard
// );


// module.exports = router;
const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_TEACHER } = require("../config/roles");

const teacherDashboardController = require("../controllers/teacherDashboardController");

router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_TEACHER),
    teacherDashboardController.getDashboard
);

module.exports = router;