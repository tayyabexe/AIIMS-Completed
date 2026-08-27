const timetableService = require("../services/timetableService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all timetables
const getTimetables = async (req, res) => {
    try {
        const timetables = await timetableService.getAllTimetables();

        res.json(timetables);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// Get timetable by ID
const getTimetable = async (req, res) => {
    try {
        const timetable = await timetableService.getTimetableById(req.params.id);

        if (!timetable) {
            return res.status(404).json({
                message: "Timetable not found"
            });
        }

        res.json(timetable);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// Create timetable
const createTimetable = async (req, res) => {
    try {
        if (rejectIfInvalid(req, res)) return;

        const timetable = await timetableService.createTimetable(req.body);

        res.status(201).json(timetable);

    } catch (error) {
        sendError(res, error);
    }
};

// Update timetable
const updateTimetable = async (req, res) => {
    try {
        if (rejectIfInvalid(req, res)) return;

        const timetable = await timetableService.updateTimetable(
            req.params.id,
            req.body
        );

        if (!timetable) {
            return res.status(404).json({
                message: "Timetable not found"
            });
        }

        res.json(timetable);

    } catch (error) {
        sendError(res, error);
    }
};

// ================= LIVE ("SMART") TIMETABLE =================
//
// Returns the caller's week already flagged against the server clock: which
// weekday is today, which lecture is running now, which is next, and how many
// seconds until that changes. The portal highlights from these flags instead
// of computing them from the device clock.

// Intl throws a RangeError on an unknown zone, and ?timezone= is user input.
const isValidTimezone = (timezone) => {
    try {
        new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
};

const getCurrentTimetable = async (req, res) => {
    try {
        const { timezone, section_id, teacher_id, student_id } = req.query;

        if (timezone && !isValidTimezone(timezone)) {
            return res.status(400).json({
                success: false,
                message: `Unknown timezone: ${timezone}`
            });
        }

        const result = await timetableService.getLiveTimetable({
            user: req.user,
            timezone,
            sectionId: section_id,
            teacherId: teacher_id,
            studentId: student_id
        });

        // resolveScope refuses rather than returning an empty list, so an
        // out-of-scope id is a 403 and a missing one a 400.
        if (result.error) {
            const isPermission = /only|does not have/i.test(result.error);

            return res.status(isPermission ? 403 : 400).json({
                success: false,
                message: result.error
            });
        }

        res.status(200).json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to load the current timetable"
        });
    }
};

// Delete timetable
const deleteTimetable = async (req, res) => {
    try {
        const timetable = await timetableService.deleteTimetable(req.params.id);

        if (!timetable) {
            return res.status(404).json({
                message: "Timetable not found"
            });
        }

        res.json({
            message: "Timetable deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

module.exports = {
    getTimetables,
    getCurrentTimetable,
    getTimetable,
    createTimetable,
    updateTimetable,
    deleteTimetable
};