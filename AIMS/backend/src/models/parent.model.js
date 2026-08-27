const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Parent = sequelize.define(
    "Parent",
    {
        parent_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        first_name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        last_name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        phone: {
            type: DataTypes.STRING
        },

        occupation: {
            type: DataTypes.STRING
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    },
    {
        tableName: "parents",
        timestamps: false
    }
);

module.exports = Parent;