const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS } = require("../config/roles");

const feeStructureController = require("../controllers/feeStructureController");

router.get(
    "/",
    authenticate,
    authorize(...ADMINS),
    feeStructureController.getFeeStructures
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    feeStructureController.getFeeStructure
);

router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    feeStructureController.createFeeStructure
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    feeStructureController.updateFeeStructure
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    feeStructureController.deleteFeeStructure
);

module.exports = router;