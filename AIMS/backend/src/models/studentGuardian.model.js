const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");
const Parent = require("./parent.model");
const Student = require("./student.model");
const StudentGuardian = sequelize.define(
    "StudentGuardian",
    {

        student_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },

        parent_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },

        relationship: {
            type: DataTypes.ENUM(
                "Father",
                "Mother",
                "Guardian"
            ),
            allowNull: false
        }

    },
    {
        tableName: "student_guardians",
        timestamps: false
    }
);
StudentGuardian.belongsTo(Parent, {
    foreignKey: "parent_id"
});

Parent.hasMany(StudentGuardian, {
    foreignKey: "parent_id"
});
StudentGuardian.belongsTo(Student, {
    foreignKey: "student_id"
});

Student.hasMany(StudentGuardian, {
    foreignKey: "student_id"
});

module.exports = StudentGuardian;