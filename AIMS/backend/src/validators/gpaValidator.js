const { body } = require("express-validator");

// The gpa/cgpa columns are decimal(3,2), so 0.00 - 4.00 is the usable range.
const GPA_MIN = 0;
const GPA_MAX = 4;

const gradePoint = (field, label) =>
    body(field)
        .notEmpty().withMessage(`${label} is required`)
        .bail()
        .isFloat({ min: GPA_MIN, max: GPA_MAX })
        .withMessage(`${label} must be between ${GPA_MIN} and ${GPA_MAX}`);

const optionalGradePoint = (field, label) =>
    body(field)
        .optional()
        .isFloat({ min: GPA_MIN, max: GPA_MAX })
        .withMessage(`${label} must be between ${GPA_MIN} and ${GPA_MAX}`);

const createGPAValidation = [

    body("student_id")
        .notEmpty().withMessage("Student ID is required")
        .bail()
        .isInt({ min: 1 }).withMessage("Student ID must be a positive integer"),

    body("semester_id")
        .notEmpty().withMessage("Semester ID is required")
        .bail()
        .isInt({ min: 1 }).withMessage("Semester ID must be a positive integer"),

    gradePoint("gpa", "GPA"),
    gradePoint("cgpa", "CGPA")

];

const updateGPAValidation = [

    body("student_id").optional().isInt({ min: 1 })
        .withMessage("Student ID must be a positive integer"),

    body("semester_id").optional().isInt({ min: 1 })
        .withMessage("Semester ID must be a positive integer"),

    optionalGradePoint("gpa", "GPA"),
    optionalGradePoint("cgpa", "CGPA")

];

module.exports = {
    GPA_MIN,
    GPA_MAX,
    createGPAValidation,
    updateGPAValidation
};
