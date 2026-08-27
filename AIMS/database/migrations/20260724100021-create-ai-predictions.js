'use strict';

// Backfill migration: `ai_predictions` was originally created directly from
// schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('ai_predictions')) return;

    await queryInterface.createTable('ai_predictions', {
      prediction_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'student_id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      model_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'prediction_models', key: 'model_id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      prediction_type: {
        type: Sequelize.ENUM('Performance', 'Fee Default', 'Attendance Risk'),
        allowNull: false,
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
      generated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE ai_predictions ADD CONSTRAINT chk_prediction_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));'
    );

    await queryInterface.addIndex('ai_predictions', ['risk_level'], {
      name: 'idx_ai_predictions_risk',
    });
    await queryInterface.addIndex('ai_predictions', ['prediction_type'], {
      name: 'idx_ai_predictions_type',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ai_predictions');
  },
};
