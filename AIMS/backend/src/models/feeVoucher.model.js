const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Student = require("./student.model");
const FeeStructure = require("./FeeStructure");

/*
 * One voucher (challan) issued to a student.
 *
 * Replaces `student_fees` and `challans`, which were two records of the same
 * document sharing only a voucher number and no foreign key. See
 * migrations/20260808090000-consolidate-fee-module.js.
 *
 * `amount_paid` is maintained on this row by the fee service whenever an
 * instalment is recorded, rather than summed by a view at read time. That is
 * deliberate: the view that used to do it (`vw_student_fee_status`) summed only
 * one of the two payment tables, so it reported a part-paid voucher as wholly
 * unpaid. One column, one answer.
 */
const FeeVoucher = sequelize.define(
    "FeeVoucher",
    {
        fee_voucher_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        student_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        fee_structure_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        semester_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        // The challan / voucher number: the document's single identity.
        voucher_number: {
            type: DataTypes.STRING(30),
            allowNull: false,
            unique: true
        },

        issue_date: {
            type: DataTypes.DATEONLY
        },

        due_date: {
            type: DataTypes.DATEONLY
        },

        total_payable: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0
        },

        amount_paid: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0
        },

        /*
         * total_payable - amount_paid, and signed.
         *
         * A negative value is an overpayment. The old schema clamped this at
         * the voucher, which is how advance balances disappeared from every
         * screen that read it.
         */
        remaining_balance: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0
        },

        status: {
            type: DataTypes.ENUM(
                "Unpaid",
                "Partial",
                "Paid",
                "Overdue",
                "Cancelled"
            ),
            allowNull: false,
            defaultValue: "Unpaid"
        }
    },
    {
        tableName: "fee_vouchers",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at"
    }
);

FeeVoucher.belongsTo(Student, { foreignKey: "student_id" });
Student.hasMany(FeeVoucher, { foreignKey: "student_id" });

FeeVoucher.belongsTo(FeeStructure, { foreignKey: "fee_structure_id" });

module.exports = FeeVoucher;
