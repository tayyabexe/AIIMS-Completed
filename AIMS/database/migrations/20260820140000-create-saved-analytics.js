"use strict";

/*
 * Pinned analytics: saved queries, and where their cards sit on a screen.
 *
 * WHAT IS STORED, AND WHY IT IS THE PLAN RATHER THAN THE ROWS
 * ----------------------------------------------------------
 * A card saved from Ask the Data holds the *plan* that answered the question —
 * either the curated tool and its arguments, or the generated SQL — and never
 * the rows those produced. Opening a dashboard re-executes the plan through
 * the same guard chain a live question goes through, so the figures on a
 * pinned card are as current as the ones on the canvas that created it.
 *
 * Storing rows instead was the obvious shortcut and is the wrong one twice
 * over: a dashboard of frozen numbers is a dashboard of numbers that were true
 * once, and a row snapshot outlives the permission that produced it. Re-running
 * means the grants are re-checked every time.
 *
 * Nothing here re-enters the language model. The plan was written by one, once,
 * on the day the question was asked; replaying it is pure database work.
 *
 * WHY TWO TABLES
 * --------------
 * A saved query is a thing you own. A card is one placement of it on one
 * screen. The same saved query can appear on the Dashboard as a bar chart and
 * on AI Insights as a table, and deleting the placement must not delete the
 * query. Folding them together would have made "remove this card" and "forget
 * this question" the same act.
 *
 * WHY BUILT-IN PANELS GET ROWS TOO
 * --------------------------------
 * `builtin_key` rows carry no query — they are the screens' own hardcoded
 * panels, recorded only so their position survives a reload once the user has
 * moved them. A card is therefore exactly one of the two: a saved query, or a
 * built-in. The CHECK below says so.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // ----------------------------------------------------- saved queries --
    await queryInterface.createTable("saved_analytics_queries", {
      saved_query_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      /*
       * Saved lists are private to the account that made them. An admin's
       * pinned questions are their working set, not an institute asset, and
       * sharing them would need an answer to "who may delete someone else's
       * card" that nothing in the portal currently has.
       */
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "user_id" },
        onDelete: "CASCADE",
      },
      // What the user typed into the strip, not what they asked the AI.
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      // The question as typed, kept verbatim so the card can show its origin.
      question: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // The planner's spelling-corrected reading of it, when it differed.
      corrected_question: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /*
       * Which of the two execution paths this replays. Mirrors `source.kind`
       * in the /ask response and `validated.mode` in the executor, so a saved
       * row can be handed to executor.execute() with no translation beyond
       * renaming the fields.
       */
      source_kind: {
        type: DataTypes.ENUM("tool", "sql"),
        allowNull: false,
      },
      tool_name: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      tool_args: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      /*
       * Stored raw and re-validated on every run. sqlGuard sees this string
       * again at execution time exactly as it saw it the first time — the
       * table is not a trusted store, it is a note of what to re-check.
       */
      sql_text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // The chart title the planner produced, so a card is labelled the same
      // way the canvas labelled it.
      title: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      /*
       * The templates the user ticked when saving, from the set the result
       * actually supported. A card may only be shown as one of these.
       */
      visuals: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      // Which of `visuals` a new card starts as.
      default_visual: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      /*
       * The server's derivation of x/y from the real result, carried forward
       * so a replayed chart plots the same columns without re-deriving them
       * from data that may have shifted underneath.
       */
      axes: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ),
      },
    });

    // Two saved queries with the same name in one strip are indistinguishable
    // to the person reading it, so the name is the identity within an account.
    await queryInterface.addConstraint("saved_analytics_queries", {
      fields: ["user_id", "name"],
      type: "unique",
      name: "uq_saved_analytics_user_name",
    });

    // ------------------------------------------------------------ cards ---
    await queryInterface.createTable("analytics_dashboard_cards", {
      card_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "user_id" },
        onDelete: "CASCADE",
      },
      /*
       * Which screen this placement belongs to. The two behave differently —
       * the Dashboard refuses tables and refuses to drop its own panels, AI
       * Insights allows both — and the rules are applied per surface rather
       * than per card.
       */
      surface: {
        type: DataTypes.ENUM("dashboard", "ai_insights"),
        allowNull: false,
      },
      /*
       * Deleting a saved query takes its cards with it. The alternative — a
       * card left pointing at nothing, rendering an error on every dashboard
       * it was ever dropped on — is not a state worth being able to reach.
       */
      saved_query_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "saved_analytics_queries", key: "saved_query_id" },
        onDelete: "CASCADE",
      },
      // Names one of the screen's own panels; see config/dashboardCards.js.
      builtin_key: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      // Which template this particular placement draws. NULL for built-ins,
      // which draw themselves.
      visual: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      grid_x: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      grid_y: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      grid_w: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 6 },
      grid_h: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8 },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ),
      },
    });

    // The whole layout for one screen is read in one query on every open.
    await queryInterface.addIndex("analytics_dashboard_cards", {
      fields: ["user_id", "surface"],
      name: "ix_analytics_cards_user_surface",
    });

    /*
     * Exactly one of the two kinds. MySQL 8.0.16+ enforces CHECK constraints;
     * on anything older this is parsed and ignored, which is why the service
     * layer asserts the same thing rather than relying on it.
     */
    await queryInterface.sequelize.query(
      "ALTER TABLE analytics_dashboard_cards " +
        "ADD CONSTRAINT ck_analytics_cards_one_source CHECK (" +
        "(saved_query_id IS NOT NULL AND builtin_key IS NULL) OR " +
        "(saved_query_id IS NULL AND builtin_key IS NOT NULL))"
    );
  },

  async down(queryInterface) {
    // Cards first: they hold the foreign key into the queries table.
    await queryInterface.dropTable("analytics_dashboard_cards");
    await queryInterface.dropTable("saved_analytics_queries");
  },
};
