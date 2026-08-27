const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS } = require("../config/roles");

// `receiveAvatar` buffers to memory and validates by file signature; the old
// disk-writing `imageUpload` is no longer used here.
const { receiveAvatar } = require("../middlewares/upload.middleware");

const userController = require("../controllers/userController");

// ================= OWN ACCOUNT =================
//
// Self-service profile routes for every portal. No authorize() call: each
// handler resolves the account from the token, so a student, teacher or parent
// reaches only their own row. All of these are declared before "/:id" so that
// "me" is not captured as an id.

router.get(
    "/me",
    authenticate,
    userController.getMyProfile
);

router.put(
    "/me",
    authenticate,
    userController.updateMyProfile
);

// Settings. Declared before "/:id" for the same reason as "/me".
router.get(
    "/me/preferences",
    authenticate,
    userController.getMyPreferences
);

router.put(
    "/me/preferences",
    authenticate,
    userController.updateMyPreferences
);

// multer rejects a non-image or an oversized file by calling back with an
// error, which Express would otherwise surface as a 500. This turns both into
// the 400 the portal can show next to the file picker.
/*
 * `receiveAvatar` replaces the inline multer wrapper that used to be here. It
 * buffers the upload in memory rather than writing it to disk (the bytes now
 * go into the row), verifies the file really is an image by its signature
 * rather than by its claimed Content-Type, and turns every multer failure into
 * a 400 — which is what the wrapper it replaced was doing by hand for the
 * size-limit case alone. See middlewares/upload.middleware.js.
 */
router.post(
    "/me/profile-picture",
    authenticate,
    receiveAvatar,
    userController.uploadMyProfilePicture
);

/*
 * The avatar itself. Authenticated, but not restricted per-viewer — every
 * portal already displays other people's photographs (a class roster, a
 * teacher list), so scoping this would break those screens without hiding
 * anything they do not already show.
 *
 * Declared before the `/:id` record routes below. Express matches in order,
 * and a bare "/:id" would otherwise swallow "/:id/avatar" only if it were
 * declared with a wildcard — it is not, but keeping the specific route first
 * is the habit that stops that class of bug appearing later.
 */
router.get(
    "/:id/avatar",
    authenticate,
    userController.getAvatar
);

router.delete(
    "/me/profile-picture",
    authenticate,
    userController.deleteMyProfilePicture
);

// User records are administrative data: Super Admin and Admin only.
router.post(
    "/",
    authenticate,
    authorize(...ADMINS),
    userController.createUser
);

router.get(
    "/",
    authenticate,
    authorize(...ADMINS),
    userController.getAllUsers
);

router.get(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    userController.getUserById
);

router.put(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    userController.updateUser
);

router.delete(
    "/:id",
    authenticate,
    authorize(...ADMINS),
    userController.deleteUser
);

/*
 * Lift a lockout imposed by failed sign-ins.
 *
 * Admin-only and deliberately manual: the lock exists precisely so that
 * somebody guessing at an account cannot simply wait it out, so there is no
 * timer that expires it and no route a signed-out user can reach.
 */
router.post(
    "/:id/unlock",
    authenticate,
    authorize(...ADMINS),
    userController.unlockUser
);

module.exports = router;
