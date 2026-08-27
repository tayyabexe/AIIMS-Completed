"use strict";

/*
 * Collapses the fee module's five overlapping tables into two.
 *
 * WHAT WAS WRONG
 * --------------
 * Billing was recorded twice, in two record sets that shared nothing but a
 * voucher number and had no foreign key between them:
 *
 *     student_fees  --< payments        (payments.student_fee_id)
 *     challans      --< receipts        (receipts.challan_id)
 *                   --< fee_payments    (challan_id AND receipt_id)
 *
 * `vw_student_fee_status` summed `payments` alone, so money recorded as a
 * receipt against a challan was invisible to it. In the live data this showed
 * up directly: a student saw voucher VCH-2024-00002 as part-settled with
 * Rs. 15,000 carried forward from an overpaid VCH-2026-000102, while their
 * parent — reading the view — saw the same voucher as wholly unpaid, and could
 * not see VCH-2026-000102 at all because it existed only as a challan. Neither
 * screen was calculating wrongly; they were reading different halves of one
 * account.
 *
 * The live data confirms the split is total: 2,001 student_fees and 5 challans
 * produce 2,006 distinct voucher numbers — zero overlap.
 *
 * WHAT THIS DOES
 * --------------
 *     fee_vouchers   one row per voucher    (voucher_number is the identity)
 *     fee_payments   one row per instalment (receipt_number is the identity)
 *
 * A voucher carries its own running amount_paid and status, so "partially
 * paid" is a real state rather than something each screen re-derives. The
 * receipt number lives on the payment, because it is issued when a challan is
 * submitted — one voucher settled in several instalments gets several receipts.
 *
 * ORDER OF OPERATIONS, AND WHY
 * ----------------------------
 * MySQL commits implicitly on DDL, so a transaction cannot make CREATE/DROP
 * atomic with the backfill. The safety property is therefore built from the
 * sequence rather than from the transaction: everything is created and copied
 * first, the carry-across is verified, and only if that verification passes
 * does anything get dropped. A failure leaves the legacy tables untouched —
 * the new tables may exist and are simply re-created on the next run.
 *
 * Four dependents also had to be rebuilt rather than left dangling, all found
 * by inspecting the live schema:
 *     vw_fee_collection_summary   read student_fees + payments
 *     vw_fee_defaulters           read student_fees
 *     sp_mark_overdue_fees        wrote student_fees
 *     sp_record_payment           wrote student_fees + payments
 */

const VOUCHERS = "fee_vouchers";
const PAYMENTS = "fee_payments";
const LEGACY_BRIDGE = "fee_payments_legacy";

/*
 * Drop order matters: every table must go after whatever points at it.
 *     fee_payments_legacy -> challans, receipts
 *     receipts            -> challans
 *     payments            -> student_fees
 */
const DROP_ORDER = [LEGACY_BRIDGE, "receipts", "payments", "challans", "student_fees"];

const listTables = async (queryInterface) => {
    const all = await queryInterface.showAllTables();
    return new Set(all.map((t) => String(t.tableName || t).toLowerCase()));
};

