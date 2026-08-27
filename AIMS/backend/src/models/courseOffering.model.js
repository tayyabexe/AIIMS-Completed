const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

/*
 * One class: this section studies this subject with this teacher, this term.
 *
 * The runtime counterpart of database/models/CourseOffering.js. See
 * 20260822092000-create-course-offerings.js for why this table exists at all -
 * in short, `enrollments` carried no section and no teacher, and every
 * timetable row carried its own teacher independently, so nothing in the
 * schema said who taught a course.
 */
const CourseOffering = sequelize.define(
    "CourseOffering",
    {
        offering_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        term_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        section_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        subject_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        // NULL = the class exists but is not staffed. It cannot be scheduled
        // until this is set, because timetables.teacher_id is NOT NULL.
        teacher_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        /*
         * NULL = follow `subjects.sessions_per_week`.
         *
         * A value here is a deliberate per-term override, nothing else. It was
         * NOT NULL DEFAULT 2 before, which made "nobody chose" and "somebody
         * chose 2" the same row — and that is how it silently outranked the
         * curriculum on every offering.
         */
        sessions_per_week: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        },

        required_room_type: {
            type: DataTypes.ENUM("Lecture", "Lab", "Auditorium", "Seminar"),
            allowNull: true,
            defaultValue: null
        },

        max_seats: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        status: {
            type: DataTypes.ENUM(
                "Draft",
                "Scheduled",
                "Active",
                "Completed",
                "Cancelled"
            ),
            allowNull: false,
            defaultValue: "Draft"
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },

        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: "course_offerings",
        timestamps: false
    }
);

module.exports = CourseOffering;
