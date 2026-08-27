const { body } = require("express-validator");

const DAYS = [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday"
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const id = (field, label, required = true) => {
    const chain = body(field);
    if (required) {
        chain.notEmpty().withMessage(`${label} is required`).bail();
    } else {
        chain.optional();
    }
    return chain.isInt({ min: 1 }).withMessage(`${label} must be a positive integer`);
};

// ======================= TEACHER ASSIGNMENT =======================

const createTeacherAssignmentValidation = [
    id("teacher_id", "Teacher ID"),
    id("subject_id", "Subject ID"),
    id("batch_id", "Batch ID"),
    id("section_id", "Section ID", false),
    body("assigned_date").optional().isISO8601()
        .withMessage("Assigned date must be a valid date (YYYY-MM-DD)")
];

const updateTeacherAssignmentValidation = [
    id("teacher_id", "Teacher ID", false),
    id("subject_id", "Subject ID", false),
    id("batch_id", "Batch ID", false),
    id("section_id", "Section ID", false),
    body("assigned_date").optional().isISO8601()
        .withMessage("Assigned date must be a valid date (YYYY-MM-DD)")
];

// ========================= TEACHER PROFILE ========================

const createTeacherProfileValidation = [
    id("teacher_id", "Teacher ID"),
    body("qualification").optional().isLength({ max: 255 })
        .withMessage("Qualification must be 255 characters or fewer"),
    body("specialization").optional().isLength({ max: 255 })
        .withMessage("Specialization must be 255 characters or fewer"),
    body("experience_years").optional().isInt({ min: 0, max: 80 })
        .withMessage("Experience years must be between 0 and 80")
];

const updateTeacherProfileValidation = [
    body("qualification").optional().isLength({ max: 255 })
        .withMessage("Qualification must be 255 characters or fewer"),
    body("specialization").optional().isLength({ max: 255 })
        .withMessage("Specialization must be 255 characters or fewer"),
    body("experience_years").optional().isInt({ min: 0, max: 80 })
        .withMessage("Experience years must be between 0 and 80")
];

// ======================== TEACHER SCHEDULE ========================

// end_time is only compared when start_time is present in the same payload.
const endAfterStart = (value, { req }) => {
    const start = req.body.start_time;
    if (!start || !value) return true;
    if (String(value) <= String(start)) {
        throw new Error("end_time must be later than start_time");
    }
    return true;
};

const createTeacherScheduleValidation = [
    id("teacher_id", "Teacher ID"),
    id("subject_id", "Subject ID"),
    body("day")
        .notEmpty().withMessage("Day is required")
        .bail()
        .isIn(DAYS).withMessage(`Day must be one of: ${DAYS.join(", ")}`),
    body("start_time")
        .notEmpty().withMessage("Start time is required")
        .bail()
        .matches(TIME_PATTERN).withMessage("Start time must be in HH:mm or HH:mm:ss format"),
    body("end_time")
        .notEmpty().withMessage("End time is required")
        .bail()
        .matches(TIME_PATTERN).withMessage("End time must be in HH:mm or HH:mm:ss format")
        .bail()
        .custom(endAfterStart),
    body("room").optional().isLength({ max: 50 })
        .withMessage("Room must be 50 characters or fewer")
];

const updateTeacherScheduleValidation = [
    id("teacher_id", "Teacher ID", false),
    id("subject_id", "Subject ID", false),
    body("day").optional().isIn(DAYS)
        .withMessage(`Day must be one of: ${DAYS.join(", ")}`),
    body("start_time").optional().matches(TIME_PATTERN)
        .withMessage("Start time must be in HH:mm or HH:mm:ss format"),
    body("end_time").optional().matches(TIME_PATTERN)
        .withMessage("End time must be in HH:mm or HH:mm:ss format")
        .bail()
        .custom(endAfterStart),
    body("room").optional().isLength({ max: 50 })
        .withMessage("Room must be 50 characters or fewer")
];

module.exports = {
    DAYS,
    createTeacherAssignmentValidation,
    updateTeacherAssignmentValidation,
    createTeacherProfileValidation,
    updateTeacherProfileValidation,
    createTeacherScheduleValidation,
    updateTeacherScheduleValidation
};
