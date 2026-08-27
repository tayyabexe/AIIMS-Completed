const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Employee = sequelize.define(
    'Employee',
    {
      employee_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      employee_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
      first_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      designation: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      basic_salary: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      hire_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      employment_status: {
        type: DataTypes.ENUM('Active', 'On Leave', 'Terminated', 'Retired'),
        defaultValue: 'Active',
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'employees',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
    }
  );

  Employee.associate = (models) => {
    Employee.belongsTo(models.User, { foreignKey: 'user_id', onDelete: 'CASCADE' });
    Employee.belongsTo(models.Department, { foreignKey: 'department_id', onDelete: 'RESTRICT' });
    Employee.hasOne(models.Teacher, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    // The `payments` table was merged into `fee_payments` by
    // 20260808090000-consolidate-fee-module.js, so there is no Payment model to
    // associate with. The equivalent link now lives on the backend's
    // feePayment.model.js (`recorded_by`).
    Employee.hasMany(models.TeacherAttendance, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    Employee.hasMany(models.Payroll, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    Employee.hasMany(models.EmployeeDocument, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    Employee.hasMany(models.PerformanceEvaluation, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    Employee.hasMany(models.PerformanceEvaluation, {
      as: 'EvaluationsGiven',
      foreignKey: 'evaluated_by',
      onDelete: 'RESTRICT',
    });
  };

  return Employee;
};
