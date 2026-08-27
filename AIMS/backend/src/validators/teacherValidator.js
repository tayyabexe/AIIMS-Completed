const { body } = require("express-validator");

// A teacher can be created two ways: by linking an existing employee record
// (employee_id), or by supplying the person's details so the user, employee and
// teacher rows are created together. employee_id is therefore required only
// when no first_name was sent.
const createTeacherValidation = [

    body("employee_id")
        .if(body("first_name").not().exists({ checkFalsy: true }))
        .notEmpty()
        .withMessage("Either employee_id or the teacher's details are required")
        .bail()
        .isInt({ min: 1 })
        .withMessage("Employee ID must be a positive integer"),

    body("first_name")
        .if(body("employee_id").not().exists({ checkFalsy: true }))
        .notEmpty()
        .withMessage("First name is required")
        .bail()
        .isLength({ max: 100 })
        .withMessage("First name must be 100 characters or fewer"),

    body("last_name")
        .if(body("employee_id").not().exists({ checkFalsy: true }))
        .notEmpty()
        .withMessage("Last name is required"),

    body("email")
        .if(body("employee_id").not().exists({ checkFalsy: true }))
        .isEmail()
        .withMessage("A valid email is required"),

    body("password")
        .if(body("employee_id").not().exists({ checkFalsy: true }))
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters"),

    body("department_id")
        .if(body("employee_id").not().exists({ checkFalsy: true }))
        .isInt({ min: 1 })
        .withMessage("Department is required"),

    body("specialization")
        .optional()
        .isLength({ max: 255 })
        .withMessage("Specialization must be 255 characters or fewer")

];

const updateTeacherValidation = [

    body("employee_id")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Employee ID must be a positive integer"),

    body("specialization")
        .optional()
        .isLength({ max: 255 })
        .withMessage("Specialization must be 255 characters or fewer"),

    // Employee-side fields, all optional on update.
    body("first_name").optional().isLength({ max: 100 }),
    body("last_name").optional().isLength({ max: 100 }),
    body("department_id").optional().isInt({ min: 1 }),
    body("designation").optional().isLength({ max: 100 }),
    body("employment_status")
        .optional()
        .isIn(["Active", "On Leave", "Terminated", "Retired"])
        .withMessage("Invalid employment status")

];

module.exports = {
    createTeacherValidation,
    updateTeacherValidation
};
