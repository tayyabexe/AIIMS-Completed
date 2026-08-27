const TeacherSchedule = require("../models/TeacherSchedule");

// Get all
const getAllSchedules = async () => {
    return await TeacherSchedule.findAll();
};

// Get by ID
const getScheduleById = async (id) => {
    return await TeacherSchedule.findByPk(id);
};

// Create
const createSchedule = async (data) => {
    return await TeacherSchedule.create(data);
};

// Update
const updateSchedule = async (id, data) => {

    const schedule =
        await TeacherSchedule.findByPk(id);

    if (!schedule) {
        return null;
    }

    await schedule.update(data);

    return schedule;
};

// Delete
const deleteSchedule = async (id) => {

    const schedule =
        await TeacherSchedule.findByPk(id);

    if (!schedule) {
        return null;
    }

    await schedule.destroy();

    return schedule;
};

module.exports = {
    getAllSchedules,
    getScheduleById,
    createSchedule,
    updateSchedule,
    deleteSchedule
};
