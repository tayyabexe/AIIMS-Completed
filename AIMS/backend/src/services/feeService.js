/*
 * The fee module's arithmetic, in one place.
 *
 * Before consolidation this logic did not exist server-side at all: each
 * portal re-derived a student's position from whichever of the five fee tables
 * it happened to read, and they disagreed. The parent portal reported a
 * part-settled voucher as wholly unpaid because the view it read summed only
 * one of the two payment tables.
 *
 * Every write to fee_payments goes through recalculateVoucher(), so
 * amount_paid, remaining_balance and status on fee_vouchers are always the
 * arithmetic of the instalments beneath them.
 */

const { sequelize } = require("../database/connection");
const FeeVoucher = require("../models/feeVoucher.model");
const FeePayment = require("../models/feePayment.model");

const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const select = (sql, replacements, transaction) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements,
        transaction
    });

/**
 * Recomputes one voucher's totals and status from its own payments.
 *
 * Status is derived, never taken from a caller: the legacy data had vouchers
 * stored as "Overdue" that had in fact been part-paid, because the label was
 * set once at issue and never revisited.
 *
 * "Cancelled" is the one status the arithmetic does not own - it is an
 * administrative decision - so it is left alone.
 */
const recalculateVoucher = async (feeVoucherId, { transaction } = {}) => {

    const voucher = await FeeVoucher.findByPk(feeVoucherId, { transaction });

    if (!voucher) return null;

    /*
     * Verified instalments only.
     *
     * A parent can declare a payment from their own portal, which lands as
     * Pending. Counting it here would let anyone clear a balance by submitting
     * a number, so a declaration stays outside the arithmetic until an admin
     * verifies it. Rejected rows are kept for the audit trail and never count.
     */
    const [row] = await sequelize.query(
        `SELECT COALESCE(SUM(amount_paid), 0) AS paid
           FROM fee_payments
          WHERE fee_voucher_id = :id
            AND status = 'Verified'`,
        {
            replacements: { id: feeVoucherId },
            type: sequelize.QueryTypes.SELECT,
            transaction
        }
    );

    const paid = money(row.paid);
    const billed = money(voucher.total_payable);
    const remaining = money(billed - paid);

    let status = voucher.status;

    if (status !== "Cancelled") {
        if (billed > 0 && paid >= billed) status = "Paid";
        else if (paid > 0) status = "Partial";
        else if (voucher.due_date && new Date(voucher.due_date) < new Date(new Date().toDateString())) status = "Overdue";
        else status = "Unpaid";
    }

    await voucher.update(
        {
            amount_paid: paid,
            remaining_balance: remaining,
            status
        },
        { transaction }
    );

    return voucher;
};

/**
 * A student's whole fee position: every voucher, its instalments, and the
 * totals — including any advance.
 *
 * `advance` is the overpayment left once every outstanding voucher is
 * covered. It is reported rather than netted off the billed total, so the
 * summary always reconciles against the voucher rows beneath it.
 */
