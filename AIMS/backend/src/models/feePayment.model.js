const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const FeeVoucher = require("./feeVoucher.model");

/*
 * One instalment paid against one voucher.
 *
 * Replaces `payments`, `receipts` and the old `fee_payments` bridge — three
 * tables recording the same event, none of which agreed. A payment written to
 * one was invisible to any screen reading another.
 *
 * The receipt number belongs here rather than on the voucher because it is
 * issued when a challan is submitted: a voucher settled in two instalments
 * produces two receipts, which a receipt column on the voucher could not hold.
 */
const FeePayment = sequelize.define(
    "FeePayment",
    {
        fee_payment_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        fee_voucher_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        // Nullable: rows carried across from the legacy tables do not all
        // carry one. Unique where present.
        receipt_number: {
            type: DataTypes.STRING(30),
            allowNull: true,
            unique: true
        },

        amount_paid: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },

        payment_method: {
            type: DataTypes.ENUM(
                "Cash",
                "Bank Transfer",
                "Card",
                // Present in the live payments data; leaving it out of the
                // ENUM would blank those rows.
                "Mobile Wallet",
                "Online",
                "Cheque",
                "Other"
            ),
            allowNull: false,
            defaultValue: "Other"
        },

        payment_date: {
            type: DataTypes.DATEONLY
        },

        is_late: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },

        /*
         * Whether this instalment counts as money received.
         *
         * Staff-entered payments are created Verified, which is also the column
         * default, so the 1,909 rows that predate this column behave exactly as
         * before. A payment a parent declares from their own portal starts
         * Pending and does NOT reduce the balance until an admin verifies it —
         * without this, a parent could settle a voucher by typing a number.
         *
         * feeService.recalculateVoucher sums Verified rows only.
         */
        status: {
            type: DataTypes.ENUM("Pending", "Verified", "Rejected"),
            allowNull: false,
            defaultValue: "Verified"
        },

        // The member of staff who entered the payment.
        recorded_by: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        // The parent (users.user_id) who declared it, when it arrived through
        // the portal rather than the office. Kept separate from recorded_by so
        // the claim and the confirmation are never conflated.
        submitted_by: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        /*
         * When the accounts office decided, and who decided.
         *
         * This is the timestamp every fee report is really asking for. A payment
         * declared on the 3rd and approved on the 19th is money the institute
         * had on the 19th — payment_date is the family's own claim about when
         * they sent it, and created_at is when they said so.
         *
         * NULL on the 1,909 rows that predate the column means "approved before
         * this was tracked", not "not approved": those are all Verified and
         * carry an approximate time backfilled from updated_at. See migration
         * 20260812160000. verified_by is NULL for all of them and is left that
         * way — no record anywhere says who approved them, and inventing a name
         * against a financial decision is worse than admitting the gap.
         */
        verified_at: {
            type: DataTypes.DATE,
            allowNull: true
        },

        verified_by: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    },
    {
        tableName: "fee_payments",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at"
    }
);

FeeVoucher.hasMany(FeePayment, {
    foreignKey: "fee_voucher_id",
    as: "payments",
    onDelete: "CASCADE"
});

FeePayment.belongsTo(FeeVoucher, {
    foreignKey: "fee_voucher_id",
    as: "voucher"
});

module.exports = FeePayment;
