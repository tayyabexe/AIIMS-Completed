const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TeacherAttendance = sequelize.define(
    'TeacherAttendance',
    {
      teacher_attendance_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      att_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      check_in: {
        type: DataTypes.TIME,
      },
      check_out: {
        type: DataTypes.TIME,
      },
      status: {
        type: DataTypes.ENUM('Present', 'Absent', 'Late', 'Leave'),
        defaultValue: 'Present',
      },
    },
    {
      tableName: 'teacher_attendance',
      timestamps: false,
      indexes: [
        // Documentation only - the real constraint/index live in the migration.
        { unique: true, fields: ['employee_id', 'att_date'] },
        { fields: ['att_date'] },
      ],
    }
  );

  TeacherAttendance.associate = (models) => {
    TeacherAttendance.belongsTo(models.Employee, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
  };

  return TeacherAttendance;
};
