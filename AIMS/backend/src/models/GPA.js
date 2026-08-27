const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const GPA = sequelize.define(
    "GPA",
    {
        gpa_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        student_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        semester_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        gpa: {
            type: DataTypes.DECIMAL(3,2),
            allowNull: false
        },

        cgpa: {
            type: DataTypes.DECIMAL(3,2),
            allowNull: false
        }
    },
    {
        tableName: "gpa",
        timestamps: false
    }
);

module.exports = GPA;