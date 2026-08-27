const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Attendance = sequelize.define(
    "Attendance",
    {

        attendance_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        student_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        subject_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        timetable_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        att_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        status: {
            type: DataTypes.ENUM(
                "Present",
                "Absent",
                "Late",
                "Leave",
                "Holiday"
            ),
            allowNull: false
        },

        marked_by: {
            type: DataTypes.INTEGER,
            allowNull: false
        }

    },
    {

        tableName: "attendance",

        timestamps: false

    }

);

module.exports = Attendance;