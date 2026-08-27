const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Program = sequelize.define(
    'Program',
    {
      program_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      program_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      duration_semesters: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'programs',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      indexes: [
        // Documentation only - both indexes physically exist via the migration
        // (uq_program_per_department + idx_programs_deleted).
        { unique: true, fields: ['department_id', 'program_name'] },
        { fields: ['is_deleted'] },
      ],
    }
  );

  Program.associate = (models) => {
    Program.belongsTo(models.Department, { foreignKey: 'department_id', onDelete: 'RESTRICT' });
    Program.hasMany(models.Batch, { foreignKey: 'program_id', onDelete: 'CASCADE' });
    Program.hasMany(models.Student, { foreignKey: 'program_id', onDelete: 'RESTRICT' });
    Program.hasMany(models.Semester, { foreignKey: 'program_id', onDelete: 'CASCADE' });
    Program.hasMany(models.FeeStructure, { foreignKey: 'program_id', onDelete: 'CASCADE' });
  };

  return Program;
};
