const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Exam = sequelize.define(
    'Exam',
    {
      exam_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      exam_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      exam_type: {
        type: DataTypes.ENUM('Quiz', 'Assignment', 'Mid-Term', 'Final', 'Practical', 'Viva'),
        allowNull: false,
      },
      semester_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      exam_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      total_marks: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      classroom_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      invigilator_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'exams',
      timestamps: false,
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['exam_date'] },
      ],
    }
  );

  Exam.associate = (models) => {
    Exam.belongsTo(models.Semester, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    Exam.belongsTo(models.Subject, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
    Exam.belongsTo(models.Classroom, { foreignKey: 'classroom_id', onDelete: 'SET NULL' });
    Exam.belongsTo(models.Teacher, {
      as: 'Invigilator',
      foreignKey: 'invigilator_id',
      onDelete: 'SET NULL',
    });
    Exam.hasMany(models.Mark, { foreignKey: 'exam_id', onDelete: 'CASCADE' });
  };

  return Exam;
};
