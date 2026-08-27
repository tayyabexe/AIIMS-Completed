const Batch = require("../models/batch.model");

// Get all batches
const getAllBatches = async () => {
    return await Batch.findAll({
        where: {
            is_deleted: false
        }
    });
};

// Get batch by ID
const getBatchById = async (id) => {
    return await Batch.findOne({
        where: {
            batch_id: id,
            is_deleted: false
        }
    });
};

// Create batch
const createBatch = async (batchData) => {
    return await Batch.create(batchData);
};

// Update batch
const updateBatch = async (id, batchData) => {
    const batch = await Batch.findByPk(id);

    if (!batch) {
        return null;
    }

    await batch.update(batchData);

    return batch;
};

// Soft delete batch
const deleteBatch = async (id) => {
    const batch = await Batch.findByPk(id);

    if (!batch) {
        return null;
    }

    await batch.update({
        is_deleted: true
    });

    return batch;
};

module.exports = {
    getAllBatches,
    getBatchById,
    createBatch,
    updateBatch,
    deleteBatch
};