const studentResultService = require("../services/studentResultService");

// Get all results
const getResults = async (req, res) => {
    try {

        const results =
            await studentResultService.getAllResults(
                req.ownStudentId || null
            );

        res.status(200).json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Get result by ID
const getResult = async (req, res) => {
    try {

        const result =
            await studentResultService.getResultById(
                req.params.id
            );

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Result not found"
            });
        }

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Create result
const createResult = async (req, res) => {
    try {

        const result =
            await studentResultService.createResult(
                req.body
            );

        res.status(201).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Update result
const updateResult = async (req, res) => {
    try {

        const result =
            await studentResultService.updateResult(
                req.params.id,
                req.body
            );

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Result not found"
            });
        }

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

// Delete result
const deleteResult = async (req, res) => {
    try {

        const result =
            await studentResultService.deleteResult(
                req.params.id
            );

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Result not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Result deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

module.exports = {
    getResults,
    getResult,
    createResult,
    updateResult,
    deleteResult
};
