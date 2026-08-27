/* =====================================================================
 * DEAD CODE - NOT MOUNTED. DO NOT MOUNT THIS ROUTER.
 * =====================================================================
 *
 * Superseded by routes/academicStructureRoutes.js, which is what app.js
 * actually mounts. Read the comment at the top of that file for the full
 * account of why these were replaced.
 *
 * THE HAZARD: every route below is declared WITHOUT authenticate() and
 * WITHOUT authorize(). Mounting this file in app.js would expose full CRUD
 * over the academic structure to anonymous callers - no token required.
 *
 * It is kept only as a record of the shape that was replaced. If you need
 * this behaviour, add it to academicStructureRoutes.js, where the role gates
 * are applied.
 * ===================================================================== */

const express = require("express");

const router = express.Router();

const {
  createProgram,
  getPrograms,
  getProgramById,
  updateProgram,
  deleteProgram,
  searchPrograms
} = require("../controllers/programController");

// Create Program
router.post("/", createProgram);

// Search Programs
router.get("/search", searchPrograms);

// Get All Programs
router.get("/", getPrograms);

// Get Program By ID
router.get("/:id", getProgramById);

// Update Program
router.put("/:id", updateProgram);

// Delete Program
router.delete("/:id", deleteProgram);

module.exports = router;