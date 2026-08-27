const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Batch = sequelize.define(
    'Batch',
    {
      batch_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      program_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      batch_name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      start_year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      end_year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'batches',
      timestamps: false,
      defaultScope: { where: { is_deleted: false } },
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['is_deleted'] },
      ],
    }
  );

  Batch.associate = (models) => {
    Batch.belongsTo(models.Program, { foreignKey: 'program_id', onDelete: 'CASCADE' });
    Batch.hasMany(models.Section, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
    Batch.hasMany(models.Student, { foreignKey: 'batch_id', onDelete: 'RESTRICT' });
    Batch.hasMany(models.TeacherSubject, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
  };

  return Batch;
};
