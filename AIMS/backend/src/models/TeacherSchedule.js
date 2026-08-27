const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const TeacherSchedule = sequelize.define(
    "TeacherSchedule",
    {
        schedule_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        teacher_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        subject_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        day: {
            type: DataTypes.STRING(20),
            allowNull: false
        },

        start_time: {
            type: DataTypes.TIME,
            allowNull: false
        },

        end_time: {
            type: DataTypes.TIME,
            allowNull: false
        },

        room: {
            type: DataTypes.STRING(50)
        }
    },
    {
        tableName: "teacher_schedules",
        timestamps: false
    }
);

module.exports = TeacherSchedule;
