'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('roles', [
      { role_name: 'Super Admin', description: 'Full access across the entire system' },
      { role_name: 'Admin', description: 'General administrative operations' },
      { role_name: 'Teacher', description: 'Academic operations and marking' },
      { role_name: 'Student', description: 'Portal access and course view' },
      { role_name: 'Parent', description: 'View dependent progress and fees' },
      { role_name: 'HR', description: 'Manages employee records and payroll' },
      { role_name: 'Accountant', description: 'Manages fees, payments, and financial records' },
      { role_name: 'Library Staff', description: 'Manages book inventory and issues' },
    ]);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('roles', null, {});
  },
};
