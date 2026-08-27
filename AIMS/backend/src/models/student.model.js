const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");
const Program = require("./program.model");
const Batch = require("./batch.model");
const Section = require("./section.model");
const User = require("./user.model");
const Student = sequelize.define(
    "Student",
    {
        student_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        user_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        registration_number: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },

        first_name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        last_name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        cnic_bform: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },

        phone: {
            type: DataTypes.STRING
        },

        dob: {
            type: DataTypes.DATEONLY
        },

        // Personal details a student maintains themselves through
        // PUT /api/students/me. All nullable - the seeded rows have none.
        address: {
            type: DataTypes.STRING(255)
        },

        nationality: {
            type: DataTypes.STRING(50)
        },

        blood_group: {
            type: DataTypes.ENUM(
                "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"
            )
        },

        program_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        batch_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        section_id: {
            type: DataTypes.INTEGER
        },

        current_semester_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        gender: {
            type: DataTypes.ENUM(
                "Male",
                "Female",
                "Other"
            )
        },

        academic_status: {
            type: DataTypes.ENUM(
                "Pending Verification",
                "Active",
                "Suspended",
                "Withdrawn",
                "Graduated",
                "Alumni"
            ),
            defaultValue: "Pending Verification"
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }

    },
    {
        tableName: "students",

        timestamps: true,

        createdAt: "created_at",

        updatedAt: "updated_at"
    }
);
// ================= Associations =================

Student.belongsTo(Program, {
    foreignKey: "program_id"
});

Student.belongsTo(Batch, {
    foreignKey: "batch_id"
});

Student.belongsTo(Section, {
    foreignKey: "section_id"
});

// The login account. Email lives on users, not students, so the portal can only
// show a student's email by joining through here.
Student.belongsTo(User, {
    foreignKey: "user_id",
    as: "account"
});

User.hasOne(Student, {
    foreignKey: "user_id",
    as: "student"
});

Program.hasMany(Student, {
    foreignKey: "program_id"
});

Batch.hasMany(Student, {
    foreignKey: "batch_id"
});

Section.hasMany(Student, {
    foreignKey: "section_id"
});

module.exports = Student;