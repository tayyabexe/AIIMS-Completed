const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Semester = sequelize.define(
    'Semester',
    {
      semester_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      program_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      semester_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      is_archived: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'semesters',
      timestamps: false,
      defaultScope: { where: { is_archived: false } },
      scopes: {
        withArchived: {},
      },
    }
  );

  Semester.associate = (models) => {
    Semester.belongsTo(models.Program, { foreignKey: 'program_id', onDelete: 'CASCADE' });
    Semester.hasMany(models.Subject, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    Semester.hasMany(models.Enrollment, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    Semester.hasMany(models.Exam, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    Semester.hasMany(models.Result, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
    Semester.hasMany(models.FeeStructure, { foreignKey: 'semester_id', onDelete: 'CASCADE' });
  };

  return Semester;
};
