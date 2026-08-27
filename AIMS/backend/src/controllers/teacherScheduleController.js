const teacherScheduleService = require("../services/teacherScheduleService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all
const getSchedules = async (req, res) => {
    try {

        const schedules =
            await teacherScheduleService.getAllSchedules();

        res.status(200).json({
            success: true,
            count: schedules.length,
            data: schedules
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Get by ID
const getSchedule = async (req, res) => {
    try {

        const schedule =
            await teacherScheduleService.getScheduleById(
                req.params.id
            );

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: "Schedule not found"
            });
        }

        res.status(200).json({
            success: true,
            data: schedule
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Create
const createSchedule = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const schedule =
            await teacherScheduleService.createSchedule(
                req.body
            );

        res.status(201).json({
            success: true,
            data: schedule
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Update
const updateSchedule = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const schedule =
            await teacherScheduleService.updateSchedule(
                req.params.id,
                req.body
            );

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: "Schedule not found"
            });
        }

        res.status(200).json({
            success: true,
            data: schedule
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Delete
const deleteSchedule = async (req, res) => {
    try {

        const schedule =
            await teacherScheduleService.deleteSchedule(
                req.params.id
            );

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: "Schedule not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Schedule deleted successfully"
        });

    } catch (error) {

        sendError(res, error);

    }
};

module.exports = {
    getSchedules,
    getSchedule,
    createSchedule,
    updateSchedule,
    deleteSchedule
};
