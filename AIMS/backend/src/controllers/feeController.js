/*
 * The fee module's one controller.
 *
 * It replaces five that overlapped — studentFeeController, challanController,
 * receiptController, paymentController and feePaymentController — each owning
 * a different table that recorded the same billing events. Two portals reading
 * two of those tables reported different balances for the same child.
 *
 * There are now two resources:
 *   /api/fee-vouchers   the challan issued to a student
 *   /api/fee-payments   the instalments recorded against it
 *
 * Every caller is scoped by role: a student sees their own vouchers, a parent
 * their children's, staff any. The scope is resolved here rather than trusted
 * from a query parameter.
 */

const { sequelize } = require("../database/connection");
const { Op } = require("sequelize");

const FeeVoucher = require("../models/feeVoucher.model");
const FeePayment = require("../models/feePayment.model");

const feeService = require("../services/feeService");
const audit = require("../services/auditService");
// Fee events are the ones families act on, so every one of them that moves a
// balance or asks for money emits a notification to the student and their
// guardians. See services/notificationService.js for why this is separate from
// the audit trail above.
const notify = require("../services/notificationService");
const { formatPKR } = require("../config/currency");
// The routes attach express-validator chains, but a chain only collects
// errors — something has to inspect them. Nothing in this controller did, so
// createVoucherValidation and createPaymentValidation were being run and
// ignored: a POST with no amount_paid reached the service regardless.
const { rejectIfInvalid } = require("../utils/apiError");
const { ROLES } = require("../config/roles");
const {
    resolveStudentId,
    resolveWardIds,
    mayAccessStudent
} = require("../middlewares/selfScope.middleware");

/**
 * Which students the caller may read, as a list of ids — or `null` meaning
 * "no restriction" for staff.
 *
 * Returning null rather than every id in the database keeps the staff query
 * from carrying a 2,000-element IN clause.
 */
const accessibleStudentIds = async (user) => {

    if (!user) return [];

    if (user.role_id === ROLES.SUPER_ADMIN
        || user.role_id === ROLES.ADMIN
        || user.role_id === ROLES.TEACHER
        || user.role_id === ROLES.ACCOUNTANT) {
        return null;
    }

    if (user.role_id === ROLES.STUDENT) {
        const id = await resolveStudentId(user.user_id);
        return id ? [Number(id)] : [];
    }

    if (user.role_id === ROLES.PARENT) {
        return [...(await resolveWardIds(user.user_id))].map(Number);
    }

    return [];
};

const notFound = (res, what) =>
    res.status(404).json({ success: false, message: `${what} not found` });

const serverError = (res, error) => {
    console.error(error);
    return res.status(500).json({
        success: false,
        message: "Internal Server Error"
    });
};

// ===================== VOUCHERS =====================

const getVouchers = async (req, res) => {

    try {

        const scope = await accessibleStudentIds(req.user);
        const where = {};

        if (scope !== null) {
            if (!scope.length) {
                return res.status(200).json({ success: true, count: 0, data: [] });
            }
            where.student_id = { [Op.in]: scope };
        }

        // A staff caller may narrow to one student; a scoped caller asking for
        // someone else's id gets nothing rather than a leak, because the
        // filter is intersected with their scope above.
        const { student_id, status, semester_id } = req.query;

        if (student_id) {
            const requested = Number(student_id);
            if (scope !== null && !scope.includes(requested)) {
                return res.status(403).json({
                    success: false,
                    message: "You can only access your own records"
                });
            }
            where.student_id = requested;
        }

        if (status) where.status = status;
        if (semester_id) where.semester_id = semester_id;

        const vouchers = await FeeVoucher.findAll({
            where,
            include: [{ model: FeePayment, as: "payments" }],
            order: [["due_date", "DESC"], ["fee_voucher_id", "DESC"]]
        });

        return res.status(200).json({
            success: true,
            count: vouchers.length,
            data: vouchers
        });

    } catch (error) {
        return serverError(res, error);
    }
};

