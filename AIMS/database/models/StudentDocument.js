const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StudentDocument = sequelize.define(
    'StudentDocument',
    {
      doc_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      doc_type: {
        type: DataTypes.ENUM(
          'CNIC',
          'B-Form',
          'Photo',
          'Certificate',
          'Transcript',
          'Medical',
          'Admission Form',
          'Fee Challan',
          'Result Card',
          'Other'
        ),
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
      uploaded_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'student_documents',
      timestamps: false,
    }
  );

  StudentDocument.associate = (models) => {
    StudentDocument.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
  };

  return StudentDocument;
};
