const { body } = require("express-validator");

/*
 * Validation for the consolidated fee module.
 *
 * The challan, receipt and payment validators that used to live here belonged
 * to five routes exposing five tables that recorded the same billing events.
 * Those routes are retired; see
 * migrations/20260808090000-consolidate-fee-module.js.
 */

// Status is derived from the instalments by feeService, so "Cancelled" is the
// only value an admin may set by hand.
const VOUCHER_SETTABLE_STATUS = ["Cancelled"];

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Card", "Mobile Wallet", "Online", "Cheque", "Other"];

const createVoucherValidation = [
    body("student_id")
        .notEmpty().withMessage("Student ID is required")
        .isInt({ min: 1 }).withMessage("Student ID must be a positive integer"),

    /*
     * Optional now, not missing.
     *
     * feeService.issueVoucher falls back to the fee structure on record for the
     * student's programme and semester, so the ordinary case is "issue the
     * semester's voucher" with no amount typed at all. Requiring it here meant
     * the figure was re-entered by hand on every admission, which is how a
     * screen ends up billing an amount nothing else in the system agrees with.
     * A voucher that resolves to zero is still refused, by the service.
     */
    body("total_payable")
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage("Total payable cannot be negative"),

    // Also optional: the student's own current_semester_id is used when it is
    // left out. See issueVoucher for why the column must not stay NULL.
    body("semester_id")
        .optional({ nullable: true })
        .isInt({ min: 1 }).withMessage("Semester ID must be a positive integer"),

    body("issue_date")
        .optional({ nullable: true })
        .isISO8601().withMessage("Issue date must be a valid date"),

    body("due_date")
        .optional({ nullable: true })
        .isISO8601().withMessage("Due date must be a valid date"),

    body("voucher_number")
        .optional({ nullable: true })
        .isLength({ max: 30 }).withMessage("Voucher number must be 30 characters or fewer")
];

/*
 * The update chain covered three fields; the handler accepted six. issue_date,
 * semester_id and fee_structure_id reached the row unchecked, so a mistyped
 * semester_id landed as a foreign-key error the admin could not act on, and a
 * malformed issue_date became a MySQL "Invalid value" 500.
 *
 * The rules that need to look at the stored row — a bill may not be lowered
 * below money already verified, a due date may not precede its issue date, a
 * student may not hold two live vouchers for one semester — cannot be expressed
 * here and live in feeService.amendVoucher.
 */
const updateVoucherValidation = [
    body("total_payable").optional().isFloat({ min: 0 })
        .withMessage("Total payable cannot be negative"),

    body("issue_date").optional({ nullable: true }).isISO8601()
        .withMessage("Issue date must be a valid date"),

    body("due_date").optional({ nullable: true }).isISO8601()
        .withMessage("Due date must be a valid date"),

    body("semester_id").optional({ nullable: true }).isInt({ min: 1 })
        .withMessage("Semester ID must be a positive integer"),

    body("fee_structure_id").optional({ nullable: true }).isInt({ min: 1 })
        .withMessage("Fee structure ID must be a positive integer"),

    body("status").optional().isIn(VOUCHER_SETTABLE_STATUS)
        .withMessage("Only 'Cancelled' may be set directly; every other status is derived from the payments recorded")
];

const createPaymentValidation = [
    body("fee_voucher_id")
        .notEmpty().withMessage("Voucher ID is required")
        .isInt({ min: 1 }).withMessage("Voucher ID must be a positive integer"),

    body("amount_paid")
        .notEmpty().withMessage("Amount paid is required")
        .isFloat({ gt: 0 }).withMessage("Amount paid must be greater than zero"),

    body("payment_method").optional().isIn(PAYMENT_METHODS)
        .withMessage(`Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`),

    body("payment_date").optional({ nullable: true }).isISO8601()
        .withMessage("Payment date must be a valid date")
];

const updatePaymentValidation = [
    body("amount_paid").optional().isFloat({ gt: 0 })
        .withMessage("Amount paid must be greater than zero"),

    body("payment_method").optional().isIn(PAYMENT_METHODS)
        .withMessage(`Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`),

    body("payment_date").optional({ nullable: true }).isISO8601()
        .withMessage("Payment date must be a valid date")
];

/*
 * A payment declared by a parent from their own portal.
 *
 * Narrower than createPaymentValidation on purpose: a parent may not choose a
 * receipt number (the institute issues that on verification) and may not mark
 * their own payment late. Everything they can say is a claim about a transfer
 * they made, so a reference and a date are required — without them an admin has
 * nothing to check the claim against.
 */
const submitPaymentValidation = [
    body("fee_voucher_id")
        .notEmpty().withMessage("Voucher ID is required")
        .isInt({ min: 1 }).withMessage("Voucher ID must be a positive integer"),

    body("amount_paid")
        .notEmpty().withMessage("Amount paid is required")
        .isFloat({ gt: 0 }).withMessage("Amount paid must be greater than zero"),

    body("payment_method")
        .notEmpty().withMessage("Tell us how you paid")
        .isIn(PAYMENT_METHODS)
        .withMessage(`Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`),

    body("payment_date")
        .notEmpty().withMessage("The date you paid is required")
        .isISO8601().withMessage("Payment date must be a valid date")
        .custom((value) => {
            const paid = new Date(`${String(value).slice(0, 10)}T00:00:00`);
            const today = new Date(new Date().toDateString());
            if (paid > today) throw new Error("The payment date cannot be in the future");
            return true;
        })
];

const decidePaymentValidation = [
    body("status").optional().isIn(["Verified", "Rejected"])
        .withMessage("Status must be Verified or Rejected")
];

module.exports = {
    createVoucherValidation,
    updateVoucherValidation,
    createPaymentValidation,
    updatePaymentValidation,
    submitPaymentValidation,
    decidePaymentValidation
};
