const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ADMIN_STUDENT } = require("../config/roles");
const { scopeStudentToSelf } = require("../middlewares/selfScope.middleware");

const {
    createGPAValidation,
    updateGPAValidation
} = require("../validators/gpaValidator");

const gpaController = require("../controllers/gpaController");

router.get(
    "/",
    authenticate,
    authorize(...ADMIN_STUDENT),
    scopeStudentToSelf,
    gpaController.getGPAs
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMIN_STUDENT),
    scopeStudentToSelf,
    gpaController.getGPA
);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    createGPAValidation,
    gpaController.createGPA
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    gpaController.updateGPA
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    gpaController.deleteGPA
);

module.exports = router;
