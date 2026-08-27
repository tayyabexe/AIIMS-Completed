'use strict';

// Backfill migration: `prediction_history` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('prediction_history')) return;

    await queryInterface.createTable('prediction_history', {
      history_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      prediction_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ai_predictions', key: 'prediction_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'student_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      predicted_value: {
        type: Sequelize.DECIMAL(6, 2),
      },
      risk_level: {
        type: Sequelize.ENUM('Low', 'Medium', 'High', 'Critical'),
      },
      confidence_score: {
        type: Sequelize.DECIMAL(5, 2),
      },
      recorded_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE prediction_history ADD CONSTRAINT chk_prediction_history_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));'
    );

    await queryInterface.addIndex('prediction_history', ['student_id'], {
      name: 'idx_prediction_history_student',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('prediction_history');
  },
};
