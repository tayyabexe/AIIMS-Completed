const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Batch = sequelize.define(
    "Batch",
    {
        batch_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        program_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        batch_name: {
            type: DataTypes.STRING(50),
            allowNull: false
        },

        start_year: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        end_year: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    },
    {
        tableName: "batches",
        timestamps: false
    }
);

module.exports = Batch;