const getStudentPosition = async (studentId) => {

    const rows = await FeeVoucher.findAll({
        where: { student_id: studentId },
        include: [{ model: FeePayment, as: "payments" }],
        order: [["due_date", "DESC"], ["fee_voucher_id", "DESC"]]
    });

    /*
     * Which semester each voucher belongs to.
     *
     * A voucher is raised per semester — that is the billing cycle this
     * institute actually runs on — so the history is only readable if each row
     * can say which one it settles. Resolved in one query keyed by id rather
     * than as an association include, because `semester_id` is nullable and a
     * required join would silently drop every voucher carried across from the
     * legacy tables, none of which had one.
     */
    const semesterIds = [...new Set(rows.map((v) => v.semester_id).filter(Boolean))];

    const semesters = semesterIds.length
        ? await select(
            `SELECT sem.semester_id, sem.semester_number, sem.start_date, sem.end_date,
                    p.program_name
               FROM semesters sem
               LEFT JOIN programs p ON p.program_id = sem.program_id
              WHERE sem.semester_id IN (:ids)`,
            { ids: semesterIds }
        )
        : [];

    const semesterById = new Map(semesters.map((s) => [Number(s.semester_id), s]));

    /*
     * Settlement, in two passes.
     *
     * Pass 1 credits each voucher only with money paid directly against it,
     * capped at what it bills. Anything beyond the bill is an overpayment and
     * goes into a pool rather than being netted off the account total —
     * otherwise a Rs. 60,000 payment on a Rs. 45,000 voucher silently knocks
     * Rs. 15,000 off an unrelated voucher and the summary stops matching the
     * rows beneath it.
     *
     * Pass 2 spends the pool oldest-due-date first and records how much each
     * voucher received that way, so a screen can say where the money came from
     * and billed - paid === due closes exactly.
     *
     * This ran on the client before, in two separate implementations that had
     * already drifted apart. It belongs here: one answer, both portals.
     */
    const settled = rows
        .map((v) => {
            const billed = money(v.total_payable);
            const received = money(v.amount_paid);
            return {
                row: v,
                billed,
                directPaid: Math.min(received, billed),
                surplus: Math.max(0, money(received - billed)),
                carriedIn: 0
            };
        })
        .sort((a, b) => String(a.row.due_date || "").localeCompare(String(b.row.due_date || "")));

    let pool = money(settled.reduce((t, v) => t + v.surplus, 0));

    for (const v of settled) {
        if (pool <= 0) break;
        const remaining = money(v.billed - v.directPaid);
        if (remaining <= 0) continue;
        const applied = Math.min(pool, remaining);
        v.carriedIn = applied;
        pool = money(pool - applied);
    }

    const vouchers = settled
        .map((v) => {
            const paid = money(v.directPaid + v.carriedIn);
            const plain = v.row.toJSON();
            const semester = semesterById.get(Number(plain.semester_id));
            return {
                ...plain,
                // The arithmetic the screens render. `amount_paid` on the row
                // stays as recorded; these say what it settles once
                // overpayment has been carried across.
                settled_paid: paid,
                settled_due: money(Math.max(0, v.billed - paid)),
                carried_in: v.carriedIn,
                // Null for the vouchers carried over from the legacy tables,
                // which never recorded a semester. Shown as "Unassigned"
                // rather than guessed at.
                semester: semester
                    ? {
                        semester_id: Number(semester.semester_id),
                        semester_number: Number(semester.semester_number),
                        label: `Semester ${semester.semester_number}`,
                        program_name: semester.program_name || null,
                        start_date: semester.start_date || null,
                        end_date: semester.end_date || null
                    }
                    : null,
                // What is awaiting an accounts decision on THIS voucher, so a
                // parent can see their submission landed without the balance
                // moving.
                pending_amount: money(
                    (plain.payments || [])
                        .filter((p) => p.status === "Pending")
                        .reduce((s, p) => s + money(p.amount_paid), 0)
                )
            };
        })
        .sort((a, b) => String(b.due_date || "").localeCompare(String(a.due_date || "")));

    const billed = money(vouchers.reduce((t, v) => t + money(v.total_payable), 0));
    const paid = money(vouchers.reduce((t, v) => t + money(v.amount_paid), 0));
    const due = money(vouchers.reduce((t, v) => t + v.settled_due, 0));

    /*
     * Money a parent has declared but no one has confirmed yet.
     *
     * Reported separately and never netted off `due`: until an admin verifies
     * it, the institute has not been told by anyone but the payer that it
     * arrived. The screens show it as "awaiting verification" so a parent can
     * see their submission was received without the balance moving.
     */
    const pending = money(
        vouchers.reduce(
            (t, v) => t + (v.payments || [])
                .filter((p) => p.status === "Pending")
                .reduce((s, p) => s + money(p.amount_paid), 0),
            0
        )
    );

    return {
        vouchers,
        totals: {
            billed,
            paid,
            due,
            // Overpayment left once every outstanding voucher is covered.
            advance: money(pool),
            pending
        }
    };
};

/** The next receipt number, e.g. "RCP-2026-000104". */
const nextReceiptNumber = async ({ transaction } = {}) => {

    const year = new Date().getFullYear();
    const prefix = `RCP-${year}-`;

    const [row] = await sequelize.query(
        `SELECT receipt_number
           FROM fee_payments
          WHERE receipt_number LIKE :prefix
       ORDER BY receipt_number DESC
          LIMIT 1`,
        {
            replacements: { prefix: `${prefix}%` },
            type: sequelize.QueryTypes.SELECT,
            transaction
        }
    );

    const last = row ? Number(String(row.receipt_number).slice(prefix.length)) : 0;
    const next = (Number.isFinite(last) ? last : 0) + 1;

    return `${prefix}${String(next).padStart(6, "0")}`;
};

/** The next voucher number, e.g. "VCH-2026-000103". */
const nextVoucherNumber = async ({ transaction } = {}) => {

    const year = new Date().getFullYear();
    const prefix = `VCH-${year}-`;

    const [row] = await sequelize.query(
        `SELECT voucher_number
           FROM fee_vouchers
          WHERE voucher_number LIKE :prefix
       ORDER BY voucher_number DESC
          LIMIT 1`,
        {
            replacements: { prefix: `${prefix}%` },
            type: sequelize.QueryTypes.SELECT,
            transaction
        }
    );

    const last = row ? Number(String(row.voucher_number).slice(prefix.length)) : 0;
    const next = (Number.isFinite(last) ? last : 0) + 1;

    return `${prefix}${String(next).padStart(6, "0")}`;
};

