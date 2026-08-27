const FeeStructure = require("../models/FeeStructure");
const { sequelize } = require("../database/connection");

/*
 * The fee catalogue: what a programme's semester costs, one row per category.
 *
 * Returned with the programme and semester resolved to names rather than as
 * bare foreign keys. The table on its own is four numbers — program_id 3,
 * semester_id 27, "Tuition", 55000 — which no one can check for correctness,
 * and this is a catalogue that is READ to decide what to bill a student.
 *
 * `voucherCount` is here for the same reason every other admin list carries its
 * counts: it says whether a row has been used to bill anyone yet, and therefore
 * whether changing its amount is a correction or a rewrite of history.
 */
const getAllFeeStructures = async () => {
    return sequelize.query(
        `SELECT fs.fee_structure_id, fs.program_id, fs.semester_id,
                fs.fee_category, fs.amount,
                p.program_name, sm.semester_number,
                (SELECT COUNT(*) FROM fee_vouchers v
                  WHERE v.fee_structure_id = fs.fee_structure_id) AS voucher_count
           FROM fee_structures fs
           LEFT JOIN programs  p  ON p.program_id   = fs.program_id
           LEFT JOIN semesters sm ON sm.semester_id = fs.semester_id
          ORDER BY p.program_name, sm.semester_number, fs.fee_category`,
        { type: sequelize.QueryTypes.SELECT }
    ).then((rows) => rows.map((r) => ({
        id: r.fee_structure_id,
        feeStructureId: r.fee_structure_id,
        programId: r.program_id,
        program: r.program_name || null,
        semesterId: r.semester_id,
        semesterNumber: r.semester_number == null ? null : Number(r.semester_number),
        semesterLabel: r.semester_number == null ? null : `Semester ${r.semester_number}`,
        category: r.fee_category,
        amount: Number(r.amount),
        voucherCount: Number(r.voucher_count)
    })));
};

// Get fee structure by ID
const getFeeStructureById = async (id) => {
    return await FeeStructure.findByPk(id);
};

// Create fee structure
const createFeeStructure = async (feeData) => {

    const existing = await FeeStructure.findOne({
        where: {
            program_id: feeData.program_id,
            semester_id: feeData.semester_id,
            fee_category: feeData.fee_category
        }
    });

    if (existing) {
        throw new Error("Fee structure already exists");
    }

    return await FeeStructure.create(feeData);
};

// Update fee structure
const updateFeeStructure = async (id, feeData) => {

    const fee = await FeeStructure.findByPk(id);

    if (!fee) {
        return null;
    }

    if (
        feeData.program_id &&
        feeData.semester_id &&
        feeData.fee_category
    ) {

        const existing = await FeeStructure.findOne({
            where: {
                program_id: feeData.program_id,
                semester_id: feeData.semester_id,
                fee_category: feeData.fee_category
            }
        });

        if (
            existing &&
            existing.fee_structure_id != id
        ) {
            throw new Error("Fee structure already exists");
        }
    }

    await fee.update(feeData);

    return fee;
};

// Delete fee structure
const deleteFeeStructure = async (id) => {

    const fee = await FeeStructure.findByPk(id);

    if (!fee) {
        return null;
    }

    await fee.destroy();

    return fee;
};

module.exports = {
    getAllFeeStructures,
    getFeeStructureById,
    createFeeStructure,
    updateFeeStructure,
    deleteFeeStructure
};