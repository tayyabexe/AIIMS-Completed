const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmployeeDocument = sequelize.define(
    'EmployeeDocument',
    {
      doc_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      doc_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      file_url: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'employee_documents',
      timestamps: false,
    }
  );

  EmployeeDocument.associate = (models) => {
    EmployeeDocument.belongsTo(models.Employee, { foreignKey: 'employee_id', onDelete: 'CASCADE' });
  };

  return EmployeeDocument;
};
