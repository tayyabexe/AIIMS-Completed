const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ROLES } = require("../config/roles");

const announcementController = require("../controllers/announcementController");

// Reading is open to every signed-in role; the controller restricts each
// caller to the announcements addressed to their role, or to everyone.
router.get(
    "/",
    authenticate,
    announcementController.getAnnouncements
);

router.get(
    "/:id",
    authenticate,
    announcementController.getAnnouncement
);

// Teachers publish announcements to their classes, so they can create and
// edit alongside Admin. Deleting stays administrative.
router.post(
    "/",
    authenticate,
    authorize(...ADMINS, ROLES.TEACHER),
    announcementController.createAnnouncement
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS, ROLES.TEACHER),
    announcementController.updateAnnouncement
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    announcementController.deleteAnnouncement
);

module.exports = router;
