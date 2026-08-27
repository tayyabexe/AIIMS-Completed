const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TeacherSubject = sequelize.define(
    'TeacherSubject',
    {
      teacher_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      // The key is (teacher, subject). `batch_id` was the third member and
      // made a row claim "may teach CS-501, but only to BSCS-2023" - dropped
      // by migration `...140000-qualification-is-not-batch-scoped`.
      subject_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
    },
    {
      tableName: 'teacher_subjects',
      timestamps: false,
    }
  );

  TeacherSubject.associate = (models) => {
    TeacherSubject.belongsTo(models.Teacher, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
    TeacherSubject.belongsTo(models.Subject, { foreignKey: 'subject_id', onDelete: 'CASCADE' });
  };

  return TeacherSubject;
};
