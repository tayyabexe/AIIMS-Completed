const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Semester = sequelize.define(
    "Semester",
    {
        semester_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        program_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        semester_number: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        start_date: {
            type: DataTypes.DATEONLY
        },

        end_date: {
            type: DataTypes.DATEONLY
        },

        is_archived: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }

    },
    {
        tableName: "semesters",
        timestamps: false
    }
);

module.exports = Semester;