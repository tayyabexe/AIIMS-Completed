const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Program = sequelize.define(
    "Program",
    {
        program_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        department_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        program_name: {
            type: DataTypes.STRING(150),
            allowNull: false
        },

        duration_semesters: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    },
    {
        tableName: "programs",
        timestamps: false
    }
);

module.exports = Program;