const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS } = require("../config/roles");

const feeReportController = require("../controllers/feeReportController");

router.get(
    "/",
    authenticate,
    authorize(...ADMINS),
    feeReportController.getReports
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    feeReportController.getReport
);

module.exports = router;
