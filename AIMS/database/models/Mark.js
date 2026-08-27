const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Mark = sequelize.define(
    'Mark',
    {
      mark_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      exam_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      obtained_marks: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
      },
      entered_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      verified_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('Draft', 'Verified', 'Published'),
        defaultValue: 'Draft',
      },
    },
    {
      tableName: 'marks',
      timestamps: false,
      indexes: [
        // Documentation only - the real constraint/index live in the migration.
        { unique: true, fields: ['exam_id', 'student_id'] },
        { fields: ['status'] },
      ],
    }
  );

  Mark.associate = (models) => {
    Mark.belongsTo(models.Exam, { foreignKey: 'exam_id', onDelete: 'CASCADE' });
    Mark.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    // entered_by is RESTRICT - a teacher who has entered marks can't be
    // deleted out from under that historical record.
    Mark.belongsTo(models.Teacher, {
      as: 'EnteredByTeacher',
      foreignKey: 'entered_by',
      onDelete: 'RESTRICT',
    });
    Mark.belongsTo(models.Teacher, {
      as: 'VerifiedByTeacher',
      foreignKey: 'verified_by',
      onDelete: 'SET NULL',
    });
  };

  return Mark;
};
