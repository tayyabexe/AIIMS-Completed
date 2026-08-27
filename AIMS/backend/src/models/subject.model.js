const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Subject = sequelize.define(
    "Subject",
    {
        subject_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        subject_code: {
            type: DataTypes.STRING(20),
            allowNull: false
        },

        subject_name: {
            type: DataTypes.STRING(150),
            allowNull: false
        },

        credit_hours: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        semester_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        prerequisite_subject_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        /*
         * The kind of room this subject needs, matched against
         * classrooms.room_type as an exact equality by the scheduler.
         *
         * NULL means "any room will do" and is deliberately not a member of the
         * enum: a subject with no requirement is a different fact from one
         * recorded as needing a general-purpose room.
         *
         * Both this and sessions_per_week were missing from the model while
         * present on the table, so Sequelize dropped them from every write —
         * a subject created through the API came out untyped and meeting twice
         * a week regardless of what was sent.
         */
        required_room_type: {
            type: DataTypes.ENUM("Lecture", "Lab", "Auditorium", "Seminar"),
            allowNull: true
        },

        // How many times a week the subject meets. Derived from credit_hours on
        // write - see deriveSessionsPerWeek in subjectService.
        sessions_per_week: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 2
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    },
    {
        tableName: "subjects",
        timestamps: false
    }
);

module.exports = Subject;