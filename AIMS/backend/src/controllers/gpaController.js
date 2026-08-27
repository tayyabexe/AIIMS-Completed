const gpaService = require("../services/gpaService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all GPA records
const getGPAs = async (req, res) => {
    try {

        const gpas = await gpaService.getAllGPAs(
            req.ownStudentId || null
        );

        res.status(200).json({
            success: true,
            count: gpas.length,
            data: gpas
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Get GPA by ID
const getGPA = async (req, res) => {
    try {

        const gpa = await gpaService.getGPAById(req.params.id);

        if (!gpa) {
            return res.status(404).json({
                success: false,
                message: "GPA record not found"
            });
        }

        res.status(200).json({
            success: true,
            data: gpa
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Create GPA
const createGPA = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const gpa = await gpaService.createGPA(req.body);

        res.status(201).json({
            success: true,
            data: gpa
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Update GPA
const updateGPA = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const gpa = await gpaService.updateGPA(
            req.params.id,
            req.body
        );

        if (!gpa) {
            return res.status(404).json({
                success: false,
                message: "GPA record not found"
            });
        }

        res.status(200).json({
            success: true,
            data: gpa
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Delete GPA
const deleteGPA = async (req, res) => {
    try {

        const gpa = await gpaService.deleteGPA(req.params.id);

        if (!gpa) {
            return res.status(404).json({
                success: false,
                message: "GPA record not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "GPA record deleted successfully"
        });

    } catch (error) {

        sendError(res, error);

    }
};

module.exports = {
    getGPAs,
    getGPA,
    createGPA,
    updateGPA,
    deleteGPA
};