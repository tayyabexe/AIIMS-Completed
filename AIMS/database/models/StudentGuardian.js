const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StudentGuardian = sequelize.define(
    'StudentGuardian',
    {
      student_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      parent_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      relationship: {
        type: DataTypes.ENUM('Father', 'Mother', 'Guardian'),
        allowNull: false,
      },
    },
    {
      tableName: 'student_guardians',
      timestamps: false,
    }
  );

  StudentGuardian.associate = (models) => {
    StudentGuardian.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    StudentGuardian.belongsTo(models.Parent, { foreignKey: 'parent_id', onDelete: 'CASCADE' });
  };

  return StudentGuardian;
};
