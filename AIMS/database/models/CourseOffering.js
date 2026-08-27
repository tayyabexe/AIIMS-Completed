const { DataTypes } = require('sequelize');

/*
 * One class: this section studies this subject with this teacher, this term.
 *
 * It is the join the schema was missing between the delivery side (sections
 * and the timetable) and the academic side (enrollments and subjects). A
 * timetable row is one weekly *meeting* of an offering; an enrollment is one
 * student's place in it. See 20260822092000-create-course-offerings.js.
 */
module.exports = (sequelize) => {
  const CourseOffering = sequelize.define(
    'CourseOffering',
    {
      offering_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      term_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      section_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // NULL = the class exists but has not been staffed yet. It cannot be
      // scheduled until this is set, because timetables.teacher_id is NOT NULL.
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The scheduler's target: the class is fully placed when it has this
      // many timetable rows.
      // NULL = follow `subjects.sessions_per_week`; a value is a deliberate
      // per-term override. See migration 20260822120000.
      sessions_per_week: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      // Copied from the subject at creation so a later curriculum change
      // cannot retroactively invalidate a timetable that was already taught.
      required_room_type: {
        type: DataTypes.ENUM('Lecture', 'Lab', 'Auditorium', 'Seminar'),
        allowNull: true,
        defaultValue: null,
      },
      // NULL = the section's own headcount governs.
      max_seats: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('Draft', 'Scheduled', 'Active', 'Completed', 'Cancelled'),
        allowNull: false,
        defaultValue: 'Draft',
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'course_offerings',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
      indexes: [
        // Documentation only - the real constraint/indexes live in the
        // migration. The unique one is what makes an offering *the* answer to
        // "who teaches this" rather than one of several.
        { unique: true, fields: ['term_id', 'section_id', 'subject_id'] },
        { fields: ['teacher_id', 'term_id'] },
        { fields: ['term_id', 'status', 'is_deleted'] },
      ],
    }
  );

  CourseOffering.associate = (models) => {
    CourseOffering.belongsTo(models.AcademicTerm, {
      foreignKey: 'term_id',
      onDelete: 'RESTRICT',
    });
    CourseOffering.belongsTo(models.Section, {
      foreignKey: 'section_id',
      onDelete: 'CASCADE',
    });
    CourseOffering.belongsTo(models.Subject, {
      foreignKey: 'subject_id',
      onDelete: 'CASCADE',
    });
    CourseOffering.belongsTo(models.Teacher, {
      foreignKey: 'teacher_id',
      onDelete: 'SET NULL',
    });
    CourseOffering.hasMany(models.Timetable, {
      foreignKey: 'offering_id',
      onDelete: 'CASCADE',
    });
    CourseOffering.hasMany(models.Enrollment, {
      foreignKey: 'offering_id',
      onDelete: 'SET NULL',
    });
  };

  return CourseOffering;
};
