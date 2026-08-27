const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Enrollment = sequelize.define(
    "Enrollment",
    {

        enrollment_id: {
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

        semester_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        /*
         * The class the student joined. Together with the offering's teacher
         * this is what finally makes "who teaches this student" a plain join,
         * rather than something inferred from the section's timetable - which
         * lists subjects the student may not be enrolled in at all.
         */
        offering_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        /*
         * Which year they took it in. semester_id above is the curriculum
         * stage, shared by every batch that ever passes through it, so it
         * cannot distinguish this year's sitting from last year's.
         */
        term_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        enrollment_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        status: {
            type: DataTypes.ENUM(
                "Active",
                "Completed",
                "Dropped"
            ),
            defaultValue: "Active"
        }

    },
    {

        tableName: "enrollments",

        timestamps: false

    }
);

module.exports = Enrollment;