// ====================================================================
// ISSUING A VOUCHER
// ====================================================================
/*
 * Raising the semester's challan for one student.
 *
 * WHY THIS IS NOT JUST FeeVoucher.create()
 * ----------------------------------------
 * `fee_vouchers.semester_id` was 100% NULL across every row. The column existed
 * and nothing ever filled it, which made "this student's voucher for semester
 * 4" an unanswerable question — the history could only be read as an
 * undifferentiated pile of challans. Three things fix that, and all three have
 * to happen together or the column drifts back to NULL:
 *
 *   1. The semester is resolved rather than optional. If the caller does not
 *      name one, the student's own `current_semester_id` is used. Only a
 *      student who has never been placed in a semester produces a voucher
 *      without one.
 *
 *   2. A student cannot be billed twice for the same semester. Without this,
 *      clicking Issue twice raises two challans for one term and the student's
 *      balance doubles. A cancelled voucher does not block a reissue, because
 *      cancelling is exactly how a mistaken challan is withdrawn.
 *
 *   3. The amount comes from the fee structure for that programme and semester
 *      when the caller does not override it, so the figure billed is the figure
 *      on record rather than one typed in each time.
 */
const issueVoucher = async (payload, { userId = null } = {}) => {

    return sequelize.transaction(async (transaction) => {

        const [student] = await select(
            `SELECT s.student_id, s.program_id, s.current_semester_id,
                    s.registration_number,
                    CONCAT(s.first_name, ' ', s.last_name) AS name
               FROM students s
              WHERE s.student_id = :id AND s.is_deleted = 0`,
            { id: payload.student_id },
            transaction
        );

        if (!student) {
            const error = new Error("Student not found");
            error.status = 404;
            throw error;
        }

        const semesterId = payload.semester_id || student.current_semester_id || null;

        if (semesterId) {
            const [clash] = await select(
                `SELECT fee_voucher_id, voucher_number
                   FROM fee_vouchers
                  WHERE student_id = :studentId
                    AND semester_id = :semesterId
                    AND status <> 'Cancelled'
                  LIMIT 1`,
                { studentId: student.student_id, semesterId },
                transaction
            );

            if (clash) {
                const error = new Error(
                    `${student.name} already has voucher ${clash.voucher_number} for this `
                    + "semester. Cancel it before issuing a replacement."
                );
                error.status = 409;
                throw error;
            }
        }

        /*
         * The amount, in order of authority: what the caller typed, then the
         * fee structure for this programme and semester, then nothing. A
         * voucher for zero is refused — it bills the student for nothing and
         * only clutters their history.
         */
        let feeStructureId = payload.fee_structure_id ?? null;
        let total = payload.total_payable != null ? money(payload.total_payable) : null;

        if (total === null || feeStructureId === null) {
            /*
             * A programme's fee for a semester is spread across several
             * `fee_structures` rows — one per category (Tuition, Examination,
             * Laboratory, Library) — so the amount billed is their sum, not any
             * single row. `fee_structure_id` on the voucher can only hold one
             * of them, so it holds the largest, which in this data is always
             * the tuition line.
             */
            const structures = await select(
                `SELECT fee_structure_id, amount
                   FROM fee_structures
                  WHERE program_id = :programId
                    AND (:semesterId IS NULL OR semester_id = :semesterId)
                  ORDER BY amount DESC, fee_structure_id`,
                { programId: student.program_id, semesterId },
                transaction
            );

            if (structures.length) {
                if (feeStructureId === null) feeStructureId = structures[0].fee_structure_id;
                if (total === null) {
                    total = money(structures.reduce((sum, s) => sum + Number(s.amount || 0), 0));
                }
            }
        }

        if (total === null || total <= 0) {
            const error = new Error(
                "No amount to bill. Either enter one, or add a fee structure for this "
                + "programme and semester."
            );
            error.status = 400;
            throw error;
        }

        const voucherNumber = payload.voucher_number
            || await nextVoucherNumber({ transaction });

        const issueDate = payload.issue_date || new Date().toISOString().slice(0, 10);

        const voucher = await FeeVoucher.create(
            {
                student_id: student.student_id,
                fee_structure_id: feeStructureId,
                semester_id: semesterId,
                voucher_number: voucherNumber,
                issue_date: issueDate,
                due_date: payload.due_date || null,
                total_payable: total,
                amount_paid: 0,
                remaining_balance: total,
                status: "Unpaid"
            },
            { transaction }
        );

        // Marks it Overdue immediately if it was raised with a past due date,
        // rather than waiting for the nightly procedure to notice.
        await recalculateVoucher(voucher.fee_voucher_id, { transaction });

        return FeeVoucher.findByPk(voucher.fee_voucher_id, { transaction });
    });
};

// ====================================================================
// THE APPROVALS QUEUE
// ====================================================================
/*
 * Every payment a parent or student has declared and nobody has yet decided on.
 *
 * This is the other half of submitPaymentDeclaration. A declaration that lands
 * Pending and is never surfaced to an accounts officer is a payment the
 * institute has been told about and will never confirm — the parent sees
 * "awaiting verification" forever and the balance never moves. The screen that
 * reads this is what closes the loop.
 *
 * `status` defaults to Pending because that is the queue; passing Verified or
 * Rejected turns the same endpoint into the decision history.
 */
