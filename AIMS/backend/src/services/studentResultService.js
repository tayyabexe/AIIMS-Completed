const StudentResult = require("../models/result.model");

// Get all results
// See challanService: `studentId` scopes the read in SQL instead of pulling
// every result row and discarding all but one student's.
const getAllResults = async (studentId = null) => {
    return await StudentResult.findAll(
        studentId ? { where: { student_id: studentId } } : undefined
    );
};

// Get result by ID
const getResultById = async (id) => {
    return await StudentResult.findByPk(id);
};

// Create result
const createResult = async (resultData) => {
    return await StudentResult.create(resultData);
};

// Update result
const updateResult = async (id, resultData) => {

    const result = await StudentResult.findByPk(id);

    if (!result) {
        return null;
    }

    await result.update(resultData);

    return result;
};

// Delete result
const deleteResult = async (id) => {

    const result = await StudentResult.findByPk(id);

    if (!result) {
        return null;
    }

    await result.destroy();

    return result;
};

module.exports = {
    getAllResults,
    getResultById,
    createResult,
    updateResult,
    deleteResult
};
