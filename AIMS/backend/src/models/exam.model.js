const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");
const Subject = require("./subject.model");
const Exam = sequelize.define(
    "Exam",
    {
        exam_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        exam_name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },

        exam_type: {
            type: DataTypes.ENUM(
                "Quiz",
                "Assignment",
                "Mid-Term",
                "Final",
                "Practical",
                "Viva"
            ),
            allowNull: false
        },

        semester_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        subject_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        exam_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        total_marks: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        classroom_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        invigilator_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    },
    {
        tableName: "exams",
        timestamps: false
    }
);
Exam.belongsTo(Subject, {
    foreignKey: "subject_id"
});

Subject.hasMany(Exam, {
    foreignKey: "subject_id"
});
module.exports = Exam;