const listSubmittedPayments = async ({
    status = "Pending", student_id, page = 1, limit = 25
} = {}) => {

    const size = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const current = Math.max(Number(page) || 1, 1);
    const offset = (current - 1) * size;

    const clauses = ["p.status = :status"];
    const replacements = { status, limit: size, offset };

    if (student_id) {
        clauses.push("v.student_id = :studentId");
        replacements.studentId = Number(student_id);
    }

    const where = clauses.join(" AND ");

    const joined = `
          FROM fee_payments p
          JOIN fee_vouchers v ON v.fee_voucher_id = p.fee_voucher_id
          JOIN students    s  ON s.student_id     = v.student_id
          LEFT JOIN semesters sem ON sem.semester_id = v.semester_id
          LEFT JOIN users  su ON su.user_id        = p.submitted_by
         WHERE ${where}
    `;

    const [[{ total }], rows] = await Promise.all([
        select(`SELECT COUNT(*) AS total ${joined}`, replacements),
        select(
            `SELECT p.fee_payment_id, p.amount_paid, p.payment_method, p.payment_date,
                    p.status, p.created_at, p.receipt_number, p.submitted_by,
                    su.email            AS submitted_by_email,
                    v.fee_voucher_id, v.voucher_number, v.total_payable,
                    v.amount_paid       AS voucher_paid,
                    v.remaining_balance, v.due_date, v.status AS voucher_status,
                    sem.semester_number,
                    s.student_id, s.registration_number,
                    CONCAT(s.first_name, ' ', s.last_name) AS student_name
             ${joined}
          ORDER BY p.created_at DESC, p.fee_payment_id DESC
             LIMIT :limit OFFSET :offset`,
            replacements
        )
    ]);

    return {
        rows: rows.map((r) => ({
            id: r.fee_payment_id,
            amount: money(r.amount_paid),
            method: r.payment_method,
            paidOn: r.payment_date,
            status: r.status,
            submittedAt: r.created_at,
            receiptNumber: r.receipt_number,
            // Who declared it. Kept distinct from whoever later verifies it,
            // which is what `recorded_by` holds.
            submittedBy: r.submitted_by
                ? { userId: r.submitted_by, email: r.submitted_by_email }
                : null,
            voucher: {
                id: r.fee_voucher_id,
                number: r.voucher_number,
                billed: money(r.total_payable),
                paid: money(r.voucher_paid),
                outstanding: money(r.remaining_balance),
                dueDate: r.due_date,
                status: r.voucher_status,
                semester: r.semester_number ? `Semester ${r.semester_number}` : null
            },
            student: {
                id: r.student_id,
                regNo: r.registration_number,
                name: String(r.student_name || "").trim()
            }
        })),
        pagination: {
            page: current,
            limit: size,
            total: Number(total),
            pages: Math.max(Math.ceil(Number(total) / size), 1)
        }
    };
};

// ====================================================================
// PAYMENT HISTORY
// ====================================================================
/*
 * Every payment made against a student's vouchers, on the timeline that
 * matters: when the accounts office approved it.
 *
 * WHY THIS IS NOT listSubmittedPayments WITH A FILTER
 * --------------------------------------------------
 * That one is a work queue — one status at a time, ordered by when the claim
 * arrived, so the oldest undecided sits at the top. This is a ledger: every
 * status together, ordered by when each was decided, so the row above a payment
 * is the one approved before it. Those two orderings cannot be the same
 * endpoint, and the queue's default of Pending-only is exactly wrong for a
 * history.
 *
 * ORDERING AND THE NULL PROBLEM
 * -----------------------------
 * `verified_at` is NULL for anything still Pending — it has no approval moment
 * yet. Sorting by it alone would scatter those rows to one end depending on the
 * dialect. They are kept deliberately at the top instead: an undecided claim is
 * the thing on this screen someone has to act on, and burying it under two
 * years of settled instalments is how it stopped being acted on before.
 *
 * `approvedAtIsApproximate` marks the rows whose approval time was backfilled
 * from updated_at by migration 20260812160000 — recognisable because they are
 * Verified but have no verified_by. The distinction is surfaced rather than
 * smoothed over: those timestamps are evidence of an edit, and only probably of
 * the approval.
 */
