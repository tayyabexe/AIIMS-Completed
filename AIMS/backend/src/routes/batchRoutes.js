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
  createBatch,
  getBatches,
  getBatch,
  updateBatch,
  deleteBatch,
} = require("../controllers/batchController");

// Create Batch
router.post("/", createBatch);

// Get All Batches
router.get("/", getBatches);

// Get Batch By ID
router.get("/:id", getBatch);
// Update Batch
router.put("/:id", updateBatch);

// Delete Batch
router.delete("/:id", deleteBatch);

module.exports = router;