const teacherService = require("../services/teacherService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all teachers
const getTeachers = async (req, res) => {
    try {
        const teachers = await teacherService.getAllTeachers();

        res.status(200).json({
            success: true,
            count: teachers.length,
            data: teachers
        });

    } catch (error) {
        sendError(res, error);
    }
};

// Get teacher by ID
const getTeacher = async (req, res) => {
    try {
        const teacher = await teacherService.getTeacherById(req.params.id);

        if (!teacher) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        res.status(200).json({
            success: true,
            data: teacher
        });

    } catch (error) {
        sendError(res, error);
    }
};

// Create teacher
const createTeacher = async (req, res) => {
    try {
        if (rejectIfInvalid(req, res)) return;

        const teacher = await teacherService.createTeacher(req.body);

        res.status(201).json({
            success: true,
            data: teacher
        });

    } catch (error) {
        sendError(res, error);
    }
};

// Update teacher
const updateTeacher = async (req, res) => {
    try {
        if (rejectIfInvalid(req, res)) return;

        const teacher = await teacherService.updateTeacher(
            req.params.id,
            req.body
        );

        if (!teacher) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        res.status(200).json({
            success: true,
            data: teacher
        });

    } catch (error) {
        sendError(res, error);
    }
};

// Delete teacher
const deleteTeacher = async (req, res) => {
    try {
        const teacher = await teacherService.deleteTeacher(req.params.id);

        if (!teacher) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Teacher deleted successfully"
        });

    } catch (error) {
        sendError(res, error);
    }
};

module.exports = {
    getTeachers,
    getTeacher,
    createTeacher,
    updateTeacher,
    deleteTeacher
};
