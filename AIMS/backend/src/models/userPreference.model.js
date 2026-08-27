const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

// One JSON document of settings per account. See
// migrations/20260808140000-create-user-preferences.js for why it is shaped
// this way rather than a column per switch.
const UserPreference = sequelize.define(
    "UserPreference",
    {
        user_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false
        },

        preferences: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {}
        },

        updated_at: {
            type: DataTypes.DATE
        }
    },
    {
        tableName: "user_preferences",
        timestamps: false
    }
);

module.exports = UserPreference;
