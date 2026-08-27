const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

/*
 * One question an admin decided was worth keeping.
 *
 * The row holds the plan, never the answer — see
 * migrations/20260820140000-create-saved-analytics.js for why. Everything in
 * `source_kind`, `tool_name`, `tool_args` and `sql_text` maps one-to-one onto
 * the plan shape planValidator.validate() produces, so replaying a saved query
 * is a rename, not a translation.
 */
const SavedQuery = sequelize.define(
    "SavedQuery",
    {
        saved_query_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        // The label on the chip in the strip. Unique per account.
        name: {
            type: DataTypes.STRING(120),
            allowNull: false
        },

        question: {
            type: DataTypes.TEXT,
            allowNull: false
        },

        corrected_question: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        source_kind: {
            type: DataTypes.ENUM("tool", "sql"),
            allowNull: false
        },

        tool_name: {
            type: DataTypes.STRING(80),
            allowNull: true
        },

        tool_args: {
            type: DataTypes.JSON,
            allowNull: true
        },

        /*
         * Untrusted on read. sqlGuard runs over this string again on every
         * execution, exactly as it did when the question was first asked.
         */
        sql_text: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        title: {
            type: DataTypes.STRING(200),
            allowNull: true
        },

        // The templates ticked at save time, from the set the result supported.
        visuals: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: []
        },

        default_visual: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: "table"
        },

        axes: {
            type: DataTypes.JSON,
            allowNull: true
        },

        created_at: { type: DataTypes.DATE },
        updated_at: { type: DataTypes.DATE }
    },
    {
        tableName: "saved_analytics_queries",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at"
    }
);

module.exports = SavedQuery;