const getVoucher = async (req, res) => {

    try {

        const voucher = await FeeVoucher.findByPk(req.params.id, {
            include: [{ model: FeePayment, as: "payments" }]
        });

        if (!voucher) return notFound(res, "Voucher");

        if (!(await mayAccessStudent(req.user, voucher.student_id))) {
            return res.status(403).json({
                success: false,
                message: "You can only access your own records"
            });
        }

        return res.status(200).json({ success: true, data: voucher });

    } catch (error) {
        return serverError(res, error);
    }
};

/**
 * One student's complete position: vouchers, their instalments, and totals
 * including any advance. This is what every portal's fee screen reads, so no
 * screen has to re-derive the arithmetic and get a different answer.
 */
const getStudentFeePosition = async (req, res) => {

    try {

        const studentId = req.ownStudentId ?? req.params.student_id;

        if (!(await mayAccessStudent(req.user, studentId))) {
            return res.status(403).json({
                success: false,
                message: "You can only access your own records"
            });
        }

        const position = await feeService.getStudentPosition(studentId);

        return res.status(200).json({
            success: true,
            student_id: Number(studentId),
            ...position
        });

    } catch (error) {
        return serverError(res, error);
    }
};

/*
 * POST /api/fee-vouchers — raise one semester's challan for one student.
 *
 * The body-to-row mapping this used to do inline now lives in
 * feeService.issueVoucher, because three things have to be decided that a
 * straight insert does not: which semester the voucher belongs to (it was
 * NULL on every row in this database), whether the student already has one for
 * that semester, and what the fee structure says the amount is. See that
 * function for why each matters.
 */
const createVoucher = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return undefined;

        const voucher = await feeService.issueVoucher(req.body, {
            userId: req.user?.user_id ?? null
        });

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.VOUCHER_ISSUED,
            module: audit.MODULES.FEES,
            entity: `fee_vouchers#${voucher.fee_voucher_id}`,
            after: {
                voucherNumber: voucher.voucher_number,
                studentId: voucher.student_id,
                semesterId: voucher.semester_id,
                totalPayable: Number(voucher.total_payable),
                dueDate: voucher.due_date
            },
            req
        });

        /*
         * A challan the family has not been told about is a due date they will
         * miss. High priority: this one asks for money by a date.
         */
        const due = voucher.due_date
            ? new Date(voucher.due_date).toLocaleDateString("en-PK", {
                day: "numeric", month: "long", year: "numeric"
            })
            : null;

        await notify.notifyStudent({
            studentId: voucher.student_id,
            type: notify.TYPES.FEE,
            priority: notify.PRIORITY.HIGH,
            subject: "fees",
            actorUserId: req.user?.user_id,
            title: "Fee challan issued",
            ownMessage: `Challan ${voucher.voucher_number} for ${formatPKR(voucher.total_payable)} `
                + `has been issued${due ? `, payable by ${due}` : ""}.`,
            guardianMessage: (role, who) =>
                `Challan ${voucher.voucher_number} for ${who} — ${formatPKR(voucher.total_payable)}`
                + `${due ? `, payable by ${due}` : ""}.`
        });

        return res.status(201).json({
            success: true,
            message: `Voucher ${voucher.voucher_number} issued.`,
            data: voucher
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({
                success: false,
                message: "That voucher number already exists"
            });
        }
        return serverError(res, error);
    }
};

/**
 * GET /api/fee-payments/submitted — the accounts office's approvals queue.
 *
 * Everything a parent or student has declared and nobody has decided on yet.
 * Without this the Pending rows written by /submit were invisible to staff, so
 * a declared payment could never be verified and the parent's balance never
 * moved. Admin-only, because deciding on these is what moves money.
 */
const getSubmittedPayments = async (req, res) => {

    try {

        const result = await feeService.listSubmittedPayments(req.query);

        return res.status(200).json({ success: true, ...result });

    } catch (error) {
        return serverError(res, error);
    }
};

