const { Op } = require("sequelize");
const Program = require("../models/program.model");
const { sequelize } = require("../database/connection");

// Get all programs.
//
// The owning department's name is joined in because every portal that shows a
// programme also shows its department, and `programs` stores only a
// department_id. Without it the student profile printed the programme name in
// the department slot, so "Computer Science" appeared twice under itself.
const getAllPrograms = async () => {
    return await sequelize.query(
        `SELECT p.program_id,
                p.department_id,
                p.program_name,
                p.duration_semesters,
                d.department_name
           FROM programs p
           LEFT JOIN departments d ON d.department_id = p.department_id
          WHERE p.is_deleted = 0
          ORDER BY p.program_name`,
        { type: sequelize.QueryTypes.SELECT }
    );
};

// Get program by ID
const getProgramById = async (id) => {
    return await Program.findOne({
        where: {
            program_id: id,
            is_deleted: false
        }
    });
};

// Create program
const createProgram = async (programData) => {
    return await Program.create(programData);
};

// Update program
const updateProgram = async (id, programData) => {
    const program = await Program.findByPk(id);

    if (!program) {
        return null;
    }

    await program.update(programData);

    return program;
};

// Soft delete program
const deleteProgram = async (id) => {
    const program = await Program.findByPk(id);

    if (!program) {
        return null;
    }

    await program.update({
        is_deleted: true
    });

    return program;
};

// Search programs
const searchPrograms = async (keyword) => {
    return await Program.findAll({
        where: {
            is_deleted: false,
            [Op.or]: [
                {
                    program_name: {
                        [Op.like]: `%${keyword}%`
                    }
                }
            ]
        }
    });
};

module.exports = {
    getAllPrograms,
    getProgramById,
    createProgram,
    updateProgram,
    deleteProgram,
    searchPrograms
};