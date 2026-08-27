const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const TeacherSubject = sequelize.define(
    "TeacherSubject",
    {
        teacher_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },

        /*
         * The key is (teacher, subject) and nothing else. `batch_id` used to
         * be the third member, which made the row read "may teach CS-501, but
         * only to BSCS-2023" - not a rule any university has, and one that
         * emptied the staffing shortlist every time a batch was created.
         * Dropped by migration `…140000-qualification-is-not-batch-scoped`.
         */
        subject_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        }
    },
    {
        tableName: "teacher_subjects",
        timestamps: false
    }
);

module.exports = TeacherSubject;