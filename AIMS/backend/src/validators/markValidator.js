const { body } = require("express-validator");

const enterMarksValidation = [

    body("exam_id")
        .isInt()
        .withMessage("Exam ID is required."),

    body("student_id")
        .isInt()
        .withMessage("Student ID is required."),

    body("obtained_marks")
        .isFloat({ min: 0 })
        .withMessage("Obtained marks must be valid."),

    body("entered_by")
        .isInt()
        .withMessage("Entered By is required.")

];

module.exports = {

    enterMarksValidation

};