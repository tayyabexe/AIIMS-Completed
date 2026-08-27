const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");
const Exam = require("./exam.model");
const Student = require("./student.model");
const Mark = sequelize.define(
    "Mark",
    {
        mark_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        exam_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        student_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        obtained_marks: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: false
        },

        entered_by: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        verified_by: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        status: {
            type: DataTypes.ENUM(
                "Draft",
                "Verified",
                "Published"
            ),
            defaultValue: "Draft"
        }
    },
    {
        tableName: "marks",
        timestamps: false
    }
);
Mark.belongsTo(Exam, {
    foreignKey: "exam_id"
});

Exam.hasMany(Mark, {
    foreignKey: "exam_id"
});

Mark.belongsTo(Student, {
    foreignKey: "student_id"
});

Student.hasMany(Mark, {
    foreignKey: "student_id"
});
module.exports = Mark;