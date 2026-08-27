const feeStructureService = require("../services/feeStructureService");
const audit = require("../services/auditService");

/*
 * A fee structure decides what every student on a programme is billed for a
 * semester, so one edit here silently re-prices a whole cohort. The three
 * writes below are audited for that reason: the vouchers that follow record who
 * issued them, but nothing recorded who set the amount they were issued for.
 */
const structureSnapshot = (fee) => (fee ? {
    feeStructureId: fee.fee_structure_id,
    programId: fee.program_id,
    semesterId: fee.semester_id,
    feeCategory: fee.fee_category,
    amount: fee.amount
} : null);

// Get all fee structures
const getFeeStructures = async (req, res) => {
    try {

        const fees = await feeStructureService.getAllFeeStructures();

        res.status(200).json({
            success: true,
            count: fees.length,
            data: fees
        });

    } catch (error) {

        // A duplicate catalogue line is the caller's input clashing with a row
        // that is already there, not the server failing. Reported as 500 it
        // read as a crash for what is an ordinary, correctable mistake.
        const status = error.status
            || (/already exists/i.test(error.message || "") ? 409 : 500);

        res.status(status).json({
            success: false,
            message: error.message
        });

    }
};

// Get fee structure by ID
const getFeeStructure = async (req, res) => {
    try {

        const fee = await feeStructureService.getFeeStructureById(req.params.id);

        if (!fee) {
            return res.status(404).json({
                success: false,
                message: "Fee structure not found"
            });
        }

        res.status(200).json({
            success: true,
            data: fee
        });

    } catch (error) {

        // A duplicate catalogue line is the caller's input clashing with a row
        // that is already there, not the server failing. Reported as 500 it
        // read as a crash for what is an ordinary, correctable mistake.
        const status = error.status
            || (/already exists/i.test(error.message || "") ? 409 : 500);

        res.status(status).json({
            success: false,
            message: error.message
        });

    }
};

// Create fee structure
const createFeeStructure = async (req, res) => {
    try {

        const fee = await feeStructureService.createFeeStructure(req.body);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.FEE_STRUCTURE_CREATED,
            module: audit.MODULES.FEES,
            entity: `fee_structures#${fee.fee_structure_id}`,
            after: structureSnapshot(fee),
            req
        });

        res.status(201).json({
            success: true,
            data: fee
        });

    } catch (error) {

        // A duplicate catalogue line is the caller's input clashing with a row
        // that is already there, not the server failing. Reported as 500 it
        // read as a crash for what is an ordinary, correctable mistake.
        const status = error.status
            || (/already exists/i.test(error.message || "") ? 409 : 500);

        res.status(status).json({
            success: false,
            message: error.message
        });

    }
};

// Update fee structure
const updateFeeStructure = async (req, res) => {
    try {

        // Read first: the amount BEFORE the change is the whole point of
        // auditing a re-pricing, and the update overwrites it.
        const previous = await feeStructureService.getFeeStructureById(req.params.id);

        const fee = await feeStructureService.updateFeeStructure(
            req.params.id,
            req.body
        );

        if (!fee) {
            return res.status(404).json({
                success: false,
                message: "Fee structure not found"
            });
        }

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.FEE_STRUCTURE_UPDATED,
            module: audit.MODULES.FEES,
            entity: `fee_structures#${fee.fee_structure_id}`,
            before: structureSnapshot(previous),
            after: structureSnapshot(fee),
            req
        });

        res.status(200).json({
            success: true,
            data: fee
        });

    } catch (error) {

        // A duplicate catalogue line is the caller's input clashing with a row
        // that is already there, not the server failing. Reported as 500 it
        // read as a crash for what is an ordinary, correctable mistake.
        const status = error.status
            || (/already exists/i.test(error.message || "") ? 409 : 500);

        res.status(status).json({
            success: false,
            message: error.message
        });

    }
};

// Delete fee structure
const deleteFeeStructure = async (req, res) => {
    try {

        const previous = await feeStructureService.getFeeStructureById(req.params.id);

        const fee = await feeStructureService.deleteFeeStructure(req.params.id);

        if (!fee) {
            return res.status(404).json({
                success: false,
                message: "Fee structure not found"
            });
        }

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.FEE_STRUCTURE_DELETED,
            module: audit.MODULES.FEES,
            entity: `fee_structures#${req.params.id}`,
            before: structureSnapshot(previous),
            req
        });

        res.status(200).json({
            success: true,
            message: "Fee structure deleted successfully"
        });

    } catch (error) {

        // A duplicate catalogue line is the caller's input clashing with a row
        // that is already there, not the server failing. Reported as 500 it
        // read as a crash for what is an ordinary, correctable mistake.
        const status = error.status
            || (/already exists/i.test(error.message || "") ? 409 : 500);

        res.status(status).json({
            success: false,
            message: error.message
        });

    }
};

module.exports = {
    getFeeStructures,
    getFeeStructure,
    createFeeStructure,
    updateFeeStructure,
    deleteFeeStructure
};