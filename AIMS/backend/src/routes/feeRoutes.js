const express = require("express");

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ROLES } = require("../config/roles");
const { scopeStudentToSelf } = require("../middlewares/selfScope.middleware");

const feeController = require("../controllers/feeController");
const {
    createVoucherValidation,
    updateVoucherValidation,
    createPaymentValidation,
    updatePaymentValidation,
    submitPaymentValidation,
    decidePaymentValidation
} = require("../validators/feeValidator");

/*
 * The fee module's routes.
 *
 * These replace five overlapping route groups — /api/student-fees,
 * /api/challans, /api/receipts, /api/payments and the old /api/fee-payments —
 * which each exposed a different table recording the same billing events. Two
 * portals reading two of them showed different balances for the same student.
 *
 * Reads are open to every signed-in role and scoped inside the controller: a
 * student sees their own vouchers, a parent their children's, staff any. There
 * is no authorize() gate on the reads because the scope is the permission, and
 * a role list here would have locked parents out the way it did before.
 *
 * Writes stay on ADMINS.
 */

const vouchers = express.Router();

vouchers.get("/", authenticate, scopeStudentToSelf, feeController.getVouchers);

// Declared before "/:id" so "student" is never read as a voucher id.
vouchers.get(
    "/student/:student_id",
    authenticate,
    feeController.getStudentFeePosition
);

// A student's own position without naming an id; scopeStudentToSelf resolves it.
vouchers.get(
    "/me",
    authenticate,
    scopeStudentToSelf,
    feeController.getStudentFeePosition
);

vouchers.get("/:id", authenticate, feeController.getVoucher);

vouchers.post("/", authenticate, authorize(...ADMINS), createVoucherValidation, feeController.createVoucher);
vouchers.put("/:id", authenticate, authorize(...ADMINS), updateVoucherValidation, feeController.updateVoucher);
vouchers.delete("/:id", authenticate, authorize(...ADMINS), feeController.deleteVoucher);

const payments = express.Router();

payments.get("/", authenticate, scopeStudentToSelf, feeController.getPayments);

/*
 * The accounts office's approvals queue: payments declared through a portal and
 * not yet decided on.
 *
 * Declared before "/:id" so "submitted" is never read as a payment id. Staff
 * only — this list names every family that has claimed a payment, which is not
 * a parent's business, and the /verify route beneath it is what acts on the
 * rows it returns.
 */
payments.get(
    "/submitted",
    authenticate,
    authorize(...ADMINS),
    feeController.getSubmittedPayments
);

/*
 * The payment ledger: every instalment against a student's vouchers, ordered by
 * the date the accounts office approved it.
 *
 * Declared before "/:id" so "history" is never read as a payment id.
 *
 * No authorize() gate, for the same reason the reads above have none: the scope
 * IS the permission. The controller resolves which students this caller may see
 * from the token — staff any, a parent their wards, a student themselves — and
 * a role list here would lock parents out of their own children's payment
 * history, which is the question this endpoint exists to answer.
 */
payments.get(
    "/history",
    authenticate,
    feeController.getPaymentHistory
);

/*
 * A parent declaring a payment they have made.
 *
 * Declared before "/:id" so "submit" is never read as a payment id.
 *
 * This is the one write on the fee module that is not ADMINS-only, and it is
 * safe because of what it writes: the row is created Pending and the voucher is
 * not re-settled, so submitting one moves no money. The controller checks the
 * voucher belongs to a student this caller may act for; the ADMINS gate on
 * /verify below is what actually applies it to the account.
 */
payments.post(
    "/submit",
    authenticate,
    authorize(ROLES.PARENT, ROLES.STUDENT, ...ADMINS),
    submitPaymentValidation,
    feeController.submitPayment
);

// The accounts office confirming or refusing a declared payment.
payments.put(
    "/:id/verify",
    authenticate,
    authorize(...ADMINS),
    decidePaymentValidation,
    feeController.decidePayment
);

payments.post("/", authenticate, authorize(...ADMINS), createPaymentValidation, feeController.createPayment);
payments.put("/:id", authenticate, authorize(...ADMINS), updatePaymentValidation, feeController.updatePayment);
payments.delete("/:id", authenticate, authorize(...ADMINS), feeController.deletePayment);

module.exports = { vouchers, payments };