/**
 * GET /api/fee-payments/history — the payment ledger for a student.
 *
 * Every instalment against that student's vouchers, ordered by the date the
 * accounts office approved it, with the voucher, the semester, the method, the
 * receipt number and both people involved (who declared it, who approved it) on
 * each row.
 *
 * WHY IT IS NOT ADMIN-ONLY
 * ------------------------
 * A parent asking "which of my payments have actually been accepted, and when"
 * is the single most common fee question there is, and the portal had no way to
 * answer it. The scope is the permission: `accessibleStudentIds` returns null
 * for staff (no restriction), the ward ids for a parent, and their own id for a
 * student. It is resolved from the token here — a `student_id` in the query is
 * checked against that set, never trusted as it stands.
 */
const getPaymentHistory = async (req, res) => {

    try {

        const allowed = await accessibleStudentIds(req.user);
        const requested = Number.parseInt(req.query.student_id, 10);

        // Staff. Any student, including none named at all (the institute-wide
        // ledger, which is what the fee reports screen reads).
        if (allowed === null) {
            const result = await feeService.listPaymentHistory(req.query);
            return res.status(200).json({ success: true, ...result });
        }

        if (Number.isInteger(requested) && !allowed.includes(requested)) {
            return res.status(403).json({
                success: false,
                message: "You can only access your own records"
            });
        }

        const result = await feeService.listPaymentHistory({
            ...req.query,
            // Narrowed to the one child when one is named, otherwise every
            // student this caller is entitled to.
            student_id: undefined,
            student_ids: Number.isInteger(requested) ? [requested] : allowed
        });

        return res.status(200).json({ success: true, ...result });

    } catch (error) {
        return serverError(res, error);
    }
};

/*
 * PUT /api/fee-vouchers/:id
 *
 * The edits themselves are in feeService.amendVoucher, for the same reason
 * issuing one is: three of them are decisions rather than assignments — a bill
 * may not be lowered below money already taken, a due date may not precede its
 * issue date, and moving a voucher to another semester may not leave the
 * student holding two live vouchers for one term. Written inline here, those
 * checks ran after the row had already been updated.
 */
const updateVoucher = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return undefined;

        const { voucher, cancelled } = await feeService.amendVoucher(
            req.params.id,
            req.body || {},
            { userId: req.user?.user_id ?? null }
        );

        // Cancelling is the only way a raised challan is withdrawn, and it is
        // what unblocks re-issuing one for the same semester — so it is
        // recorded, while an ordinary date or amount edit is not.
        if (cancelled) {
            await audit.record({
                userId: req.user?.user_id,
                action: audit.ACTIONS.VOUCHER_CANCELLED,
                module: audit.MODULES.FEES,
                entity: `fee_vouchers#${voucher.fee_voucher_id}`,
                after: {
                    voucherNumber: voucher.voucher_number,
                    studentId: voucher.student_id,
                    semesterId: voucher.semester_id,
                    totalPayable: Number(voucher.total_payable)
                },
                req
            });

            // Withdrawing a bill is worth telling the family about for the same
            // reason raising one is: they were asked for money and no longer
            // owe it. An ordinary amount or date edit is not emitted, matching
            // the audit rule directly above.
            await notify.notifyStudent({
                studentId: voucher.student_id,
                type: notify.TYPES.FEE,
                subject: "fees",
                actorUserId: req.user?.user_id,
                title: "Fee challan cancelled",
                ownMessage: `Challan ${voucher.voucher_number} has been cancelled. `
                    + "No payment is due against it.",
                guardianMessage: (role, who) =>
                    `Challan ${voucher.voucher_number} for ${who} has been cancelled. `
                    + "No payment is due against it."
            });
        }

        return res.status(200).json({
            success: true,
            message: cancelled ? "Voucher cancelled." : "Voucher updated",
            data: voucher
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                success: false,
                message: error.message,
                ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
            });
        }
        return serverError(res, error);
    }
};

/*
 * DELETE /api/fee-vouchers/:id
 *
 * Refuses while any payment has been recorded against the voucher, and says
 * how many and how much. The FK is ON DELETE CASCADE, so the delete this used
 * to perform destroyed those payment rows along with the voucher — see
 * feeService.removeVoucher for why cancelling is the answer instead.
 */
