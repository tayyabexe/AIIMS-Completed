const { body } = require("express-validator");

// Without this, a missing email reaches Sequelize as undefined and throws
// "WHERE parameter \"email\" has invalid \"undefined\" value" as a 500.
const parentLoginValidation = [

    body("email")
        .notEmpty().withMessage("Email is required")
        .bail()
        .isEmail().withMessage("Please enter a valid email"),

    body("password")
        .notEmpty().withMessage("Password is required")

];

module.exports = {
    parentLoginValidation
};
