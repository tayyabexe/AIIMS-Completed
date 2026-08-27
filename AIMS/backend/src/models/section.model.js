const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Section = sequelize.define(
    "Section",
    {
        section_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        batch_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        section_name: {
            type: DataTypes.STRING(10),
            allowNull: false
        },

        capacity: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    },
    {
        tableName: "sections",
        timestamps: false
    }
);

module.exports = Section;