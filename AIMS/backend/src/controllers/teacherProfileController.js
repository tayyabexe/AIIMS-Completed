const teacherProfileService = require("../services/teacherProfileService");
const { rejectIfInvalid, sendError } = require("../utils/apiError");

// Get all
const getProfiles = async (req, res) => {
    try {

        const profiles =
            await teacherProfileService.getAllProfiles();

        res.status(200).json({
            success: true,
            count: profiles.length,
            data: profiles
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Get by ID
const getProfile = async (req, res) => {
    try {

        const profile =
            await teacherProfileService.getProfileById(
                req.params.id
            );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: "Profile not found"
            });
        }

        res.status(200).json({
            success: true,
            data: profile
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Create
const createProfile = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const profile =
            await teacherProfileService.createProfile(
                req.body
            );

        res.status(201).json({
            success: true,
            data: profile
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Update
const updateProfile = async (req, res) => {
    try {


        if (rejectIfInvalid(req, res)) return;
        const profile =
            await teacherProfileService.updateProfile(
                req.params.id,
                req.body
            );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: "Profile not found"
            });
        }

        res.status(200).json({
            success: true,
            data: profile
        });

    } catch (error) {

        sendError(res, error);

    }
};

// Delete
const deleteProfile = async (req, res) => {
    try {

        const profile =
            await teacherProfileService.deleteProfile(
                req.params.id
            );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: "Profile not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Profile deleted successfully"
        });

    } catch (error) {

        sendError(res, error);

    }
};

module.exports = {
    getProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile
};