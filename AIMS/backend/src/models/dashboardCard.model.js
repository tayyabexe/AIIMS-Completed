const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

/*
 * One card, in one position, on one screen, for one account.
 *
 * A card is either a placement of a saved query or a placement of one of the
 * screen's own built-in panels — never both, never neither. The database says
 * so with a CHECK; layout.service.js says so again, because the CHECK is a
 * no-op on MySQL below 8.0.16.
 *
 * The grid coordinates are react-grid-layout's own units: `grid_x` and
 * `grid_w` count columns out of the 12 the surfaces declare, `grid_y` and
 * `grid_h` count rows. They are stored raw rather than as a percentage or a
 * size name because the library round-trips them unchanged, and any
 * translation layer here would be a second place for a layout to drift.
 */
const DashboardCard = sequelize.define(
    "DashboardCard",
    {
        card_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        surface: {
            /*
             * Kept in step with SURFACES in config/dashboardCards.js and with
             * the column itself - migrations 20260821140000 (faculty_insights)
             * and 20260821170000 (faculty_dashboard). An ENUM rather than a
             * string so a board nobody declared cannot be written.
             */
            type: DataTypes.ENUM(
                "dashboard",
                "ai_insights",
                "faculty_insights",
                "faculty_dashboard"
            ),
            allowNull: false
        },

        saved_query_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        builtin_key: {
            type: DataTypes.STRING(60),
            allowNull: true
        },

        // NULL for built-ins: they are fixed components, not templates fed rows.
        visual: {
            type: DataTypes.STRING(20),
            allowNull: true
        },

        /*
         * Which width this placement describes. A card has a row per
         * breakpoint it has been arranged at — see the breakpoint migration
         * for why one set of coordinates cannot serve both.
         */
        breakpoint: {
            type: DataTypes.ENUM("lg", "sm"),
            allowNull: false,
            defaultValue: "lg"
        },

        /*
         * True once a person has dragged this card's height themselves. Until
         * then the card is as tall as its contents and keeps tracking them;
         * afterwards the measured height only enforces the floor.
         */
        user_sized: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },

        grid_x: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        grid_y: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        grid_w: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 6 },
        // A pixel height, not a row count — see GRID_ROW_HEIGHT in
        // config/dashboardCards.js.
        grid_h: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 336 },

        created_at: { type: DataTypes.DATE },
        updated_at: { type: DataTypes.DATE }
    },
    {
        tableName: "analytics_dashboard_cards",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at"
    }
);

module.exports = DashboardCard;
