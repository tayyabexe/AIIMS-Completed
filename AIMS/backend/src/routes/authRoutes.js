const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");

const {
    registerValidation,
    loginValidation
} = require("../validators/authValidator");

const {

    register,
    login,
    logout,
    changePassword,
    forgotPassword,
    resetPassword

} = require("../controllers/authController");

// ================= REGISTER =================
router.post(
    "/register",
    registerValidation,
    register
);

// ================= LOGIN =================
router.post(
    "/login",
    loginValidation,
    login
);

// ================= LOGOUT =================
router.post(
    "/logout",
    logout
);

// ================= PROFILE =================
router.get("/profile", authenticate, (req, res) => {

    res.status(200).json({

        success: true,

        message: "Protected Route Accessed",

        user: req.user

    });

});

// ================= CHANGE PASSWORD =================
router.put(
    "/change-password",
    authenticate,
    changePassword
);

// ================= FORGOT PASSWORD =================
router.post(
    "/forgot-password",
    forgotPassword
);

// ================= RESET PASSWORD =================
router.post(
    "/reset-password",
    resetPassword
);

// ================= ADMIN ONLY =================
router.get(
    "/admin",
    authenticate,
    authorize(1, 2),
    (req, res) => {

        res.json({

            success: true,

            message: "Welcome Admin"

        });

    }
);

module.exports = router;
