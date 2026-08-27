const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");

const getDashboard = async (teacherId) => {

    const teacher = await Teacher.findByPk(teacherId);

    if (!teacher) {
        return null;
    }

    const assignments =
        await TeacherAssignment.count({
            where: {
                teacher_id: teacherId
            }
        });

    return {
        teacher,
        total_assignments: assignments
    };
};

module.exports = {
    getDashboard
};