const deleteVoucher = async (req, res) => {

    try {

        const result = await feeService.removeVoucher(req.params.id);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.VOUCHER_CANCELLED,
            module: audit.MODULES.FEES,
            entity: `fee_vouchers#${result.id}`,
            before: {
                voucherNumber: result.voucherNumber,
                studentId: result.studentId,
                deleted: true
            },
            req
        });

        return res.status(200).json({
            success: true,
            message: `Voucher ${result.voucherNumber} deleted.`,
            data: result
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                success: false,
                message: error.message,
                ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
            });
        }
        return serverError(res, error);
    }
};

// ===================== PAYMENTS =====================

const getPayments = async (req, res) => {

    try {

        const scope = await accessibleStudentIds(req.user);

        const voucherWhere = {};
        if (scope !== null) {
            if (!scope.length) {
                return res.status(200).json({ success: true, count: 0, data: [] });
            }
            voucherWhere.student_id = { [Op.in]: scope };
        }

        if (req.query.fee_voucher_id) {
            voucherWhere.fee_voucher_id = req.query.fee_voucher_id;
        }

        const payments = await FeePayment.findAll({
            include: [{
                model: FeeVoucher,
                as: "voucher",
                where: voucherWhere,
                // An inner join is what enforces the scope: a payment whose
                // voucher is out of scope cannot come back.
                required: true
            }],
            order: [["payment_date", "DESC"], ["fee_payment_id", "DESC"]]
        });

        return res.status(200).json({
            success: true,
            count: payments.length,
            data: payments
        });

    } catch (error) {
        return serverError(res, error);
    }
};

const createPayment = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return undefined;

        const payment = await feeService.recordPayment(req.body, {
            userId: req.user?.user_id ?? null
        });

        // Cash over the counter. It counts immediately, so who took it is
        // exactly as auditable as who approved a bank transfer.
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PAYMENT_RECORDED,
            module: audit.MODULES.FEES,
            entity: `fee_payments#${payment.fee_payment_id}`,
            after: {
                feeVoucherId: payment.fee_voucher_id,
                amount: Number(payment.amount_paid),
                method: payment.payment_method,
                paymentDate: payment.payment_date,
                receiptNumber: payment.receipt_number
            },
            req
        });

        /*
         * A receipt, sent to the people who handed over the money. `fee_payments`
         * names only the voucher, so the student has to be resolved through it —
         * one lookup, and only on the write path.
         */
        const paidVoucher = await FeeVoucher.findByPk(payment.fee_voucher_id).catch(() => null);

        if (paidVoucher) {
            await notify.notifyStudent({
                studentId: paidVoucher.student_id,
                type: notify.TYPES.FEE,
                subject: "fees",
                actorUserId: req.user?.user_id,
                title: "Payment received",
                ownMessage: `${formatPKR(payment.amount_paid)} received against challan `
                    + `${paidVoucher.voucher_number}. Receipt ${payment.receipt_number}.`,
                guardianMessage: (role, who) =>
                    `${formatPKR(payment.amount_paid)} received for ${who} against challan `
                    + `${paidVoucher.voucher_number}. Receipt ${payment.receipt_number}.`
            });
        }

        return res.status(201).json({
            success: true,
            message: "Payment recorded",
            data: payment
        });

    } catch (error) {
        if (error.status === 404) {
            return res.status(404).json({ success: false, message: error.message });
        }
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({
                success: false,
                message: "That receipt number already exists"
            });
        }
        return serverError(res, error);
    }
};

const updatePayment = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return undefined;

        const payment = await FeePayment.findByPk(req.params.id);
        if (!payment) return notFound(res, "Payment");

        const { amount_paid, payment_method, payment_date } = req.body;

        // Captured before the write. Amending a payment moves a real balance,
        // so the figure it USED to be is the part of the entry that matters.
        const before = {
            feeVoucherId: payment.fee_voucher_id,
            amount: Number(payment.amount_paid),
            method: payment.payment_method,
            paymentDate: payment.payment_date,
            receiptNumber: payment.receipt_number
        };

        await sequelize.transaction(async (transaction) => {
            await payment.update({
                amount_paid: amount_paid ?? payment.amount_paid,
                payment_method: payment_method ?? payment.payment_method,
                payment_date: payment_date ?? payment.payment_date
            }, { transaction });

            // The voucher it belongs to has to be re-settled, or its
            // amount_paid still reflects the old figure.
            await feeService.recalculateVoucher(payment.fee_voucher_id, { transaction });
        });

        const updated = await FeePayment.findByPk(payment.fee_payment_id);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PAYMENT_UPDATED,
            module: audit.MODULES.FEES,
            entity: `fee_payments#${payment.fee_payment_id}`,
            before,
            after: {
                feeVoucherId: updated.fee_voucher_id,
                amount: Number(updated.amount_paid),
                method: updated.payment_method,
                paymentDate: updated.payment_date,
                receiptNumber: updated.receipt_number
            },
            req
        });

        return res.status(200).json({
            success: true,
            message: "Payment updated",
            data: updated
        });

    } catch (error) {
        return serverError(res, error);
    }
};

