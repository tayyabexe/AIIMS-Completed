'use strict';

// Backfill migration: `prediction_models` was originally created directly
// from schema.sql rather than through Sequelize, so this brings it under
// migration tracking. Guards against re-creating it on databases (like
// this shared one) where the table already exists from that raw bootstrap.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('prediction_models')) return;

    await queryInterface.createTable('prediction_models', {
      model_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      model_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      model_type: {
        type: Sequelize.ENUM('Performance', 'Fee Default', 'Attendance Risk'),
        allowNull: false,
      },
      version: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      trained_on: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      accuracy_score: {
        type: Sequelize.DECIMAL(5, 2),
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('prediction_models', {
      fields: ['model_name', 'version'],
      type: 'unique',
      name: 'uq_model_version',
    });

    await queryInterface.sequelize.query(
      'ALTER TABLE prediction_models ADD CONSTRAINT chk_model_accuracy CHECK (accuracy_score IS NULL OR (accuracy_score >= 0 AND accuracy_score <= 100));'
    );

    await queryInterface.addIndex('prediction_models', ['model_type'], {
      name: 'idx_prediction_models_type',
    });
    await queryInterface.addIndex('prediction_models', ['is_active'], {
      name: 'idx_prediction_models_active',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('prediction_models');
  },
};
