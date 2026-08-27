const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Teacher = sequelize.define(
    "Teacher",
    {
        teacher_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        employee_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true,
        },

        specialization: {
            type: DataTypes.STRING(150),
            allowNull: true,
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    {
        tableName: "teachers",
        timestamps: false,
    }
);

module.exports = Teacher;