const listPaymentHistory = async ({
    student_id, student_ids, fee_voucher_id, status, from, to, page = 1, limit = 25
} = {}) => {

    const size = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const current = Math.max(Number(page) || 1, 1);
    const offset = (current - 1) * size;

    const clauses = ["1 = 1"];
    const replacements = { limit: size, offset };

    const studentId = Number.parseInt(student_id, 10);
    if (Number.isInteger(studentId)) {
        clauses.push("v.student_id = :studentId");
        replacements.studentId = studentId;
    }

    /*
     * The caller's permitted set, supplied by the controller and never by the
     * request. A parent with two children asking for "my history" means both,
     * which a single student_id cannot express — and an empty array here means
     * a role that may read nobody, which must return nothing rather than
     * everything. `IN ()` is not valid SQL, so that case is written as a
     * clause that cannot match.
     */
    if (Array.isArray(student_ids)) {
        if (!student_ids.length) {
            clauses.push("1 = 0");
        } else {
            clauses.push("v.student_id IN (:studentIds)");
            replacements.studentIds = student_ids.map(Number);
        }
    }

    const voucherId = Number.parseInt(fee_voucher_id, 10);
    if (Number.isInteger(voucherId)) {
        clauses.push("p.fee_voucher_id = :voucherId");
        replacements.voucherId = voucherId;
    }

    if (["Pending", "Verified", "Rejected"].includes(status)) {
        clauses.push("p.status = :status");
        replacements.status = status;
    }

    // The window is applied to the approval date, not the claimed payment date,
    // because that is the timeline this endpoint is sorted on — a range that
    // filtered one column and ordered by another would return rows in an order
    // the dates on screen do not explain.
    if (from) {
        clauses.push("p.verified_at >= :from");
        replacements.from = from;
    }
    if (to) {
        clauses.push("p.verified_at < DATE_ADD(:to, INTERVAL 1 DAY)");
        replacements.to = to;
    }

    const joined = `
          FROM fee_payments p
          JOIN fee_vouchers v   ON v.fee_voucher_id = p.fee_voucher_id
          JOIN students     s   ON s.student_id     = v.student_id
          LEFT JOIN semesters sem ON sem.semester_id = v.semester_id
          LEFT JOIN programs  pr  ON pr.program_id   = s.program_id
          LEFT JOIN users     su  ON su.user_id      = p.submitted_by
          LEFT JOIN users     vu  ON vu.user_id      = p.verified_by
          LEFT JOIN users     ru  ON ru.user_id      = p.recorded_by
         WHERE ${clauses.join(" AND ")}
    `;

    const [[{ total }], [totals], rows] = await Promise.all([
        select(`SELECT COUNT(*) AS total ${joined}`, replacements),
        // The three figures the header needs, over the WHOLE filtered set
        // rather than over the page — a total that changes when you turn the
        // page is not a total.
        select(
            `SELECT
                COALESCE(SUM(CASE WHEN p.status = 'Verified' THEN p.amount_paid END), 0) AS verified,
                COALESCE(SUM(CASE WHEN p.status = 'Pending'  THEN p.amount_paid END), 0) AS pending,
                COALESCE(SUM(CASE WHEN p.status = 'Rejected' THEN p.amount_paid END), 0) AS rejected
             ${joined}`,
            replacements
        ),
        select(
            `SELECT p.fee_payment_id, p.amount_paid, p.payment_method, p.payment_date,
                    p.status, p.receipt_number, p.is_late,
                    p.created_at, p.verified_at,
                    p.submitted_by, su.email AS submitted_by_email,
                    p.verified_by,  vu.email AS verified_by_email,
                    p.recorded_by,  ru.email AS recorded_by_email,
                    v.fee_voucher_id, v.voucher_number, v.total_payable,
                    v.amount_paid AS voucher_paid, v.remaining_balance,
                    v.due_date, v.issue_date, v.status AS voucher_status,
                    sem.semester_id, sem.semester_number,
                    s.student_id, s.registration_number,
                    CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                    pr.program_name
             ${joined}
          ORDER BY p.verified_at IS NULL DESC, p.verified_at DESC, p.fee_payment_id DESC
             LIMIT :limit OFFSET :offset`,
            replacements
        )
    ]);

    return {
        rows: rows.map((r) => ({
            id: r.fee_payment_id,
            amount: money(r.amount_paid),
            method: r.payment_method,
            status: r.status,
            receiptNumber: r.receipt_number || null,
            isLate: !!r.is_late,

            // The three moments, never conflated.
            claimedPaidOn: r.payment_date,   // what the family says
            declaredAt: r.created_at,        // when they said it
            approvedAt: r.verified_at,       // when the institute agreed

            // See the header comment: Verified with no approver is a row the
            // migration dated, not one this system watched being approved.
            approvedAtIsApproximate: r.status === "Verified"
                && !!r.verified_at
                && r.verified_by === null,

            declaredBy: r.submitted_by
                ? { userId: r.submitted_by, email: r.submitted_by_email }
                : null,
            approvedBy: r.verified_by
                ? { userId: r.verified_by, email: r.verified_by_email }
                : null,
            recordedBy: r.recorded_by
                ? { userId: r.recorded_by, email: r.recorded_by_email }
                : null,

            voucher: {
                id: r.fee_voucher_id,
                number: r.voucher_number,
                billed: money(r.total_payable),
                paid: money(r.voucher_paid),
                outstanding: money(r.remaining_balance),
                issueDate: r.issue_date,
                dueDate: r.due_date,
                status: r.voucher_status,
                semesterId: r.semester_id ?? null,
                semester: r.semester_number ? `Semester ${r.semester_number}` : null
            },

            student: {
                id: r.student_id,
                regNo: r.registration_number,
                name: String(r.student_name || "").trim(),
                program: r.program_name || null
            }
        })),
        totals: {
            verified: money(totals?.verified),
            pending: money(totals?.pending),
            rejected: money(totals?.rejected)
        },
        pagination: {
            page: current,
            limit: size,
            total: Number(total),
            pages: Math.max(Math.ceil(Number(total) / size), 1)
        }
    };
};

