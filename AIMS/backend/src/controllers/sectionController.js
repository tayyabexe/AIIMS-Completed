/* =====================================================================
 * DEAD CODE - NOT REACHABLE.
 * =====================================================================
 *
 * The only router that referenced this controller is itself unmounted and
 * marked DO NOT MOUNT. The live implementation is
 * controllers/academicStructureController.js.
 *
 * Kept only as a record of the shape that was replaced.
 * ===================================================================== */

const sectionService = require("../services/sectionService");

// Create Section
const createSection = async (req, res) => {
    try {
        const section = await sectionService.createSection(req.body);

        return res.status(201).json({
            success: true,
            message: "Section created successfully",
            data: section
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get All Sections
const getSections = async (req, res) => {
    try {
        const sections = await sectionService.getAllSections();

        return res.status(200).json({
            success: true,
            data: sections
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Section By ID
const getSection = async (req, res) => {
    try {
        const section = await sectionService.getSectionById(req.params.id);

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: section
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update Section
const updateSection = async (req, res) => {
    try {
        const section = await sectionService.updateSection(
            req.params.id,
            req.body
        );

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Section updated successfully",
            data: section
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Delete Section
const deleteSection = async (req, res) => {
    try {
        const section = await sectionService.deleteSection(req.params.id);

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Section deleted successfully"
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createSection,
    getSections,
    getSection,
    updateSection,
    deleteSection
};