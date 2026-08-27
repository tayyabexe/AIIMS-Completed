const { DataTypes } = require('sequelize');

// The calendar dimension. `semesters` is the curriculum stage a subject
// belongs to ("semester 3 of BSCS"); a term is the year that stage is
// actually taught in. See 20260822090000-create-academic-terms.js for why the
// two had to be separated.
module.exports = (sequelize) => {
  const AcademicTerm = sequelize.define(
    'AcademicTerm',
    {
      term_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      term_code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },
      term_name: {
        type: DataTypes.STRING(80),
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
      status: {
        type: DataTypes.ENUM('Planned', 'Active', 'Closed'),
        allowNull: false,
        defaultValue: 'Planned',
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
      tableName: 'academic_terms',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      scopes: {
        withDeleted: {},
      },
      indexes: [
        // Documentation only - the real indexes live in the migration.
        { fields: ['status', 'is_deleted'] },
        { fields: ['start_date'] },
      ],
    }
  );

  AcademicTerm.associate = (models) => {
    AcademicTerm.hasMany(models.CourseOffering, {
      foreignKey: 'term_id',
      onDelete: 'RESTRICT',
    });
    AcademicTerm.hasMany(models.Enrollment, {
      foreignKey: 'term_id',
      onDelete: 'RESTRICT',
    });
  };

  return AcademicTerm;
};
