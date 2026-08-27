const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Enrollment = sequelize.define(
    'Enrollment',
    {
      enrollment_id: {
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
      semester_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // The class the student joined. Together with the offering's teacher
      // this is what finally makes "who teaches this student" a plain join.
      offering_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Which year they took it in. semester_id above is the curriculum stage
      // and is shared by every batch, so it cannot carry this on its own.
      term_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      enrollment_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('Active', 'Completed', 'Dropped'),
        defaultValue: 'Active',
      },
    },
    {
      tableName: 'enrollments',
      timestamps: false,
      indexes: [
        // Documentation only - the real constraint lives in the migration.
        // The term is in the key so a retake next year is a different row,
        // while a duplicate within one term is still refused.
        { unique: true, fields: ['student_id', 'subject_id', 'semester_id', 'term_id'] },
        { fields: ['offering_id', 'status'] },
      ],
    }
  );

  Enrollment.associate = (models) => {
    Enrollment.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Enrollment.belongsTo(models.Subject, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Enrollment.belongsTo(models.Semester, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    Enrollment.belongsTo(models.CourseOffering, { foreignKey: 'offering_id', onDelete: 'SET NULL' });
    Enrollment.belongsTo(models.AcademicTerm, { foreignKey: 'term_id', onDelete: 'RESTRICT' });
  };

  return Enrollment;
};
