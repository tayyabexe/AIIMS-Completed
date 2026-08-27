/*
 * Adds the verification columns a parent-submitted payment needs.
 *
 * Why this exists: fee_payments had no state. A row in it WAS money received —
 * feeService.recalculateVoucher summed every row and settled the voucher from
 * the total. Letting a parent write to that table would have let a parent clear
 * their child's balance by typing a number.
 *
 * Two additive columns, both safe on the existing data:
 *
 *   status        Pending | Verified | Rejected, DEFAULT 'Verified'.
 *                 The default is what makes this a no-op for the rows already
 *                 there: every existing instalment stays counted exactly as it
 *                 was. Only rows a parent submits are written as Pending, and
 *                 recalculateVoucher now counts Verified only.
 *
 *   submitted_by  users.user_id of the parent who declared the payment.
 *                 `recorded_by` already means "the member of staff who entered
 *                 it", so a separate column keeps the claim distinct from the
 *                 confirmation.
 *
 * Idempotent: re-running it reports and does nothing.
 */
require("dotenv").config();
const { sequelize } = require("../database/connection");

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });

const hasColumn = async (table, column) => {
    const rows = await q(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = :table
            AND COLUMN_NAME = :column`,
        { table, column }
    );
    return rows.length > 0;
};

(async () => {
    const before = await q(
        `SELECT COUNT(*) AS total FROM fee_payments`
    );
    console.log(`fee_payments rows before: ${before[0].total}`);

    if (await hasColumn("fee_payments", "status")) {
        console.log("  status       already present - skipped");
    } else {
        await sequelize.query(
            `ALTER TABLE fee_payments
               ADD COLUMN status ENUM('Pending','Verified','Rejected')
                   NOT NULL DEFAULT 'Verified' AFTER is_late`
        );
        console.log("  status       added (existing rows default to Verified)");
    }

    if (await hasColumn("fee_payments", "submitted_by")) {
        console.log("  submitted_by already present - skipped");
    } else {
        await sequelize.query(
            `ALTER TABLE fee_payments
               ADD COLUMN submitted_by INT NULL AFTER recorded_by`
        );
        console.log("  submitted_by added");
    }

    // An index, because every admin verification screen filters on it.
    const idx = await q(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'fee_payments'
            AND INDEX_NAME = 'idx_fee_payments_status'`
    );
    if (idx.length) {
        console.log("  idx_fee_payments_status already present - skipped");
    } else {
        await sequelize.query(
            `CREATE INDEX idx_fee_payments_status ON fee_payments (status)`
        );
        console.log("  idx_fee_payments_status created");
    }

    console.log("\nverification:");
    console.table(await q(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_payments'
            AND COLUMN_NAME IN ('status','submitted_by','recorded_by')`
    ));
    console.table(await q(
        `SELECT status, COUNT(*) AS rows_ FROM fee_payments GROUP BY status`
    ));

    await sequelize.close();
})().catch(async (error) => {
    console.error("FAILED:", error.message);
    try { await sequelize.close(); } catch { /* already closed */ }
    process.exit(1);
});
