const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Grade = sequelize.define(
    "Grade",
    {
        grade_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        grade_letter: {
            type: DataTypes.STRING(5),
            allowNull: false
        },

        min_percentage: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false
        },

        max_percentage: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false
        },

        grade_point: {
            type: DataTypes.DECIMAL(3, 2),
            allowNull: false
        }
    },
    {
        tableName: "grades",
        timestamps: false
    }
);

module.exports = Grade;