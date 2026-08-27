const { body } = require("express-validator");

const createExamValidation = [

    body("exam_name")
        .notEmpty()
        .withMessage("Exam name is required."),

    body("exam_type")
        .notEmpty()
        .withMessage("Exam type is required."),

    body("semester_id")
        .isInt()
        .withMessage("Semester ID must be an integer."),

    body("subject_id")
        .isInt()
        .withMessage("Subject ID must be an integer."),

    body("exam_date")
        .isDate()
        .withMessage("Valid exam date is required."),

    body("total_marks")
        .isInt({ min: 1 })
        .withMessage("Total marks must be greater than 0.")

];

module.exports = {

    createExamValidation

};