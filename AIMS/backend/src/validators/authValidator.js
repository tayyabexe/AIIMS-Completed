const { body } = require("express-validator");

const registerValidation = [
    body("email")
        .isEmail()
        .withMessage("Please enter a valid email"),

    body("password")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters"),

    body("role_id")
        .notEmpty()
        .withMessage("Role ID is required"),

    /*
     * Optional, because an account that genuinely has no name — a service
     * account, an integration — must still be creatable, and because the
     * role-record backfill supplies one for students, teachers and parents.
     *
     * It matters most for the case that has no role record at all: an
     * administrator. Supplying it here is what stops the frontend falling back
     * to deriving "Admin2" from the email address.
     */
    body("full_name")
        .optional({ nullable: true, checkFalsy: true })
        .isLength({ min: 2, max: 150 })
        .withMessage("Full name must be between 2 and 150 characters")
        .trim()
];

const loginValidation = [
    body("email")
        .isEmail()
        .withMessage("Please enter a valid email"),

    body("password")
        .notEmpty()
        .withMessage("Password is required")
];

module.exports = {
    registerValidation,
    loginValidation
};