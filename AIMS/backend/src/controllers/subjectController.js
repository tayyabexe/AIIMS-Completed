const subjectService = require("../services/subjectService");

// Get all subjects
const getSubjects = async (req, res) => {
    try {
        const subjects = await subjectService.getAllSubjects();

        res.status(200).json({
            success: true,
            count: subjects.length,
            data: subjects
        });

    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }
};

// Get subject by ID
const getSubject = async (req, res) => {
    try {
        const subject = await subjectService.getSubjectById(req.params.id);

        if (!subject) {
            return res.status(404).json({
                success: false,
                message: "Subject not found"
            });
        }

        res.status(200).json({
            success: true,
            data: subject
        });

    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }
};

// Create subject
const createSubject = async (req, res) => {
    try {
        const subject = await subjectService.createSubject(req.body);

        res.status(201).json({
            success: true,
            data: subject
        });

    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }
};

// Update subject
const updateSubject = async (req, res) => {
    try {
        const subject = await subjectService.updateSubject(req.params.id, req.body);

        if (!subject) {
            return res.status(404).json({
                success: false,
                message: "Subject not found"
            });
        }

        res.status(200).json({
            success: true,
            data: subject
        });

    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }
};

// Delete subject
const deleteSubject = async (req, res) => {
    try {
        const subject = await subjectService.deleteSubject(req.params.id);

        if (!subject) {
            return res.status(404).json({
                success: false,
                message: "Subject not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Subject deleted successfully"
        });

    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }
};

// Search subjects
const searchSubjects = async (req, res) => {
    try {
        const keyword = req.query.q;

        const subjects = await subjectService.searchSubjects(keyword);

        res.status(200).json({
            success: true,
            count: subjects.length,
            data: subjects
        });

    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }
};

module.exports = {
    getSubjects,
    getSubject,
    createSubject,
    updateSubject,
    deleteSubject,
    searchSubjects
};