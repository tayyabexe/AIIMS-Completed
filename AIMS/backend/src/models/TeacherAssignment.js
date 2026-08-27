const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const TeacherAssignment = sequelize.define(
    "TeacherAssignment",
    {
        assignment_id: {
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

        batch_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        section_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        assigned_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: "teacher_assignments",
        timestamps: false
    }
);

module.exports = TeacherAssignment;