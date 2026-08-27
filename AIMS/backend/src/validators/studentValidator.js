const { body } = require("express-validator");

const registerStudentValidation = [

    body("registration_number")
        .notEmpty()
        .withMessage("Registration Number is required"),

    body("first_name")
        .notEmpty()
        .withMessage("First Name is required"),

    body("last_name")
        .notEmpty()
        .withMessage("Last Name is required"),

    body("cnic_bform")
        .notEmpty()
        .withMessage("CNIC/B-Form is required"),

    body("program_id")
        .isInt()
        .withMessage("Program ID is required"),

    body("batch_id")
        .isInt()
        .withMessage("Batch ID is required"),

        body("current_semester_id")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Current Semester ID must be a valid integer"),


];

module.exports = {

    registerStudentValidation

};