'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const roles = await queryInterface.sequelize.query(`SELECT role_id, role_name FROM roles;`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    const permissions = await queryInterface.sequelize.query(
      `SELECT permission_id, permission_name FROM permissions;`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    const roleId = (name) => roles.find((r) => r.role_name === name).role_id;
    const permId = (name) => permissions.find((p) => p.permission_name === name).permission_id;
    const allPermissionIds = permissions.map((p) => p.permission_id);

    const mappings = [];

    // Super Admin gets every permission
    allPermissionIds.forEach((pid) =>
      mappings.push({ role_id: roleId('Super Admin'), permission_id: pid })
    );

    // Admin gets everything except payroll (kept HR-only)
    allPermissionIds
      .filter((pid) => pid !== permId('manage_payroll'))
      .forEach((pid) => mappings.push({ role_id: roleId('Admin'), permission_id: pid }));

    // Teacher
    ['mark_attendance', 'enter_marks', 'manage_timetable'].forEach((p) =>
      mappings.push({ role_id: roleId('Teacher'), permission_id: permId(p) })
    );

    // Student
    ['view_fee_vouchers'].forEach((p) =>
      mappings.push({ role_id: roleId('Student'), permission_id: permId(p) })
    );

    // Parent
    ['view_fee_vouchers'].forEach((p) =>
      mappings.push({ role_id: roleId('Parent'), permission_id: permId(p) })
    );

    // HR
    ['manage_teachers', 'manage_payroll'].forEach((p) =>
      mappings.push({ role_id: roleId('HR'), permission_id: permId(p) })
    );

    // Accountant
    ['manage_fees', 'view_fee_vouchers', 'view_reports'].forEach((p) =>
      mappings.push({ role_id: roleId('Accountant'), permission_id: permId(p) })
    );

    // Library Staff
    ['manage_library'].forEach((p) =>
      mappings.push({ role_id: roleId('Library Staff'), permission_id: permId(p) })
    );

    await queryInterface.bulkInsert('role_permissions', mappings);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('role_permissions', null, {});
  },
};
