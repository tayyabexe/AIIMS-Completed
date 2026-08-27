const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");
const Announcement = require("./announcement.model");

// One audience rule for an announcement.
//
// Within a row every column that is set must match the reader, so
// (batch_id, section_id) means "that batch, but only that section". Columns
// left NULL are not part of the rule. Several rows on one announcement are
// OR-ed, so two rows naming two batches reach both.
//
// An announcement with no rows here falls back to announcements.target_role,
// which is how everything published before targeting existed keeps working.

const AnnouncementTarget = sequelize.define(
    "AnnouncementTarget",
    {
        target_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        announcement_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        // A whole role: every Student, every Teacher, and so on.
        role_id: {
            type: DataTypes.INTEGER
        },

        // Academic placement. These only ever match a student, since they are
        // resolved against the student's own record.
        program_id: {
            type: DataTypes.INTEGER
        },

        batch_id: {
            type: DataTypes.INTEGER
        },

        section_id: {
            type: DataTypes.INTEGER
        },

        semester_id: {
            type: DataTypes.INTEGER
        },

        // One named person, whatever their role.
        user_id: {
            type: DataTypes.INTEGER
        },

        created_at: {
            type: DataTypes.DATE
        }
    },
    {
        tableName: "announcement_targets",
        timestamps: false
    }
);

AnnouncementTarget.belongsTo(Announcement, {
    foreignKey: "announcement_id"
});

Announcement.hasMany(AnnouncementTarget, {
    foreignKey: "announcement_id",
    as: "targets"
});

module.exports = AnnouncementTarget;
