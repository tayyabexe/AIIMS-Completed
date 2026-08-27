const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Subject = sequelize.define(
    'Subject',
    {
      subject_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      subject_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
      subject_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      credit_hours: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      semester_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // NULL = any room will do, which is true of most subjects. An 'Any'
      // enum member would have looked decided when it was really just unset.
      required_room_type: {
        type: DataTypes.ENUM('Lecture', 'Lab', 'Auditorium', 'Seminar'),
        allowNull: true,
        defaultValue: null,
      },
      // The curriculum's default number of weekly meetings. An offering may
      // override it - one section can need an extra session without the
      // subject itself having changed.
      sessions_per_week: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 2,
      },
      prerequisite_subject_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'subjects',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
    }
  );

  Subject.associate = (models) => {
    Subject.belongsTo(models.Semester, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    // Self-referencing: a subject can require another subject as a prerequisite
    Subject.belongsTo(models.Subject, {
      as: 'Prerequisite',
      foreignKey: 'prerequisite_subject_id',
      onDelete: 'SET NULL',
    });
    Subject.hasMany(models.Enrollment, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Subject.hasMany(models.Timetable, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Subject.hasMany(models.Attendance, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Subject.hasMany(models.Exam, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Subject.hasMany(models.TeacherSubject, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Subject.hasMany(models.CourseOffering, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
  };

  return Subject;
};
