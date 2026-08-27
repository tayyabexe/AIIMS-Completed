/*
 * Fee payment reporting.
 *
 * Reads the consolidated `fee_payments` table. It previously required
 * models/FeePayment.js, which mapped the old bridge table holding both a
 * challan_id and a receipt_id — one of three tables that recorded the same
 * payment. See migrations/20260808090000-consolidate-fee-module.js.
 */

const FeePayment = require("../models/feePayment.model");
const FeeVoucher = require("../models/feeVoucher.model");

const withVoucher = {
    include: [{ model: FeeVoucher, as: "voucher" }],
    order: [["payment_date", "DESC"]]
};

const getAllReports = async () => FeePayment.findAll(withVoucher);

const getReportById = async (id) => FeePayment.findByPk(id, {
    include: [{ model: FeeVoucher, as: "voucher" }]
});

module.exports = {
    getAllReports,
    getReportById
};
