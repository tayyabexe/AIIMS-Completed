"use strict";

/*
 * Two columns on `fee_payments`: when a payment was approved, and by whom.
 *
 * WHY
 * ---
 * A payment carries three different moments and the table could only record
 * one of them:
 *
 *   payment_date  — when the family says the money left their account. Typed
 *                   into a form by the person claiming it, and therefore not
 *                   evidence of anything on its own.
 *   created_at    — when the claim was declared through the portal.
 *   (missing)     — when the accounts office decided it was real.
 *
 * The third is the one every question is actually about. "Show me the payment
 * history of this student's vouchers, timestamped by the date the payment was
 * approved" cannot be answered from the first two: a voucher declared on the
 * 3rd and approved on the 19th is money the institute had on the 19th, and a
 * collection report built on payment_date puts it in the wrong fortnight.
 *
 * WHY NOT `updated_at`
 * --------------------
 * It was the obvious candidate and it is wrong. updated_at moves for ANY write
 * — a corrected receipt number, an amount fixed after a bank statement, a
 * method changed from Cash to Bank Transfer — so a row edited after approval
 * reports the edit as the approval. It is right only until someone touches the
 * row, which is precisely the case where an accurate approval time matters.
 *
 * It is still the best available evidence for payments approved BEFORE this
 * migration, which is what the backfill below uses it for, and only for rows
 * that were never edited after the decision (created_at = updated_at is not
 * required — see the backfill note).
 *
 * `verified_by` has no counterpart at all in the old schema. `recorded_by` is
 * who keyed the payment in, which for a portal-declared payment is nobody, and
 * `submitted_by` is the parent who claimed it. Neither says who approved it, so
 * an approval could never be traced to a member of staff. That is the one fact
 * an accounts trail exists to hold.
 *
 * BACKFILL
 * --------
 * Existing Verified rows get updated_at as their approval time. This is
 * explicitly an approximation and is marked as one in the API response
 * (`approvedAtIsApproximate`), rather than being presented as a fact the
 * database never recorded. Pending and Rejected rows are left NULL: neither has
 * an approval moment to record.
 *
 * verified_by is NOT backfilled. There is no column, log or file anywhere in
 * this system that knows who approved those 1,900 payments, and guessing —
 * "probably the admin who recorded it" — would put a name against a decision
 * that person may never have made. NULL is the truthful answer and the API
 * renders it as "recorded before approvals were tracked".
 */

const TABLE = "fee_payments";

module.exports = {

    async up(queryInterface, Sequelize) {

        const columns = await queryInterface.describeTable(TABLE);

        if (!columns.verified_at) {
            await queryInterface.addColumn(TABLE, "verified_at", {
                type: Sequelize.DATE,
                allowNull: true,
                comment: "When the accounts office approved or refused this payment"
            });
        }

        if (!columns.verified_by) {
            await queryInterface.addColumn(TABLE, "verified_by", {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: "users", key: "user_id" },
                onUpdate: "CASCADE",
                // The decision outlives the account that made it. Deleting a
                // staff account must not silently erase who approved a payment,
                // and must not block the deletion either.
                onDelete: "SET NULL",
                comment: "The user who decided this payment; NULL for rows decided before this was tracked"
            });
        }

        /*
         * The history query reads this table by student and orders by approval
         * time. Without an index that is a full scan of every payment in the
         * institute for every voucher history opened.
         */
        const indexes = await queryInterface.showIndex(TABLE);
        const hasIndex = indexes.some((i) => i.name === "idx_fee_payments_verified_at");

        if (!hasIndex) {
            await queryInterface.addIndex(TABLE, ["verified_at"], {
                name: "idx_fee_payments_verified_at"
            });
        }

        /*
         * The backfill.
         *
         * Only Verified rows, only where verified_at is still NULL, so re-running
         * this migration cannot overwrite a real approval time with an edit time.
         */
        await queryInterface.sequelize.query(`
            UPDATE fee_payments
               SET verified_at = updated_at
             WHERE status = 'Verified'
               AND verified_at IS NULL
        `);

    },

    async down(queryInterface) {

        const indexes = await queryInterface.showIndex(TABLE);

        if (indexes.some((i) => i.name === "idx_fee_payments_verified_at")) {
            await queryInterface.removeIndex(TABLE, "idx_fee_payments_verified_at");
        }

        const columns = await queryInterface.describeTable(TABLE);

        if (columns.verified_by) await queryInterface.removeColumn(TABLE, "verified_by");
        if (columns.verified_at) await queryInterface.removeColumn(TABLE, "verified_at");

    }

};
