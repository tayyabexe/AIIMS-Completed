const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const FeeStructure = sequelize.define(
    "FeeStructure",
    {
        fee_structure_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        program_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        semester_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        fee_category: {
            type: DataTypes.STRING(50),
            allowNull: false
        },

        amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        }
    },
    {
        tableName: "fee_structures",
        timestamps: false
    }
);

module.exports = FeeStructure;