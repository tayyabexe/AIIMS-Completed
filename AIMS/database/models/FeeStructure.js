const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FeeStructure = sequelize.define(
    'FeeStructure',
    {
      fee_structure_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      program_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      semester_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      fee_category: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
    },
    {
      tableName: 'fee_structures',
      timestamps: false,
    }
  );

  FeeStructure.associate = (models) => {
    FeeStructure.belongsTo(models.Program, { foreignKey: 'program_id', onDelete: 'CASCADE' });
    FeeStructure.belongsTo(models.Semester, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    // `student_fees` was merged into `fee_vouchers` by
    // 20260808090000-consolidate-fee-module.js. The replacement association is
    // on the backend's feeVoucher.model.js.
  };

  return FeeStructure;
};
