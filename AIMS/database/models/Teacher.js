const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Teacher = sequelize.define(
    'Teacher',
    {
      teacher_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      specialization: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'teachers',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
    }
  );

  Teacher.associate = (models) => {
    Teacher.belongsTo(models.Employee, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
    Teacher.hasMany(models.Timetable, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
    // The classes this teacher is assigned to. Distinct from TeacherSubject,
    // which records only what they are *eligible* to teach.
    Teacher.hasMany(models.CourseOffering, { foreignKey: 'teacher_id', onDelete: 'SET NULL' });
    Teacher.hasMany(models.Attendance, { foreignKey: 'marked_by', onDelete: 'RESTRICT' });
    Teacher.hasMany(models.Exam, {
      as: 'InvigilatedExams',
      foreignKey: 'invigilator_id',
      onDelete: 'SET NULL',
    });
    Teacher.hasMany(models.Mark, {
      as: 'MarksEntered',
      foreignKey: 'entered_by',
      onDelete: 'RESTRICT',
    });
    Teacher.hasMany(models.Mark, {
      as: 'MarksVerified',
      foreignKey: 'verified_by',
      onDelete: 'SET NULL',
    });
    Teacher.hasMany(models.TeacherSubject, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
    Teacher.hasMany(models.MeetingRequest, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
  };

  return Teacher;
};
