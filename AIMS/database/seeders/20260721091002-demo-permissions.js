'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('permissions', [
      { permission_name: 'manage_users', module: 'Identity' },
      { permission_name: 'manage_students', module: 'Academic' },
      { permission_name: 'manage_teachers', module: 'HR' },
      { permission_name: 'manage_departments', module: 'Academic' },
      { permission_name: 'manage_courses', module: 'Academic' },
      { permission_name: 'manage_timetable', module: 'Academic' },
      { permission_name: 'mark_attendance', module: 'Academics' },
      { permission_name: 'enter_marks', module: 'Exams' },
      { permission_name: 'manage_fees', module: 'Finance' },
      { permission_name: 'view_fee_vouchers', module: 'Finance' },
      { permission_name: 'manage_payroll', module: 'HR' },
      { permission_name: 'manage_library', module: 'Library' },
      { permission_name: 'manage_ai_predictions', module: 'AI' },
      { permission_name: 'view_reports', module: 'Reporting' },
      { permission_name: 'manage_notifications', module: 'Communication' },
    ]);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('permissions', null, {});
  },
};
