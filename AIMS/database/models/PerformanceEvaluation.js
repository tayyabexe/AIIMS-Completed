const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PerformanceEvaluation = sequelize.define(
    'PerformanceEvaluation',
    {
      evaluation_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      evaluation_period: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      rating: {
        type: DataTypes.ENUM('Excellent', 'Good', 'Average', 'Poor'),
        allowNull: false,
      },
      remarks: {
        type: DataTypes.STRING(255),
      },
      evaluated_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'performance_evaluations',
      timestamps: false,
    }
  );

  PerformanceEvaluation.associate = (models) => {
    PerformanceEvaluation.belongsTo(models.Employee, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    // evaluated_by is RESTRICT - the evaluator's employee record can't be
    // deleted out from under a historical evaluation they gave.
    PerformanceEvaluation.belongsTo(models.Employee, {
      as: 'Evaluator',
      foreignKey: 'evaluated_by',
      onDelete: 'RESTRICT',
    });
  };

  return PerformanceEvaluation;
};
