const TeacherProfile = require("../models/TeacherProfile");

// Get all
const getAllProfiles = async () => {
    return await TeacherProfile.findAll();
};

// Get by ID
const getProfileById = async (id) => {
    return await TeacherProfile.findByPk(id);
};

// Create
const createProfile = async (data) => {
    return await TeacherProfile.create(data);
};

// Update
const updateProfile = async (id, data) => {

    const profile = await TeacherProfile.findByPk(id);

    if (!profile) {
        return null;
    }

    await profile.update(data);

    return profile;
};

// Delete
const deleteProfile = async (id) => {

    const profile = await TeacherProfile.findByPk(id);

    if (!profile) {
        return null;
    }

    await profile.destroy();

    return profile;
};

module.exports = {
    getAllProfiles,
    getProfileById,
    createProfile,
    updateProfile,
    deleteProfile
};