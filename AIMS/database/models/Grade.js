const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Grade = sequelize.define(
    'Grade',
    {
      grade_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      grade_letter: {
        type: DataTypes.STRING(5),
        allowNull: false,
        unique: true,
      },
      min_percentage: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
      },
      max_percentage: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
      },
      grade_point: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
      },
    },
    {
      tableName: 'grades',
      timestamps: false,
    }
  );

  // No associate(): grades is a standalone lookup table (letter -> percentage
  // band -> GPA point). Nothing in the schema has a grade_id FK into it -
  // marks/results store raw percentages/GPA and the app resolves the letter
  // by range lookup, not by a foreign key.

  return Grade;
};