/**
 * Records an instalment and re-settles its voucher, in one transaction so a
 * payment can never exist without the voucher totals that account for it.
 */
const recordPayment = async (payload, { userId = null } = {}) => {

    return sequelize.transaction(async (transaction) => {

        const voucher = await FeeVoucher.findByPk(payload.fee_voucher_id, { transaction });

        if (!voucher) {
            const error = new Error("Voucher not found");
            error.status = 404;
            throw error;
        }

        const receiptNumber = payload.receipt_number
            || await nextReceiptNumber({ transaction });

        // Late is decided against the voucher's own due date rather than being
        // taken on trust from the caller.
        const paidOn = payload.payment_date ? new Date(payload.payment_date) : new Date();
        const isLate = voucher.due_date ? paidOn > new Date(voucher.due_date) : false;

        const payment = await FeePayment.create(
            {
                fee_voucher_id: voucher.fee_voucher_id,
                receipt_number: receiptNumber,
                amount_paid: money(payload.amount_paid),
                payment_method: payload.payment_method || "Other",
                payment_date: payload.payment_date || null,
                is_late: isLate,
                // Entered by the office, so it counts immediately — which
                // means it is also approved at this moment, by this person.
                // Recording that here keeps counter payments and portal
                // declarations on the same timeline in the history view;
                // otherwise every payment taken at the desk would show no
                // approval date at all.
                status: "Verified",
                recorded_by: userId,
                verified_at: new Date(),
                verified_by: userId
            },
            { transaction }
        );

        await recalculateVoucher(voucher.fee_voucher_id, { transaction });

        return payment;
    });
};

/**
 * Records a payment a PARENT says they have made.
 *
 * The difference from recordPayment is the whole point of this function: the
 * row is written Pending and the voucher is deliberately NOT re-settled, so a
 * declaration moves no money. It becomes real only when an admin calls
 * setPaymentStatus(id, "Verified").
 *
 * No receipt number is issued either — a receipt is the institute's
 * acknowledgement that it holds the money, and at this point it has not said
 * that. `nextReceiptNumber` runs at verification instead.
 */
const submitPaymentDeclaration = async (payload, { userId = null } = {}) => {

    return sequelize.transaction(async (transaction) => {

        const voucher = await FeeVoucher.findByPk(payload.fee_voucher_id, { transaction });

        if (!voucher) {
            const error = new Error("Voucher not found");
            error.status = 404;
            throw error;
        }

        if (voucher.status === "Cancelled") {
            const error = new Error("That voucher has been cancelled and cannot be paid.");
            error.status = 409;
            throw error;
        }

        const amount = money(payload.amount_paid);

        if (amount <= 0) {
            const error = new Error("The amount must be greater than zero.");
            error.status = 400;
            throw error;
        }

        /*
         * A declaration may not exceed what is still owed, counting anything
         * already awaiting verification. Without this a parent could submit the
         * same instalment repeatedly and the pending figure would climb past
         * the bill, which reads to an admin as though far more was owed.
         */
        const [outstanding] = await sequelize.query(
            `SELECT v.total_payable
                  - COALESCE(SUM(CASE WHEN p.status IN ('Verified','Pending')
                                      THEN p.amount_paid END), 0) AS unclaimed
               FROM fee_vouchers v
               LEFT JOIN fee_payments p ON p.fee_voucher_id = v.fee_voucher_id
              WHERE v.fee_voucher_id = :id
              GROUP BY v.fee_voucher_id, v.total_payable`,
            {
                replacements: { id: voucher.fee_voucher_id },
                type: sequelize.QueryTypes.SELECT,
                transaction
            }
        );

        const room = money(outstanding ? outstanding.unclaimed : voucher.total_payable);

        if (room <= 0) {
            const error = new Error("This voucher is already settled or fully claimed.");
            error.status = 409;
            throw error;
        }

        if (amount > room) {
            const error = new Error(
                `That is more than the ${room.toFixed(2)} still outstanding on this voucher.`
            );
            error.status = 400;
            throw error;
        }

        const paidOn = payload.payment_date ? new Date(payload.payment_date) : new Date();
        const isLate = voucher.due_date ? paidOn > new Date(voucher.due_date) : false;

        return FeePayment.create(
            {
                fee_voucher_id: voucher.fee_voucher_id,
                receipt_number: null,
                amount_paid: amount,
                payment_method: payload.payment_method || "Bank Transfer",
                payment_date: payload.payment_date || null,
                is_late: isLate,
                status: "Pending",
                submitted_by: userId
            },
            { transaction }
        );
    });
};

