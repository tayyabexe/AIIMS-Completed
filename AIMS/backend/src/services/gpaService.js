const GPA = require("../models/GPA");
const Student = require("../models/student.model");
const Semester = require("../models/semester.model");

// The gpa table carries no foreign keys, so referenced rows are checked here
// before a write. Without this a GPA can be stored against a student that
// does not exist.
const assertReferencesExist = async (data) => {

    if (data.student_id !== undefined) {

        const student = await Student.findOne({
            where: {
                student_id: data.student_id,
                is_deleted: false
            }
        });

        if (!student) {
            const error = new Error("Student not found");
            error.statusCode = 400;
            throw error;
        }

    }

    if (data.semester_id !== undefined) {

        const semester = await Semester.findByPk(data.semester_id);

        if (!semester) {
            const error = new Error("Semester not found");
            error.statusCode = 400;
            throw error;
        }

    }

};

// Get all GPA records
// `studentId` scopes the read in SQL for a signed-in student; see
// challanService for why.
const getAllGPAs = async (studentId = null) => {
    return await GPA.findAll(
        studentId ? { where: { student_id: studentId } } : undefined
    );
};

// Get GPA by ID
const getGPAById = async (id) => {
    return await GPA.findByPk(id);
};

// Create GPA
const createGPA = async (gpaData) => {

    await assertReferencesExist(gpaData);

    return await GPA.create(gpaData);
};

// Update GPA
const updateGPA = async (id, gpaData) => {

    const record = await GPA.findByPk(id);

    if (!record) {
        return null;
    }

    await assertReferencesExist(gpaData);

    await record.update(gpaData);

    return record;
};

// Delete GPA
const deleteGPA = async (id) => {

    const record = await GPA.findByPk(id);

    if (!record) {
        return null;
    }

    await record.destroy();

    return record;
};

module.exports = {
    getAllGPAs,
    getGPAById,
    createGPA,
    updateGPA,
    deleteGPA
};