const deletePayment = async (req, res) => {

    try {

        const payment = await FeePayment.findByPk(req.params.id);
        if (!payment) return notFound(res, "Payment");

        const voucherId = payment.fee_voucher_id;

        /*
         * This is a HARD delete — the row is gone, not flagged — so the audit
         * entry is the only remaining record that the payment ever existed.
         * Snapshotted before destroy() for that reason.
         */
        const before = {
            feePaymentId: payment.fee_payment_id,
            feeVoucherId: voucherId,
            amount: Number(payment.amount_paid),
            method: payment.payment_method,
            paymentDate: payment.payment_date,
            receiptNumber: payment.receipt_number,
            status: payment.status
        };

        await sequelize.transaction(async (transaction) => {
            await payment.destroy({ transaction });
            await feeService.recalculateVoucher(voucherId, { transaction });
        });

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PAYMENT_DELETED,
            module: audit.MODULES.FEES,
            entity: `fee_payments#${before.feePaymentId}`,
            before,
            req
        });

        return res.status(200).json({
            success: true,
            message: "Payment deleted"
        });

    } catch (error) {
        return serverError(res, error);
    }
};

// ============== PARENT-SUBMITTED PAYMENTS ==============

/**
 * POST /api/fee-payments/submit
 *
 * A parent telling the institute they have paid an instalment. The row is
 * written Pending and changes no balance; see
 * feeService.submitPaymentDeclaration for why.
 *
 * The voucher must belong to a student this caller may act for, which is
 * checked here against the same scope every other fee read uses — the client
 * does not get to name a student.
 */
const submitPayment = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return undefined;

        const voucher = await FeeVoucher.findByPk(req.body.fee_voucher_id);
        if (!voucher) return notFound(res, "Voucher");

        if (!(await mayAccessStudent(req.user, voucher.student_id))) {
            /*
             * The route admits students as well as parents, and has since it
             * was written — mayAccessStudent has an explicit STUDENT branch. A
             * student who somehow reached this refusal was being told they may
             * only pay "for your own children", which is not a sentence that
             * means anything to them.
             */
            const ownRecordOnly = req.user?.role_id === ROLES.STUDENT;

            return res.status(403).json({
                success: false,
                message: ownRecordOnly
                    ? "You can only submit payments against your own vouchers."
                    : "You can only submit payments for your own children."
            });
        }

        const payment = await feeService.submitPaymentDeclaration(req.body, {
            userId: req.user?.user_id ?? null
        });

        /*
         * The declaration itself, before anyone in the accounts office has
         * looked at it. Recorded so the pair reads as a pair: this row says
         * what the parent claimed, the PAYMENT_VERIFIED / PAYMENT_REJECTED row
         * says what the office decided about it.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PAYMENT_SUBMITTED,
            module: audit.MODULES.FEES,
            entity: `fee_payments#${payment.fee_payment_id}`,
            after: {
                feeVoucherId: payment.fee_voucher_id,
                studentId: voucher.student_id,
                amount: Number(payment.amount_paid),
                method: payment.payment_method,
                paymentDate: payment.payment_date,
                status: payment.status
            },
            req
        });

        /*
         * The one place a notification travels UPWARD, to staff rather than to a
         * family. A declared payment changes no balance until somebody in the
         * accounts office decides on it, so without this the row sits Pending
         * until an admin happens to open the fee screen and look.
         *
         * Accountants are included alongside administrators because they are the
         * ones who actually make the decision.
         */
        await notify.emit({
            audience: await notify.staffAudience([
                ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT
            ]),
            type: notify.TYPES.FEE,
            priority: notify.PRIORITY.HIGH,
            subject: "fees",
            actorUserId: req.user?.user_id,
            title: "Payment awaiting verification",
            message: `${formatPKR(payment.amount_paid)} declared against challan `
                + `${voucher.voucher_number} by ${payment.payment_method}. Pending verification.`
        });

        return res.status(201).json({
            success: true,
            message:
                "Payment submitted. It will appear on the account once the "
                + "accounts office has verified it.",
            data: payment
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                success: false,
                message: error.message
            });
        }
        return serverError(res, error);
    }
};

