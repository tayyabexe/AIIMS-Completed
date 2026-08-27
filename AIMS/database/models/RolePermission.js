const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RolePermission = sequelize.define(
    'RolePermission',
    {
      role_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      permission_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
    },
    {
      tableName: 'role_permissions',
      timestamps: false,
    }
  );

  return RolePermission;
};