// ====================================================================
// REMOVING A VOUCHER
// ====================================================================
/*
 * WHY THIS IS NOT voucher.destroy()
 * ---------------------------------
 * `fee_payments.fee_voucher_id` is ON DELETE CASCADE. Deleting a voucher
 * therefore deletes every instalment recorded against it — silently, in the
 * database, with no soft-delete flag anywhere on `fee_payments` to recover
 * from. A student who had paid Rs. 45,000 across two verified instalments lost
 * the record that the institute ever received the money, and the receipt
 * numbers issued for it stopped resolving to anything.
 *
 * So a voucher carrying verified money cannot be deleted. Cancelling is what
 * withdrawing a challan already means here: it is the one status an admin may
 * set by hand, it stops the voucher counting against the student, it unblocks
 * re-issuing one for the same semester, and it keeps every payment row intact.
 * The refusal names both the count and the total, because "cancel it instead"
 * is only convincing if the reply says how much money is at stake.
 *
 * Unverified claims are treated the same way, and deliberately. A Pending row
 * is a family saying they have paid and waiting to hear back; a Rejected one is
 * the institute's record of having refused them. Deleting the voucher would
 * erase both without either being answered.
 */
const removeVoucher = async (voucherId) => {

    const voucher = await FeeVoucher.findByPk(voucherId);

    if (!voucher) {
        const error = new Error("Voucher not found");
        error.status = 404;
        throw error;
    }

    const [counts] = await select(
        `SELECT
            COUNT(*) AS total,
            COALESCE(SUM(status = 'Verified'), 0)                             AS verified,
            COALESCE(SUM(CASE WHEN status = 'Verified' THEN amount_paid END), 0) AS verified_amount,
            COALESCE(SUM(status = 'Pending'), 0)                              AS pending,
            COALESCE(SUM(status = 'Rejected'), 0)                             AS rejected
           FROM fee_payments
          WHERE fee_voucher_id = :id`,
        { id: voucherId }
    );

    const verified = Number(counts?.verified || 0);
    const pending = Number(counts?.pending || 0);
    const rejected = Number(counts?.rejected || 0);

    if (verified || pending || rejected) {
        const blockedBy = [];

        if (verified) {
            blockedBy.push(
                `${verified} verified payment${verified === 1 ? "" : "s"} `
                + `totalling ${money(counts.verified_amount).toFixed(2)}`
            );
        }
        if (pending) {
            blockedBy.push(`${pending} payment${pending === 1 ? "" : "s"} awaiting verification`);
        }
        if (rejected) {
            blockedBy.push(`${rejected} rejected payment${rejected === 1 ? "" : "s"}`);
        }

        const error = new Error(
            `Voucher ${voucher.voucher_number} has ${blockedBy.join(", ")} recorded `
            + "against it, and deleting it would destroy those records. Cancel the "
            + "voucher instead."
        );
        error.status = 409;
        error.blockedBy = blockedBy;
        throw error;
    }

    // Nothing has ever been recorded against it, so there is nothing to lose.
    await voucher.destroy();

    return {
        id: Number(voucherId),
        voucherNumber: voucher.voucher_number,
        studentId: voucher.student_id,
        deleted: true
    };
};

/**
 * Applies an admin's edits to a raised voucher.
 *
 * `amount_paid` and `remaining_balance` are absent from the accepted fields on
 * purpose: they are owned by the payment rows beneath, and letting a screen
 * write them is exactly how the retired fee tables drifted away from the money
 * recorded against them. Everything accepted here is re-settled afterwards.
 */
