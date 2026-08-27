const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Parent = sequelize.define(
    'Parent',
    {
      parent_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
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
      phone: {
        type: DataTypes.STRING(20),
      },
      occupation: {
        type: DataTypes.STRING(100),
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'parents',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['is_deleted'] },
      ],
    }
  );

  Parent.associate = (models) => {
    Parent.belongsTo(models.User, { foreignKey: 'user_id', onDelete: 'CASCADE' });
    Parent.hasMany(models.StudentGuardian, { foreignKey: 'parent_id', onDelete: 'CASCADE' });
    Parent.hasMany(models.MeetingRequest, { foreignKey: 'parent_id', onDelete: 'CASCADE' });
  };

  return Parent;
};
