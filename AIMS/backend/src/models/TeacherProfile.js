const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const TeacherProfile = sequelize.define(
    "TeacherProfile",
    {
        teacher_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },

        qualification: {
            type: DataTypes.STRING(200)
        },

        specialization: {
            type: DataTypes.STRING(200)
        },

        experience_years: {
            type: DataTypes.INTEGER
        },

        bio: {
            type: DataTypes.TEXT
        }
    },
    {
        tableName: "teacher_profiles",
        timestamps: false
    }
);

module.exports = TeacherProfile;