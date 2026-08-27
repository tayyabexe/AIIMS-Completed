const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Result = sequelize.define(
    'Result',
    {
      result_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      semester_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      gpa: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
      },
      cgpa: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
      },
      published_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('Pending', 'Published'),
        defaultValue: 'Pending',
      },
    },
    {
      tableName: 'results',
      timestamps: false,
      indexes: [
        // Documentation only - the real constraint/index live in the migration.
        { unique: true, fields: ['student_id', 'semester_id'] },
        { fields: ['status'] },
      ],
    }
  );

  Result.associate = (models) => {
    Result.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Result.belongsTo(models.Semester, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
  };

  return Result;
};
