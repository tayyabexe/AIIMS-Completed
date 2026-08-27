const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Timetable = sequelize.define(
    "Timetable",
    {
        timetable_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        subject_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        section_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        teacher_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        classroom_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        /*
         * The class this weekly meeting belongs to.
         *
         * subject_id, section_id and teacher_id above are a denormalised copy
         * of the offering's own values. They stay because the three unique
         * indexes that make double-booking impossible are built directly on
         * them (20260807120000-enforce-timetable-slot-grid.js) and MySQL
         * cannot rebuild those over a join. courseOfferingService is the only
         * writer, and it keeps them in step.
         */
        offering_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        /*
         * Denormalised from the offering. A MySQL index cannot reach through a
         * foreign key, so the uniqueness constraints - one section, one
         * teacher and one room per period *per term* - need the term as a real
         * column here. See
         * 20260822094000-scope-timetable-uniqueness-to-term.js.
         */
        term_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        day_of_week: {
            type: DataTypes.ENUM(
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday"
            ),
            allowNull: false
        },

        start_time: {
            type: DataTypes.TIME,
            allowNull: false
        },

        end_time: {
            type: DataTypes.TIME,
            allowNull: false
        }

    },
    {
        tableName: "timetables",
        timestamps: false
    }
);

module.exports = Timetable;