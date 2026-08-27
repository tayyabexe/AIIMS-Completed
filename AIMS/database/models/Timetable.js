const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Timetable = sequelize.define(
    'Timetable',
    {
      timetable_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      section_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      classroom_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // The class this meeting belongs to. subject_id, section_id and
      // teacher_id above are a denormalised copy of the offering's own
      // values, kept in step by courseOfferingService - they stay because the
      // three unique indexes that make double-booking impossible are built
      // directly on them, and MySQL cannot rebuild those over a join.
      offering_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Denormalised from the offering because a MySQL index cannot reach
      // through a foreign key: the three uniqueness constraints below need the
      // term as a real column on this table. See
      // 20260822094000-scope-timetable-uniqueness-to-term.js.
      term_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      day_of_week: {
        type: DataTypes.ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
        allowNull: false,
      },
      start_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      end_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
    },
    {
      tableName: 'timetables',
      timestamps: false,
      indexes: [
        // Documentation only - the real index lives in the migration.
        { unique: true, fields: ['term_id', 'section_id', 'day_of_week', 'start_time'] },
        { unique: true, fields: ['term_id', 'teacher_id', 'day_of_week', 'start_time'] },
        { unique: true, fields: ['term_id', 'classroom_id', 'day_of_week', 'start_time'] },
      ],
    }
  );

  Timetable.associate = (models) => {
    Timetable.belongsTo(models.Subject, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Timetable.belongsTo(models.Section, { foreignKey: 'section_id', onDelete: 'CASCADE' });
    Timetable.belongsTo(models.Teacher, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
    Timetable.belongsTo(models.Classroom, { foreignKey: 'classroom_id', onDelete: 'CASCADE' });
    Timetable.belongsTo(models.CourseOffering, { foreignKey: 'offering_id', onDelete: 'CASCADE' });
    Timetable.belongsTo(models.AcademicTerm, { foreignKey: 'term_id', onDelete: 'RESTRICT' });
    Timetable.hasMany(models.Attendance, { foreignKey: 'timetable_id', onDelete: 'CASCADE' });
  };

  return Timetable;
};