module.exports = {

    async up(queryInterface, Sequelize) {

        const sequelize = queryInterface.sequelize;
        const select = (sql) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
        const run = (sql) => sequelize.query(sql);

        let tables = await listTables(queryInterface);

        // ---------------------------------------------------------------
        // 0. The old bridge shares its name with the new payments table.
        // ---------------------------------------------------------------
        if (tables.has(PAYMENTS)) {
            const desc = await queryInterface.describeTable(PAYMENTS);
            // Only the legacy shape has challan_id; the new one has fee_voucher_id.
            if (desc.challan_id && !desc.fee_voucher_id) {
                await queryInterface.renameTable(PAYMENTS, LEGACY_BRIDGE);
            }
        }

        // Re-runnable after a failed attempt.
        tables = await listTables(queryInterface);
        if (tables.has(PAYMENTS) && tables.has(VOUCHERS)) {
            await queryInterface.dropTable(PAYMENTS);
            await queryInterface.dropTable(VOUCHERS);
        }

        // ---------------------------------------------------------------
        // 1. The two new tables
        // ---------------------------------------------------------------
        await queryInterface.createTable(VOUCHERS, {
            fee_voucher_id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            student_id: {
                type: Sequelize.INTEGER, allowNull: false,
                references: { model: "students", key: "student_id" },
                onUpdate: "CASCADE", onDelete: "RESTRICT"
            },
            fee_structure_id: {
                type: Sequelize.INTEGER, allowNull: true,
                references: { model: "fee_structures", key: "fee_structure_id" },
                onUpdate: "CASCADE", onDelete: "SET NULL"
            },
            semester_id: {
                type: Sequelize.INTEGER, allowNull: true,
                references: { model: "semesters", key: "semester_id" },
                onUpdate: "CASCADE", onDelete: "SET NULL"
            },
            // The challan / voucher number: one identity for the document,
            // instead of a voucher_number on student_fees and another on
            // challans that nothing kept in agreement.
            voucher_number: { type: Sequelize.STRING(30), allowNull: false, unique: true },
            issue_date: { type: Sequelize.DATEONLY, allowNull: true },
            due_date: { type: Sequelize.DATEONLY, allowNull: true },
            total_payable: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
            // Maintained by feeService on every instalment, rather than summed
            // by a view at read time — the view that did it saw only one of the
            // two payment tables.
            amount_paid: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
            // Signed on purpose: negative is an overpayment. Clamping this at
            // zero is what hid advance balances from every screen.
            remaining_balance: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
            status: {
                type: Sequelize.ENUM("Unpaid", "Partial", "Paid", "Overdue", "Cancelled"),
                allowNull: false, defaultValue: "Unpaid"
            },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") }
        });

        await queryInterface.addIndex(VOUCHERS, ["student_id"]);
        await queryInterface.addIndex(VOUCHERS, ["status"]);
        await queryInterface.addIndex(VOUCHERS, ["due_date"]);

        await queryInterface.createTable(PAYMENTS, {
            fee_payment_id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            fee_voucher_id: {
                type: Sequelize.INTEGER, allowNull: false,
                references: { model: VOUCHERS, key: "fee_voucher_id" },
                // A payment cannot outlive the voucher it settles.
                onUpdate: "CASCADE", onDelete: "CASCADE"
            },
            receipt_number: { type: Sequelize.STRING(30), allowNull: true, unique: true },
            amount_paid: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
            // "Mobile Wallet" is in the live payments data; omitting it here
            // would have silently blanked those rows on insert.
            payment_method: {
                type: Sequelize.ENUM("Cash", "Bank Transfer", "Card", "Mobile Wallet", "Online", "Cheque", "Other"),
                allowNull: false, defaultValue: "Other"
            },
            payment_date: { type: Sequelize.DATEONLY, allowNull: true },
            is_late: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            recorded_by: {
                type: Sequelize.INTEGER, allowNull: true,
                references: { model: "users", key: "user_id" },
                onUpdate: "CASCADE", onDelete: "SET NULL"
            },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") }
        });

        await queryInterface.addIndex(PAYMENTS, ["fee_voucher_id"]);
        await queryInterface.addIndex(PAYMENTS, ["payment_date"]);

        tables = await listTables(queryInterface);
        const has = (t) => tables.has(t);

        // ---------------------------------------------------------------
        // 2. Vouchers — challans first, then student_fees merged on
        //    voucher_number so a voucher in both becomes one row.
        // ---------------------------------------------------------------
        if (has("challans")) {
            await run(`
                INSERT INTO ${VOUCHERS}
                    (student_id, voucher_number, issue_date, due_date,
                     total_payable, amount_paid, remaining_balance, status,
                     created_at, updated_at)
                SELECT c.student_id, c.voucher_number, c.issue_date, c.due_date,
                       COALESCE(c.total_amount, 0), 0, COALESCE(c.total_amount, 0),
                       'Unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                  FROM challans c
                 WHERE c.voucher_number IS NOT NULL AND c.voucher_number <> ''
            `);
        }

        if (has("student_fees")) {
            // A voucher already present is enriched rather than duplicated;
            // student_fees is the billing record of authority for the amount.
            await run(`
                UPDATE ${VOUCHERS} v
                  JOIN student_fees sf ON sf.voucher_number = v.voucher_number
                   SET v.total_payable     = COALESCE(sf.total_payable, v.total_payable),
                       v.remaining_balance = COALESCE(sf.total_payable, v.total_payable),
                       v.due_date          = COALESCE(sf.due_date, v.due_date),
                       v.fee_structure_id  = sf.fee_structure_id
            `);

            await run(`
                INSERT INTO ${VOUCHERS}
                    (student_id, fee_structure_id, voucher_number, due_date,
                     total_payable, amount_paid, remaining_balance, status,
                     created_at, updated_at)
                SELECT sf.student_id, sf.fee_structure_id, sf.voucher_number, sf.due_date,
                       COALESCE(sf.total_payable, 0), 0, COALESCE(sf.total_payable, 0),
                       'Unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                  FROM student_fees sf
                 WHERE sf.voucher_number IS NOT NULL AND sf.voucher_number <> ''
                   AND NOT EXISTS (SELECT 1 FROM ${VOUCHERS} v
                                    WHERE v.voucher_number = sf.voucher_number)
            `);
        }

        // ---------------------------------------------------------------
        // 3. Payments — both legacy tables, resolved to the merged voucher.
        // ---------------------------------------------------------------
        if (has("receipts") && has("challans")) {
            await run(`
                INSERT INTO ${PAYMENTS}
                    (fee_voucher_id, receipt_number, amount_paid, payment_method,
                     payment_date, is_late, created_at, updated_at)
                SELECT v.fee_voucher_id, r.receipt_number, COALESCE(r.amount_paid, 0),
                       'Other', r.payment_date,
                       CASE WHEN v.due_date IS NOT NULL AND r.payment_date > v.due_date THEN 1 ELSE 0 END,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                  FROM receipts r
                  JOIN challans c    ON c.challan_id = r.challan_id
                  JOIN ${VOUCHERS} v ON v.voucher_number = c.voucher_number
            `);
        }

        if (has("payments") && has("student_fees")) {
            // A receipt_number carried across from `receipts` must not be
            // inserted twice — the column is unique.
            await run(`
                INSERT INTO ${PAYMENTS}
                    (fee_voucher_id, receipt_number, amount_paid, payment_method,
                     payment_date, is_late, recorded_by, created_at, updated_at)
                SELECT v.fee_voucher_id, p.receipt_number, COALESCE(p.amount_paid, 0),
                       COALESCE(p.payment_method, 'Other'), p.payment_date,
                       COALESCE(p.is_late, 0), p.recorded_by,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                  FROM payments p
                  JOIN student_fees sf ON sf.student_fee_id = p.student_fee_id
                  JOIN ${VOUCHERS} v   ON v.voucher_number = sf.voucher_number
                 WHERE p.receipt_number IS NULL
                    OR NOT EXISTS (SELECT 1 FROM ${PAYMENTS} np
                                    WHERE np.receipt_number = p.receipt_number)
            `);
        }

        // ---------------------------------------------------------------
        // 4. Roll payments up onto their voucher and derive status from the
        //    arithmetic — the legacy status columns disagreed with their own
        //    amounts (vouchers stored 'Overdue' that had been part-paid).
        // ---------------------------------------------------------------
        await run(`
            UPDATE ${VOUCHERS} v
              LEFT JOIN (SELECT fee_voucher_id, SUM(amount_paid) AS paid
                           FROM ${PAYMENTS} GROUP BY fee_voucher_id) t
                ON t.fee_voucher_id = v.fee_voucher_id
               SET v.amount_paid = COALESCE(t.paid, 0),
                   v.remaining_balance = v.total_payable - COALESCE(t.paid, 0)
        `);

        await run(`
            UPDATE ${VOUCHERS}
               SET status = CASE
                    WHEN total_payable > 0 AND amount_paid >= total_payable THEN 'Paid'
                    WHEN amount_paid > 0 THEN 'Partial'
                    WHEN due_date IS NOT NULL AND due_date < CURDATE() THEN 'Overdue'
                    ELSE 'Unpaid'
               END
        `);

        // ---------------------------------------------------------------
        // 5. Prove the carry-across BEFORE anything is destroyed.
        // ---------------------------------------------------------------
        const expected = new Set();
        if (has("challans")) {
            (await select("SELECT voucher_number FROM challans WHERE voucher_number IS NOT NULL AND voucher_number <> ''"))
                .forEach((r) => expected.add(r.voucher_number));
        }
        if (has("student_fees")) {
            (await select("SELECT voucher_number FROM student_fees WHERE voucher_number IS NOT NULL AND voucher_number <> ''"))
                .forEach((r) => expected.add(r.voucher_number));
        }

        const [{ n: voucherCount }] = await select(`SELECT COUNT(*) AS n FROM ${VOUCHERS}`);

        if (Number(voucherCount) !== expected.size) {
            throw new Error(
                `Fee consolidation aborted: ${VOUCHERS} holds ${voucherCount} rows but the legacy `
                + `tables name ${expected.size} distinct vouchers. Nothing has been dropped.`
            );
        }

        const [{ n: newPayments }] = await select(`SELECT COUNT(*) AS n FROM ${PAYMENTS}`);

        let legacyPayments = 0;
        if (has("receipts")) {
            const [r] = await select("SELECT COUNT(*) AS n FROM receipts");
            legacyPayments += Number(r.n);
        }
        if (has("payments")) {
            const [p] = await select("SELECT COUNT(*) AS n FROM payments");
            legacyPayments += Number(p.n);
        }

        if (Number(newPayments) !== legacyPayments) {
            throw new Error(
                `Fee consolidation aborted: ${PAYMENTS} holds ${newPayments} rows but the legacy `
                + `tables hold ${legacyPayments}. Nothing has been dropped.`
            );
        }

        // Money is the thing that must not change.
        const [{ t: newTotal }] = await select(`SELECT COALESCE(SUM(amount_paid), 0) AS t FROM ${PAYMENTS}`);
        let legacyTotal = 0;
        if (has("receipts")) {
            const [r] = await select("SELECT COALESCE(SUM(amount_paid), 0) AS t FROM receipts");
            legacyTotal += Number(r.t);
        }
        if (has("payments")) {
            const [p] = await select("SELECT COALESCE(SUM(amount_paid), 0) AS t FROM payments");
            legacyTotal += Number(p.t);
        }

        if (Math.abs(Number(newTotal) - legacyTotal) > 0.01) {
            throw new Error(
                `Fee consolidation aborted: carried ${newTotal} but the legacy tables hold `
                + `${legacyTotal}. Nothing has been dropped.`
            );
        }

        // ---------------------------------------------------------------
        // 6. Rebuild the dependents, then drop the duplicates.
        // ---------------------------------------------------------------
        await run("DROP VIEW IF EXISTS vw_student_fee_status");
        await run("DROP VIEW IF EXISTS vw_fee_collection_summary");
        await run("DROP VIEW IF EXISTS vw_fee_defaulters");

        await run(`
            CREATE VIEW vw_fee_collection_summary AS
            SELECT fs.program_id,
                   p.program_name,
                   fs.semester_id,
                   sem.semester_number,
                   COUNT(DISTINCT v.fee_voucher_id)                AS total_challans,
                   SUM(v.total_payable)                            AS total_payable,
                   COALESCE(SUM(v.amount_paid), 0)                 AS total_collected,
                   SUM(v.total_payable) - COALESCE(SUM(v.amount_paid), 0) AS outstanding_balance,
                   ROUND((COALESCE(SUM(v.amount_paid), 0) / NULLIF(SUM(v.total_payable), 0)) * 100, 2)
                                                                   AS collection_rate_percentage
              FROM fee_vouchers v
              JOIN fee_structures fs ON fs.fee_structure_id = v.fee_structure_id
              JOIN programs p        ON p.program_id = fs.program_id
              JOIN semesters sem     ON sem.semester_id = fs.semester_id
          GROUP BY fs.program_id, p.program_name, fs.semester_id, sem.semester_number
        `);

        await run(`
            CREATE VIEW vw_fee_defaulters AS
            SELECT v.fee_voucher_id,
                   v.student_id,
                   st.registration_number,
                   st.first_name,
                   st.last_name,
                   v.total_payable,
                   v.amount_paid,
                   v.remaining_balance,
                   v.due_date,
                   v.status,
                   (TO_DAYS(CURDATE()) - TO_DAYS(v.due_date)) AS days_overdue
              FROM fee_vouchers v
              JOIN students st ON st.student_id = v.student_id
             WHERE v.status = 'Overdue'
                OR (v.due_date < CURDATE() AND v.status NOT IN ('Paid', 'Cancelled'))
        `);

        await run("DROP PROCEDURE IF EXISTS sp_mark_overdue_fees");
        await run(`
            CREATE PROCEDURE sp_mark_overdue_fees()
            BEGIN
                DECLARE EXIT HANDLER FOR SQLEXCEPTION
                BEGIN
                    ROLLBACK;
                    RESIGNAL;
                END;

                START TRANSACTION;

                UPDATE fee_vouchers
                   SET status = 'Overdue'
                 WHERE due_date < CURDATE()
                   AND status NOT IN ('Paid', 'Partial', 'Overdue', 'Cancelled');

                COMMIT;
            END
        `);

        await run("DROP PROCEDURE IF EXISTS sp_record_payment");
        await run(`
            CREATE PROCEDURE sp_record_payment(
                IN p_fee_voucher_id INT,
                IN p_amount_paid DECIMAL(12,2),
                IN p_payment_method VARCHAR(20),
                IN p_recorded_by INT
            )
            BEGIN
                DECLARE v_total_payable DECIMAL(12,2) DEFAULT NULL;
                DECLARE v_due_date DATE;
                DECLARE v_total_paid DECIMAL(12,2);
                DECLARE v_is_late TINYINT(1);
                DECLARE v_new_status VARCHAR(20);
                DECLARE v_payment_id INT;

                DECLARE EXIT HANDLER FOR SQLEXCEPTION
                BEGIN
                    ROLLBACK;
                    RESIGNAL;
                END;

                START TRANSACTION;

                SELECT total_payable, due_date
                  INTO v_total_payable, v_due_date
                  FROM fee_vouchers
                 WHERE fee_voucher_id = p_fee_voucher_id
                 FOR UPDATE;

                IF v_total_payable IS NULL THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'sp_record_payment: fee_voucher_id not found';
                END IF;

                SET v_is_late = (v_due_date IS NOT NULL AND CURDATE() > v_due_date);

                -- receipt_number is UNIQUE and must be set at insert time, but
                -- the id is not known until afterwards; a collision-safe
                -- placeholder is rewritten once LAST_INSERT_ID() exists.
                INSERT INTO fee_payments
                    (fee_voucher_id, amount_paid, payment_method, payment_date,
                     is_late, receipt_number, recorded_by)
                VALUES
                    (p_fee_voucher_id, p_amount_paid, p_payment_method, CURDATE(),
                     v_is_late, SUBSTRING(REPLACE(UUID(), '-', ''), 1, 28), p_recorded_by);

                SET v_payment_id = LAST_INSERT_ID();

                UPDATE fee_payments
                   SET receipt_number = CONCAT('RCP-', DATE_FORMAT(CURDATE(), '%Y'), '-',
                                               LPAD(v_payment_id, 6, '0'))
                 WHERE fee_payment_id = v_payment_id;

                SELECT COALESCE(SUM(amount_paid), 0) INTO v_total_paid
                  FROM fee_payments
                 WHERE fee_voucher_id = p_fee_voucher_id;

                SET v_new_status = CASE
                    WHEN v_total_payable > 0 AND v_total_paid >= v_total_payable THEN 'Paid'
                    WHEN v_total_paid > 0 THEN 'Partial'
                    WHEN v_due_date IS NOT NULL AND v_due_date < CURDATE() THEN 'Overdue'
                    ELSE 'Unpaid'
                END;

                UPDATE fee_vouchers
                   SET amount_paid = v_total_paid,
                       remaining_balance = v_total_payable - v_total_paid,
                       status = v_new_status
                 WHERE fee_voucher_id = p_fee_voucher_id;

                COMMIT;

                SELECT v_payment_id AS fee_payment_id,
                       v_new_status AS new_status,
                       v_total_paid AS total_paid,
                       (v_total_payable - v_total_paid) AS remaining_balance;
            END
        `);

        for (const table of DROP_ORDER) {
            if ((await listTables(queryInterface)).has(table)) {
                await queryInterface.dropTable(table);
            }
        }
    },

    /*
     * Reverses the schema change only.
     *
     * The legacy tables were dropped deliberately, so this cannot restore their
     * rows — it removes the two consolidated tables and nothing more. Restoring
     * the old five-table shape means restoring a backup, which is exactly why
     * `up` refuses to drop anything it has not first verified.
     */
    async down(queryInterface) {
        await queryInterface.sequelize.query("DROP VIEW IF EXISTS vw_fee_collection_summary");
        await queryInterface.sequelize.query("DROP VIEW IF EXISTS vw_fee_defaulters");
        await queryInterface.sequelize.query("DROP PROCEDURE IF EXISTS sp_record_payment");
        await queryInterface.sequelize.query("DROP PROCEDURE IF EXISTS sp_mark_overdue_fees");
        await queryInterface.dropTable(PAYMENTS);
        await queryInterface.dropTable(VOUCHERS);
    }
};
