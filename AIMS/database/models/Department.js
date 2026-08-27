const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Department = sequelize.define(
    'Department',
    {
      department_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      department_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      head_employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'departments',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['is_deleted'] },
      ],
    }
  );

  Department.associate = (models) => {
    Department.hasMany(models.Program, { foreignKey: 'department_id', onDelete: 'RESTRICT' });
    Department.hasMany(models.Employee, { foreignKey: 'department_id', onDelete: 'RESTRICT' });
    // head_employee_id is nullable - a department can exist before a head is assigned.
    Department.belongsTo(models.Employee, {
      as: 'HeadEmployee',
      foreignKey: 'head_employee_id',
      onDelete: 'SET NULL',
    });
  };

  return Department;
};
