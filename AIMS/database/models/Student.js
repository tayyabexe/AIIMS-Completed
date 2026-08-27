const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Student = sequelize.define(
    'Student',
    {
      student_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        unique: true,
      },
      registration_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },
      first_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      cnic_bform: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
      phone: {
        type: DataTypes.STRING(20),
      },
      dob: {
        type: DataTypes.DATEONLY,
      },
      gender: {
        type: DataTypes.ENUM('Male', 'Female', 'Other'),
        allowNull: true,
      },
      program_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      batch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      section_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      current_semester_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      academic_status: {
        type: DataTypes.ENUM(
          'Pending Verification',
          'Active',
          'Suspended',
          'Withdrawn',
          'Graduated',
          'Alumni'
        ),
        defaultValue: 'Pending Verification',
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'students',
      underscored: true,
      defaultScope: { where: { is_deleted: false } },
    }
  );

  Student.associate = (models) => {
    Student.belongsTo(models.User, { foreignKey: 'user_id', onDelete: 'SET NULL' });
    Student.belongsTo(models.Program, { foreignKey: 'program_id', onDelete: 'RESTRICT' });
    Student.belongsTo(models.Batch, { foreignKey: 'batch_id', onDelete: 'RESTRICT' });
    Student.belongsTo(models.Section, { foreignKey: 'section_id', onDelete: 'SET NULL' });
    Student.belongsTo(models.Semester, { foreignKey: 'current_semester_id', onDelete: 'SET NULL' });
    Student.hasMany(models.Enrollment, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Student.hasMany(models.StudentDocument, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Student.hasMany(models.Attendance, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Student.hasMany(models.Mark, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    Student.hasMany(models.Result, { foreignKey: 'student_id', onDelete: 'CASCADE' });
    // `student_fees` was merged into `fee_vouchers` by
    // 20260808090000-consolidate-fee-module.js; see feeVoucher.model.js.
    Student.hasMany(models.StudentGuardian, { foreignKey: 'student_id', onDelete: 'CASCADE' });
  };

  return Student;
};
