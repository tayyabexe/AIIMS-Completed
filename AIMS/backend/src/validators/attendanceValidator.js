const { body } = require("express-validator");

const attendanceValidation = [

    body("student_id")
        .notEmpty()
        .withMessage("Student ID is required"),

    body("subject_id")
        .notEmpty()
        .withMessage("Subject ID is required"),

    body("timetable_id")
        .notEmpty()
        .withMessage("Timetable ID is required"),

    body("att_date")
        .notEmpty()
        .withMessage("Attendance Date is required"),

    body("status")
        .notEmpty()
        .withMessage("Attendance Status is required"),

    body("marked_by")
        .notEmpty()
        .withMessage("Teacher ID is required")

];

module.exports = {
    attendanceValidation
};