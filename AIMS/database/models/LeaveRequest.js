const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LeaveRequest = sequelize.define(
    'LeaveRequest',
    {
      leave_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      leave_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('Pending', 'Approved', 'Rejected'),
        defaultValue: 'Pending',
      },
      approved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'leave_requests',
      timestamps: false,
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['status'] },
      ],
    }
  );

  LeaveRequest.associate = (models) => {
    LeaveRequest.belongsTo(models.User, { foreignKey: 'user_id', onDelete: 'CASCADE' });
    LeaveRequest.belongsTo(models.User, {
      as: 'Approver',
      foreignKey: 'approved_by',
      onDelete: 'SET NULL',
    });
  };

  return LeaveRequest;
};
