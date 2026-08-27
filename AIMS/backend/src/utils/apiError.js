const { validationResult } = require("express-validator");

// Returns true and sends a 400 when express-validator found problems.
const rejectIfInvalid = (req, res) => {

    const errors = validationResult(req);

    if (errors.isEmpty()) {
        return false;
    }

    res.status(400).json({
        success: false,
        errors: errors.array()
    });

    return true;

};

// Maps a thrown error onto a sensible HTTP status instead of a blanket 500,
// and keeps Sequelize internals (SQL, column names, stack) out of the response.
const sendError = (res, error, fallbackMessage = "Internal Server Error") => {

    const name = error && error.name;

    if (name === "SequelizeValidationError") {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: error.errors.map(e => ({
                field: e.path,
                message: e.message
            }))
        });
    }

    if (name === "SequelizeUniqueConstraintError") {
        return res.status(409).json({
            success: false,
            message: "A record with these details already exists",
            errors: (error.errors || []).map(e => ({
                field: e.path,
                message: e.message
            }))
        });
    }

    if (name === "SequelizeForeignKeyConstraintError") {
        return res.status(400).json({
            success: false,
            message: "Referenced record does not exist"
        });
    }

    if (
        name === "SequelizeDatabaseError" ||
        name === "SequelizeEmptyResultError"
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid value supplied for one or more fields"
        });
    }

    // Errors raised deliberately by a service layer carry a usable message.
    //
    // `blockedBy` travels with it when there is one: a refused delete is only
    // actionable if the response names what is standing in the way, and the
    // admin screens render that list verbatim. Dropping it here turned "still
    // holds 14 timetable slots" into a bare 409.
    if (error && error.statusCode) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {}),
            /*
             * `details` travels for the same reason `blockedBy` does. A refused
             * timetable placement carries the list of blockers that refused it -
             * which section is busy, which teacher, which room and what is in it -
             * and that list is the entire actionable content of the response. The
             * message can only summarise it; the grid needs the structure to
             * highlight the offending cells.
             */
            ...(error.details ? { details: error.details } : {})
        });
    }

    console.error(error);

    return res.status(500).json({
        success: false,
        message: fallbackMessage
    });

};

module.exports = {
    rejectIfInvalid,
    sendError
};