/**
 * PUT /api/fee-payments/:id/verify   { status: "Verified" | "Rejected" }
 *
 * The accounts office confirming or refusing a declared payment. Admin-only —
 * this is the step that actually moves money onto the account.
 */
const decidePayment = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return undefined;

        const status = req.body.status === "Rejected" ? "Rejected" : "Verified";

        const payment = await feeService.setPaymentStatus(req.params.id, status, {
            userId: req.user?.user_id ?? null
        });

        /*
         * This is the step that turns a claim into money on the account, so it
         * is the one an auditor asks about: who accepted this transfer, and on
         * what day. A rejection is recorded for the same reason — refusing a
         * parent's payment is a decision someone made.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: status === "Verified"
                ? audit.ACTIONS.PAYMENT_VERIFIED
                : audit.ACTIONS.PAYMENT_REJECTED,
            module: audit.MODULES.FEES,
            entity: `fee_payments#${payment.fee_payment_id}`,
            after: {
                feeVoucherId: payment.fee_voucher_id,
                amount: Number(payment.amount_paid),
                method: payment.payment_method,
                paymentDate: payment.payment_date,
                receiptNumber: payment.receipt_number,
                declaredBy: payment.submitted_by,
                decision: status
            },
            req
        });

        /*
         * The family's half of that pair. A rejection is high priority and the
         * acceptance is not: being told money did not land means the balance is
         * still owed and someone has to do something about it, whereas a
         * confirmation is good news that can wait until the bell is next opened.
         */
        const decidedVoucher = await FeeVoucher.findByPk(payment.fee_voucher_id).catch(() => null);

        if (decidedVoucher) {
            const verified = status === "Verified";

            await notify.notifyStudent({
                studentId: decidedVoucher.student_id,
                type: notify.TYPES.FEE,
                priority: verified ? notify.PRIORITY.NORMAL : notify.PRIORITY.HIGH,
                subject: "fees",
                actorUserId: req.user?.user_id,
                title: verified ? "Payment verified" : "Payment could not be verified",
                ownMessage: verified
                    ? `${formatPKR(payment.amount_paid)} against challan `
                        + `${decidedVoucher.voucher_number} has been verified and applied.`
                    : `${formatPKR(payment.amount_paid)} declared against challan `
                        + `${decidedVoucher.voucher_number} could not be verified. `
                        + "Please contact the accounts office.",
                guardianMessage: (role, who) => (verified
                    ? `${formatPKR(payment.amount_paid)} for ${who} has been verified and `
                        + `applied to challan ${decidedVoucher.voucher_number}.`
                    : `${formatPKR(payment.amount_paid)} declared for ${who} against challan `
                        + `${decidedVoucher.voucher_number} could not be verified. `
                        + "Please contact the accounts office.")
            });
        }

        return res.status(200).json({
            success: true,
            message: status === "Verified"
                ? "Payment verified and applied to the voucher."
                : "Payment rejected.",
            data: payment
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                success: false,
                message: error.message
            });
        }
        return serverError(res, error);
    }
};

module.exports = {
    getVouchers,
    getVoucher,
    getStudentFeePosition,
    getSubmittedPayments,
    getPaymentHistory,
    createVoucher,
    updateVoucher,
    deleteVoucher,
    getPayments,
    createPayment,
    updatePayment,
    deletePayment,
    submitPayment,
    decidePayment
};
