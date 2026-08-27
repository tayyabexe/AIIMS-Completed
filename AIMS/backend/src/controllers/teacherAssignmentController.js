const teacherAssignmentService = require("../services/teacherAssignmentService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all
const getAssignments = async (req, res) => {
    try {

        const assignments =
            await teacherAssignmentService.getAllAssignments();

        res.status(200).json({
            success: true,
            count: assignments.length,
            data: assignments
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Get by ID
const getAssignment = async (req, res) => {
    try {

        const assignment =
            await teacherAssignmentService.getAssignmentById(
                req.params.id
            );

        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: "Assignment not found"
            });
        }

        res.status(200).json({
            success: true,
            data: assignment
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Create
const createAssignment = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const assignment =
            await teacherAssignmentService.createAssignment(
                req.body
            );

        res.status(201).json({
            success: true,
            data: assignment
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Update
const updateAssignment = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const assignment =
            await teacherAssignmentService.updateAssignment(
                req.params.id,
                req.body
            );

        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: "Assignment not found"
            });
        }

        res.status(200).json({
            success: true,
            data: assignment
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Delete
const deleteAssignment = async (req, res) => {
    try {

        const assignment =
            await teacherAssignmentService.deleteAssignment(
                req.params.id
            );

        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: "Assignment not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Assignment deleted successfully"
        });

    } catch (error) {

        sendError(res, error);

    }
};

module.exports = {
    getAssignments,
    getAssignment,
    createAssignment,
    updateAssignment,
    deleteAssignment
};