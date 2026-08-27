const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Notification = sequelize.define(
    "Notification",
    {
        notification_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        // The heading. Composed by the service that emitted the row rather than
        // derived from `type` on the client, so every portal shows the same
        // wording for the same event. See migration 20260816090000.
        title: {
            type: DataTypes.STRING(120),
            allowNull: false,
            defaultValue: "Notification"
        },

        message: {
            type: DataTypes.STRING,
            allowNull: false
        },

        type: {
            type: DataTypes.STRING,
            allowNull: false
        },

        // Where in the reader's own portal this notification is answered. NULL
        // when there is nothing to open, which the pages render as plain text.
        link: {
            type: DataTypes.STRING(255),
            allowNull: true
        },

        // low | normal | high. Decided by the emitter, which is the only place
        // that knows whether attendance merely changed or fell below 75%.
        priority: {
            type: DataTypes.STRING(16),
            allowNull: false,
            defaultValue: "normal"
        },

        is_read: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },

        created_at: {
            type: DataTypes.DATE
        }

    },
    {
        tableName: "notifications",
        timestamps: false
    }
);

module.exports = Notification;