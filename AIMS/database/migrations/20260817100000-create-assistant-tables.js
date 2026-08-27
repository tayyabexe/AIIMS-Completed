"use strict";

/*
 * Storage for the AI assistant: conversations, messages, and an audit trail of
 * everything it read.
 *
 * WHY NOT REUSE ai_predictions / prediction_history
 * -------------------------------------------------
 * Those tables belong to the fee-default and performance prediction models —
 * a `prediction_type` enum, a `risk_level`, a `confidence_score`. A chat turn
 * has none of those and would sit in them as a row of NULLs, and a real
 * prediction would have to be told apart from a chat message by convention.
 * They are left alone.
 *
 * WHY THE QUERY LOG IS SEPARATE FROM audit_logs
 * ---------------------------------------------
 * `audit_logs` records actions a user took that changed something. The
 * assistant changes nothing — it reads. What has to be recorded instead is
 * which tool ran, with which arguments, against whose scope, and what SQL was
 * actually executed, because that is the evidence for "did the assistant ever
 * return data it should not have". Different question, different retention,
 * different shape.
 *
 * Every row in assistant_query_log is written whether the call succeeded or
 * failed. A refused call is the more interesting record of the two.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // ----------------------------------------------------- conversations --
    await queryInterface.createTable("assistant_conversations", {
      conversation_id: {
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
       * The role is stored on the conversation, not read from the user at
       * display time. An account whose role changes must not retroactively
       * reframe a transcript — a conversation held as a Teacher stays labelled
       * as one, so the audit trail still says which permission set produced
       * those answers.
       */
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "roles", key: "role_id" },
      },
      title: {
        type: DataTypes.STRING(150),
        allowNull: false,
        defaultValue: "New conversation",
      },
      // Which portal the chat was opened from, so the assistant can bias its
      // navigation answers toward the screens the user is actually looking at.
      portal: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      is_archived: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
      },
    });

    // The list query is "my conversations, newest first".
    await queryInterface.addIndex("assistant_conversations", ["user_id", "updated_at"], {
      name: "idx_assistant_conv_user",
    });

    // ---------------------------------------------------------- messages --
    await queryInterface.createTable("assistant_messages", {
      message_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      conversation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "assistant_conversations", key: "conversation_id" },
        onDelete: "CASCADE",
      },
      /*
       * Mirrors the chat-completions message roles rather than inventing a
       * parallel vocabulary, so a transcript can be replayed to the model
       * without translation. 'tool' rows carry a tool's return value.
       */
      role: {
        type: DataTypes.ENUM("user", "assistant", "tool", "system"),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT("medium"),
        allowNull: true,
      },
      /*
       * The tool calls the model asked for on this turn, and the name of the
       * tool a 'tool' row is answering. Kept as JSON because the shape is the
       * provider's, and normalising it into columns would mean a migration
       * every time the tool-calling format gains a field.
       */
      tool_calls: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      tool_name: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      /*
       * What the frontend should render: prose, a table, a chart, or a
       * knowledge answer with citations. Stored so reopening a conversation
       * redraws the chart instead of degrading it to the text underneath.
       */
      response_type: {
        type: DataTypes.ENUM("answer", "table", "chart", "knowledge", "error"),
        allowNull: true,
      },
      response_payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Observability for a provider that bills per token and occasionally
      // stalls; both are useful long before they are interesting.
      token_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      latency_ms: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("assistant_messages", ["conversation_id", "created_at"], {
      name: "idx_assistant_msg_thread",
    });

    // --------------------------------------------------------- query log --
    await queryInterface.createTable("assistant_query_log", {
      log_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      conversation_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "assistant_conversations", key: "conversation_id" },
        onDelete: "SET NULL",
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "user_id" },
      },
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      tool_name: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      // What the model asked for, before the backend applied scope.
      tool_args: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      /*
       * The scope the backend resolved and enforced — the student_id, or the
       * teacher's subject/section sets. Recorded because "was this answer
       * correctly scoped" cannot be reconstructed later from the arguments
       * alone: the arguments are what was asked for, this is what was allowed.
       */
      resolved_scope: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      /*
       * The SQL actually executed. For a templated tool this is the fixed
       * statement; for the admin text-to-SQL path it is what the model
       * generated. That path is the reason this column exists.
       */
      executed_sql: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      row_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      duration_ms: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      /*
       * 'refused' is not an error. It is the guard layer working, and it is
       * the row an investigation would search for first, so it gets its own
       * outcome rather than being buried in an error message.
       */
      outcome: {
        type: DataTypes.ENUM("success", "refused", "error"),
        allowNull: false,
        defaultValue: "success",
      },
      error_message: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("assistant_query_log", ["user_id", "created_at"], {
      name: "idx_assistant_log_user",
    });
    await queryInterface.addIndex("assistant_query_log", ["outcome", "created_at"], {
      name: "idx_assistant_log_outcome",
    });
    await queryInterface.addIndex("assistant_query_log", ["tool_name"], {
      name: "idx_assistant_log_tool",
    });

    console.log("Created assistant_conversations, assistant_messages, assistant_query_log");
  },

  async down(queryInterface) {
    // Children first: both reference assistant_conversations.
    await queryInterface.dropTable("assistant_query_log");
    await queryInterface.dropTable("assistant_messages");
    await queryInterface.dropTable("assistant_conversations");
    console.log("Dropped the three assistant tables");
  },
};
