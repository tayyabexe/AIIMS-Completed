const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");

const {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead
} = require("../controllers/notificationController");

// Every route here is self-scoped by the token, so no role check is needed:
// each portal reads and acknowledges only its own user's notifications.

// ================= LIST OWN NOTIFICATIONS =================
router.get(
    "/",
    authenticate,
    getMyNotifications
);

// ================= MARK ALL AS READ =================
// Declared before "/:id/read" so "read-all" is never taken as an id.
router.put(
    "/read-all",
    authenticate,
    markAllNotificationsRead
);

// ================= MARK ONE AS READ =================
router.put(
    "/:id/read",
    authenticate,
    markNotificationRead
);

module.exports = router;