const amendVoucher = async (voucherId, body = {}, { userId = null } = {}) => {

    return sequelize.transaction(async (transaction) => {

        const voucher = await FeeVoucher.findByPk(voucherId, { transaction });

        if (!voucher) {
            const error = new Error("Voucher not found");
            error.status = 404;
            throw error;
        }

        const patch = {};

        if (body.total_payable !== undefined && body.total_payable !== null) {
            const total = money(body.total_payable);

            if (total <= 0) {
                const error = new Error(
                    "A voucher has to bill something. Cancel it rather than setting it to zero."
                );
                error.status = 400;
                throw error;
            }

            /*
             * The bill cannot be lowered below money already taken. Doing so
             * makes remaining_balance negative and the student's position report
             * an advance the institute never received — and the reason the
             * figure is being lowered is always that somebody opened the wrong
             * voucher.
             */
            const [{ paid }] = await select(
                `SELECT COALESCE(SUM(amount_paid), 0) AS paid
                   FROM fee_payments
                  WHERE fee_voucher_id = :id AND status = 'Verified'`,
                { id: voucherId },
                transaction
            );

            if (total < money(paid)) {
                const error = new Error(
                    `${money(paid).toFixed(2)} has already been verified against this `
                    + `voucher, so it cannot be re-billed at ${total.toFixed(2)}.`
                );
                error.status = 409;
                throw error;
            }

            patch.total_payable = total;
        }

        if (body.issue_date !== undefined) patch.issue_date = body.issue_date || null;
        if (body.due_date !== undefined) patch.due_date = body.due_date || null;

        // Dates are checked against each other rather than each on its own: a
        // partial update can name only one of the pair, so the stored row is
        // what the comparison has to be made against.
        const issue = String(patch.issue_date ?? voucher.issue_date ?? "").slice(0, 10);
        const due = String(patch.due_date ?? voucher.due_date ?? "").slice(0, 10);

        if (issue && due && due < issue) {
            const error = new Error("The due date cannot be before the issue date.");
            error.status = 400;
            throw error;
        }

        if (body.semester_id !== undefined) {
            const semesterId = body.semester_id === null ? null : Number(body.semester_id);

            if (semesterId !== null) {
                const [semester] = await select(
                    "SELECT semester_id FROM semesters WHERE semester_id = :id",
                    { id: semesterId },
                    transaction
                );
                if (!semester) {
                    const error = new Error(`Semester ${semesterId} does not exist.`);
                    error.status = 400;
                    throw error;
                }

                /*
                 * The same rule issueVoucher enforces, applied to a move: a
                 * student may not end up holding two live vouchers for one
                 * semester, which is what doubles their balance.
                 */
                const [clash] = await select(
                    `SELECT voucher_number FROM fee_vouchers
                      WHERE student_id = :studentId AND semester_id = :semesterId
                        AND status <> 'Cancelled' AND fee_voucher_id <> :id
                      LIMIT 1`,
                    { studentId: voucher.student_id, semesterId, id: voucherId },
                    transaction
                );

                if (clash) {
                    const error = new Error(
                        `This student already has voucher ${clash.voucher_number} for that semester.`
                    );
                    error.status = 409;
                    throw error;
                }
            }

            patch.semester_id = semesterId;
        }

        if (body.fee_structure_id !== undefined) {
            const structureId = body.fee_structure_id === null
                ? null
                : Number(body.fee_structure_id);

            if (structureId !== null) {
                const [structure] = await select(
                    "SELECT fee_structure_id FROM fee_structures WHERE fee_structure_id = :id",
                    { id: structureId },
                    transaction
                );
                if (!structure) {
                    const error = new Error(`Fee structure ${structureId} does not exist.`);
                    error.status = 400;
                    throw error;
                }
            }

            patch.fee_structure_id = structureId;
        }

        // "Cancelled" is the only status a caller may set; every other value is
        // the arithmetic of the instalments and is written by
        // recalculateVoucher below.
        const cancelling = body.status === "Cancelled" && voucher.status !== "Cancelled";
        if (cancelling) patch.status = "Cancelled";

        if (!Object.keys(patch).length) {
            const error = new Error("Nothing to update.");
            error.status = 400;
            throw error;
        }

        await voucher.update(patch, { transaction });
        await recalculateVoucher(voucher.fee_voucher_id, { transaction });

        const updated = await FeeVoucher.findByPk(voucher.fee_voucher_id, { transaction });

        // The controller needs to know whether this edit was the cancellation,
        // because that is the one it writes an audit entry for.
        return { voucher: updated, cancelled: cancelling };
    });
};

/**
 * An admin's decision on a declared payment.
 *
 * Verifying issues the receipt number and re-settles the voucher in the same
 * transaction, so the instalment and the balance that accounts for it can never
 * exist apart. Rejecting leaves the row in place — a rejected claim is part of
 * the audit trail and deleting it would hide that it was ever made.
 */
const setPaymentStatus = async (paymentId, status, { userId = null } = {}) => {

    return sequelize.transaction(async (transaction) => {

        const payment = await FeePayment.findByPk(paymentId, { transaction });

        if (!payment) {
            const error = new Error("Payment not found");
            error.status = 404;
            throw error;
        }

        if (payment.status === status) {
            const error = new Error(`That payment is already ${status}.`);
            error.status = 409;
            throw error;
        }

        /*
         * The decision, its moment and its author.
         *
         * `recorded_by` was carrying double duty here and should not have been:
         * it means "the member of staff who entered this payment", which for a
         * portal declaration is nobody, and overwriting it with the approver
         * erased the distinction between keying a payment in and confirming
         * someone else's claim. verified_by holds the approver now, and
         * recorded_by is left alone.
         *
         * verified_at is set on BOTH outcomes. A refusal is a decision with a
         * date too, and "when was this rejected" is asked as often as the
         * opposite — usually by the parent who is still waiting.
         */
        const patch = {
            status,
            verified_at: new Date(),
            verified_by: userId
        };

        if (status === "Verified" && !payment.receipt_number) {
            patch.receipt_number = await nextReceiptNumber({ transaction });
        }

        await payment.update(patch, { transaction });

        // Both directions re-settle: verifying adds the money, rejecting a
        // previously verified row takes it back out.
        await recalculateVoucher(payment.fee_voucher_id, { transaction });

        return payment;
    });
};

module.exports = {
    recalculateVoucher,
    getStudentPosition,
    issueVoucher,
    amendVoucher,
    removeVoucher,
    listSubmittedPayments,
    listPaymentHistory,
    recordPayment,
    submitPaymentDeclaration,
    setPaymentStatus,
    nextReceiptNumber,
    nextVoucherNumber
};
