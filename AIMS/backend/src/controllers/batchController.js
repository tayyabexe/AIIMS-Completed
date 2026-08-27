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

const batchService = require("../services/batchService");

// Get all batches
const getBatches = async (req, res) => {
    try {
        const batches = await batchService.getAllBatches();
        res.json(batches);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get batch by ID
const getBatch = async (req, res) => {
    try {
        const batch = await batchService.getBatchById(req.params.id);

        if (!batch) {
            return res.status(404).json({
                message: "Batch not found"
            });
        }

        res.json(batch);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// Create batch
const createBatch = async (req, res) => {
    try {
        const batch = await batchService.createBatch(req.body);

        res.status(201).json(batch);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// Update batch
const updateBatch = async (req, res) => {
    try {
        const batch = await batchService.updateBatch(req.params.id, req.body);

        if (!batch) {
            return res.status(404).json({
                message: "Batch not found"
            });
        }

        res.json(batch);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

// Delete batch
const deleteBatch = async (req, res) => {
    try {
        const batch = await batchService.deleteBatch(req.params.id);

        if (!batch) {
            return res.status(404).json({
                message: "Batch not found"
            });
        }

        res.json({
            message: "Batch deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

module.exports = {
    getBatches,
    getBatch,
    createBatch,
    updateBatch,
    deleteBatch
};