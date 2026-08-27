const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Section = sequelize.define(
    'Section',
    {
      section_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      batch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      section_name: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      capacity: {
        type: DataTypes.INTEGER,
        defaultValue: 40,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'sections',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['is_deleted'] },
      ],
    }
  );

  Section.associate = (models) => {
    Section.belongsTo(models.Batch, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
    Section.hasMany(models.Student, { foreignKey: 'section_id', onDelete: 'SET NULL' });
    Section.hasMany(models.Timetable, { foreignKey: 'section_id', onDelete: 'CASCADE' });
    Section.hasMany(models.CourseOffering, { foreignKey: 'section_id', onDelete: 'CASCADE' });
  };

  return Section;
};
