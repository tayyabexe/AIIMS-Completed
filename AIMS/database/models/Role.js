const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Role = sequelize.define(
    'Role',
    {
      role_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      role_name: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.STRING(255),
      },
    },
    {
      tableName: 'roles',
      timestamps: false,
    }
  );

  Role.associate = (models) => {
    Role.hasMany(models.User, { foreignKey: 'role_id' });
    Role.belongsToMany(models.Permission, {
      through: models.RolePermission,
      foreignKey: 'role_id',
      otherKey: 'permission_id',
    });
  };

  return Role;
};
