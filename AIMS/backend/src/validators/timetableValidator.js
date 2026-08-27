const { body } = require("express-validator");
const { findSlot, findSlotByStart, describeSlots } = require("../config/timetableSlots");

const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Lectures may only be booked on the canonical period grid, so "end after
// start" is no longer the test - the pair has to name a slot exactly. This
// replaces the old check, which happily accepted 09:07-10:14 and let two rows
// for the same section overlap.
const mustBeACanonicalSlot = (value, { req }) => {

    const start = req.body.start_time;

    // start_time has its own required/format rules; don't double-report here.
    if (!start || !value) {
        return true;
    }

    if (findSlot(start, value)) {
        return true;
    }

    // A start that is on the grid with a mismatched end is the common mistake,
    // so say what the end should have been rather than listing every slot.
    const slotByStart = findSlotByStart(start);

    if (slotByStart) {
        throw new Error(
            `Slot ${slotByStart.slot_number} starts at ${slotByStart.start_time}, so end_time must be ${slotByStart.end_time}`
        );
    }

    throw new Error(
        `start_time and end_time must match a timetable slot. Valid slots are: ${describeSlots()}`
    );

};

// On update, start_time and end_time have to move together - changing only one
// would silently take the row off the grid.
const bothTimesOrNeither = (value, { req }) => {

    const hasStart = req.body.start_time !== undefined;
    const hasEnd = req.body.end_time !== undefined;

    if (hasStart !== hasEnd) {
        throw new Error("start_time and end_time must be updated together");
    }

    return true;

};

const createTimetableValidation = [

    body("subject_id")
        .notEmpty().withMessage("Subject ID is required")
        .bail()
        .isInt({ min: 1 }).withMessage("Subject ID must be a positive integer"),

    body("section_id")
        .notEmpty().withMessage("Section ID is required")
        .bail()
        .isInt({ min: 1 }).withMessage("Section ID must be a positive integer"),

    body("teacher_id")
        .notEmpty().withMessage("Teacher ID is required")
        .bail()
        .isInt({ min: 1 }).withMessage("Teacher ID must be a positive integer"),

    body("classroom_id")
        .optional()
        .isInt({ min: 1 }).withMessage("Classroom ID must be a positive integer"),

    body("day_of_week")
        .notEmpty().withMessage("Day of week is required")
        .bail()
        .isIn(DAYS).withMessage(`Day of week must be one of: ${DAYS.join(", ")}`),

    body("start_time")
        .notEmpty().withMessage("Start time is required")
        .bail()
        .matches(TIME_PATTERN).withMessage("Start time must be in HH:mm or HH:mm:ss format"),

    body("end_time")
        .notEmpty().withMessage("End time is required")
        .bail()
        .matches(TIME_PATTERN).withMessage("End time must be in HH:mm or HH:mm:ss format")
        .bail()
        .custom(mustBeACanonicalSlot)

];

const updateTimetableValidation = [

    body("subject_id").optional().isInt({ min: 1 })
        .withMessage("Subject ID must be a positive integer"),

    body("section_id").optional().isInt({ min: 1 })
        .withMessage("Section ID must be a positive integer"),

    body("teacher_id").optional().isInt({ min: 1 })
        .withMessage("Teacher ID must be a positive integer"),

    body("classroom_id").optional().isInt({ min: 1 })
        .withMessage("Classroom ID must be a positive integer"),

    body("day_of_week").optional().isIn(DAYS)
        .withMessage(`Day of week must be one of: ${DAYS.join(", ")}`),

    body("start_time").optional().matches(TIME_PATTERN)
        .withMessage("Start time must be in HH:mm or HH:mm:ss format")
        .bail()
        .custom(bothTimesOrNeither),

    body("end_time").optional().matches(TIME_PATTERN)
        .withMessage("End time must be in HH:mm or HH:mm:ss format")
        .bail()
        .custom(bothTimesOrNeither)
        .bail()
        .custom(mustBeACanonicalSlot)

];

module.exports = {
    createTimetableValidation,
    updateTimetableValidation,
    DAYS
};
