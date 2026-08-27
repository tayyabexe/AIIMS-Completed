const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

/*
 * The calendar dimension.
 *
 * `semesters` is keyed (program_id, semester_number) and `subjects` hangs off
 * it, so a semester row is a curriculum *stage* - "the third semester of
 * BSCS". Batch 2023 and batch 2024 pass through that same single row, two
 * years apart. A term is the year the stage is actually taught in.
 *
 * See 20260822090000-create-academic-terms.js.
 */
const AcademicTerm = sequelize.define(
    "AcademicTerm",
    {
        term_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        // Stable machine-facing handle ("FALL-2026"), so the display name
        // stays free to be corrected without breaking references to it.
        term_code: {
            type: DataTypes.STRING(30),
            allowNull: false,
            unique: true
        },

        term_name: {
            type: DataTypes.STRING(80),
            allowNull: false
        },

        start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        // Planned - being built, nobody enrolled yet.
        // Active  - in progress; enrollment and attendance are live.
        // Closed  - finished and read-only; kept as the historical record.
        status: {
            type: DataTypes.ENUM("Planned", "Active", "Closed"),
            allowNull: false,
            defaultValue: "Planned"
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
        tableName: "academic_terms",
        timestamps: false
    }
);

module.exports = AcademicTerm;
