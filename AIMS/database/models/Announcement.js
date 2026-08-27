const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Announcement = sequelize.define(
    'Announcement',
    {
      announcement_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      target_role: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      posted_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'announcements',
      timestamps: false,
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['target_role'] },
      ],
    }
  );

  Announcement.associate = (models) => {
    Announcement.belongsTo(models.User, { as: 'PostedBy', foreignKey: 'posted_by', onDelete: 'CASCADE' });
  };

  return Announcement;
};
