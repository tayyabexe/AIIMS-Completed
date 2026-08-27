const Section = require("../models/section.model");

// Get all sections
const getAllSections = async () => {
    return await Section.findAll({
        where: {
            is_deleted: false
        }
    });
};

// Get section by ID
const getSectionById = async (id) => {
    return await Section.findOne({
        where: {
            section_id: id,
            is_deleted: false
        }
    });
};

// Create section
const createSection = async (sectionData) => {
    return await Section.create(sectionData);
};

// Update section
const updateSection = async (id, sectionData) => {
    const section = await Section.findByPk(id);

    if (!section) {
        return null;
    }

    await section.update(sectionData);

    return section;
};

// Soft delete section
const deleteSection = async (id) => {
    const section = await Section.findByPk(id);

    if (!section) {
        return null;
    }

    await section.update({
        is_deleted: true
    });

    return section;
};

module.exports = {
    getAllSections,
    getSectionById,
    createSection,
    updateSection,
    deleteSection
};