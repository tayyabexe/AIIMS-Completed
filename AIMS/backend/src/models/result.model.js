const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");
const Student = require("./student.model");
const Result = sequelize.define(
    "Result",
    {
        result_id: {
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
            type: DataTypes.DECIMAL(3, 2),
            allowNull: true
        },

        cgpa: {
            type: DataTypes.DECIMAL(3, 2),
            allowNull: true
        },

        published_at: {
            type: DataTypes.DATE,
            allowNull: true
        },

        status: {
            type: DataTypes.ENUM(
                "Pending",
                "Published"
            ),
            defaultValue: "Pending"
        }
    },
    {
        tableName: "results",
        timestamps: false
    }
);
Result.belongsTo(Student, {
    foreignKey: "student_id"
});

Student.hasMany(Result, {
    foreignKey: "student_id"
});
module.exports = Result;