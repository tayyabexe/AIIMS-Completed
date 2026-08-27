const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Attendance = sequelize.define(
    'Attendance',
    {
      attendance_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      timetable_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      att_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('Present', 'Absent', 'Late', 'Leave', 'Holiday'),
        allowNull: false,
      },
      marked_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'attendance',
      timestamps: false,
      indexes: [
        // Documentation only - the real constraint/index live in the migration.
        { unique: true, fields: ['student_id', 'timetable_id', 'att_date'] },
        { fields: ['att_date'] },
        { fields: ['student_id', 'subject_id', 'att_date'] },
      ],
    }
  );

  Attendance.associate = (models) => {
    Attendance.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Attendance.belongsTo(models.Subject, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Attendance.belongsTo(models.Timetable, { foreignKey: 'timetable_id', onDelete: 'CASCADE' });
    // marked_by points to the teacher who took attendance - RESTRICT so a
    // teacher record can't be deleted out from under historical attendance.
    Attendance.belongsTo(models.Teacher, {
      as: 'MarkedByTeacher',
      foreignKey: 'marked_by',
      onDelete: 'RESTRICT',
    });
  };

  return Attendance;
};
