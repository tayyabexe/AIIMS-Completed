const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Notification = sequelize.define(
    'Notification',
    {
      notification_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      message: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      is_read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'notifications',
      timestamps: false,
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['user_id', 'is_read'] },
      ],
    }
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: 'user_id', onDelete: 'CASCADE' });
  };

  return Notification;
};
