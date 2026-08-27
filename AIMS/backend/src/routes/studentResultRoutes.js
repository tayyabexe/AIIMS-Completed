const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_STUDENT } = require("../config/roles");
const { scopeStudentToSelf } = require("../middlewares/selfScope.middleware");

const studentResultController = require("../controllers/studentResultController");

router.get(
    "/",
    authenticate,
    authorize(...ADMIN_STUDENT),
    scopeStudentToSelf,
    studentResultController.getResults
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_STUDENT),
    scopeStudentToSelf,
    studentResultController.getResult
);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    studentResultController.createResult
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    studentResultController.updateResult
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    studentResultController.deleteResult
);

module.exports = router;
