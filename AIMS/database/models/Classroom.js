const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Classroom = sequelize.define(
    'Classroom',
    {
      classroom_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      room_name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      building: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      capacity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // What kind of teaching space this is, so the scheduler can refuse to
      // put a practical in a lecture theatre. Before this, "Lab 1" and "401"
      // were both just strings.
      room_type: {
        type: DataTypes.ENUM('Lecture', 'Lab', 'Auditorium', 'Seminar'),
        allowNull: false,
        defaultValue: 'Lecture',
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'classrooms',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
      indexes: [
        // Documentation only - the real constraint/index live in the migration.
        { unique: true, fields: ['room_name', 'building'] },
        { fields: ['is_deleted'] },
        { fields: ['room_type', 'capacity'] },
      ],
    }
  );

  Classroom.associate = (models) => {
    Classroom.hasMany(models.Timetable, { foreignKey: 'classroom_id', onDelete: 'CASCADE' });
    Classroom.hasMany(models.Exam, { foreignKey: 'classroom_id', onDelete: 'SET NULL' });
  };

  return Classroom;
};
