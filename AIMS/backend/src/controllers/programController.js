/* =====================================================================
 * DEAD CODE - NOT REACHABLE.
 * =====================================================================
 *
 * The only router that referenced this controller is itself unmounted and
 * marked DO NOT MOUNT. The live implementation is
 * controllers/academicStructureController.js.
 *
 * Kept only as a record of the shape that was replaced.
 * ===================================================================== */

// const Program = require("../models/program.model");
const programService = require("../services/programService");

// Create Program
const createProgram = async (req, res) => {
  try {
    // const program = await Program.create(req.body);
    const program = await programService.createProgram(req.body);

    return res.status(201).json({
      success: true,
      message: "Program created successfully",
      data: program,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get All Programs
const getPrograms = async (req, res) => {
  try {
    // const programs = await Program.findAll({
    //   where: {
    //     is_deleted: false,
    //   },
    // });
    const programs = await programService.getAllPrograms();

    return res.status(200).json({
      success: true,
      data: programs,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Program By ID
const getProgramById = async (req, res) => {
  try {
    // const { id } = req.params;

    // const program = await Program.findOne({
    //   where: {
    //     program_id: id,
    //     is_deleted: false,
    //   },
    // });
    const program = await programService.getProgramById(req.params.id);

    if (!program) {
      return res.status(404).json({
        success: false,
        message: "Program not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: program,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update Program
const updateProgram = async (req, res) => {
  try {
    const program = await programService.updateProgram(
  req.params.id,
  req.body
);

if (!program) {
  return res.status(404).json({
    success: false,
    message: "Program not found",
  });
}

    // await program.update(req.body);

    return res.status(200).json({
      success: true,
      message: "Program updated successfully",
      data: program,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Search Programs
const searchPrograms = async (req, res) => {
    try {
        const keyword = req.query.q;

        const programs = await programService.searchPrograms(keyword);

        return res.status(200).json({
            success: true,
            count: programs.length,
            data: programs
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Soft Delete Program
const deleteProgram = async (req, res) => {
  try {
   const program = await programService.deleteProgram(req.params.id);

if (!program) {
  return res.status(404).json({
    success: false,
    message: "Program not found",
  });
}

    return res.status(200).json({
      success: true,
      message: "Program deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
    createProgram,
    getPrograms,
    getProgramById,
    updateProgram,
    deleteProgram,
    searchPrograms
};