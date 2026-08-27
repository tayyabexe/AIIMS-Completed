const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Payroll = sequelize.define(
    'Payroll',
    {
      payroll_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      month: {
        type: DataTypes.CHAR(7),
        allowNull: false,
      },
      basic_salary: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      allowances: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
      },
      deductions: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
      },
      net_salary: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      generated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'payroll',
      timestamps: false,
      indexes: [
        // Documentation only - the real constraint lives in the migration.
        { unique: true, fields: ['employee_id', 'month'] },
      ],
    }
  );

  Payroll.associate = (models) => {
    Payroll.belongsTo(models.Employee, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
  };

  return Payroll;
};
