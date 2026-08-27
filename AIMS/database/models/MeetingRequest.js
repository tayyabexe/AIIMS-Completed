const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MeetingRequest = sequelize.define(
    'MeetingRequest',
    {
      request_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      parent_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      requested_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Completed'),
        defaultValue: 'Pending',
      },
      notes: {
        type: DataTypes.STRING(255),
      },
    },
    {
      tableName: 'meeting_requests',
      timestamps: false,
    }
  );

  MeetingRequest.associate = (models) => {
    MeetingRequest.belongsTo(models.Parent, { foreignKey: 'parent_id', onDelete: 'CASCADE' });
    MeetingRequest.belongsTo(models.Teacher, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
  };

  return MeetingRequest;
};
