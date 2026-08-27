const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Permission = sequelize.define(
    'Permission',
    {
      permission_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      permission_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      module: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
    },
    {
      tableName: 'permissions',
      timestamps: false,
    }
  );

  Permission.associate = (models) => {
    Permission.belongsToMany(models.Role, {
      through: models.RolePermission,
      foreignKey: 'permission_id',
      otherKey: 'role_id',
    });
  };

  return Permission;
};
