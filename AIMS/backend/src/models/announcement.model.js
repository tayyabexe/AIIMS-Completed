const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

// Institute announcements, targeted at a role. Same situation as
// meeting_requests: real rows in the database, no API, so the faculty portal
// was showing a hardcoded list instead of what is actually published.

const Announcement = sequelize.define(
    "Announcement",
    {
        announcement_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        title: {
            type: DataTypes.STRING(150),
            allowNull: false
        },

        content: {
            type: DataTypes.TEXT,
            allowNull: false
        },

        // Free-text in the schema; the seeded values are role names such as
        // "Student", "Teacher", "Parent" and "All".
        target_role: {
            type: DataTypes.STRING(50),
            allowNull: false
        },

        posted_by: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        created_at: {
            type: DataTypes.DATE
        }
    },
    {
        tableName: "announcements",
        timestamps: false
    }
);

module.exports = Announcement;
