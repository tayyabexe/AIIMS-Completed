const TeacherAssignment = require("../models/TeacherAssignment");

// Get all
const getAllAssignments = async () => {
    return await TeacherAssignment.findAll();
};

// Get by ID
const getAssignmentById = async (id) => {
    return await TeacherAssignment.findByPk(id);
};

// Create
const createAssignment = async (data) => {
    return await TeacherAssignment.create(data);
};

// Update
const updateAssignment = async (id, data) => {

    const assignment =
        await TeacherAssignment.findByPk(id);

    if (!assignment) return null;

    await assignment.update(data);

    return assignment;
};

// Delete
const deleteAssignment = async (id) => {

    const assignment =
        await TeacherAssignment.findByPk(id);

    if (!assignment) return null;

    await assignment.destroy();

    return assignment;
};

module.exports = {
    getAllAssignments,
    getAssignmentById,
    createAssignment,
    updateAssignment,
    deleteAssignment
};
