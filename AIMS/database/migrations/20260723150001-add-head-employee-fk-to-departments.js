'use strict';

// Gap fix: departments.head_employee_id was added as a plain nullable
// column in 20260721090005-create-departments.js (departments was created
// before employees existed, so the FK couldn't be added yet at that point,
// and nothing added it afterward). schema.sql's raw bootstrap DID add this
// FK via a later ALTER TABLE, so the shared dev database already has it
// (constraint `departments_ibfk_1`) - but a fresh database built purely via
// `sequelize db:migrate` would be missing it. This migration closes that gap
// for fresh databases while no-op'ing on databases (like this shared one)
// that already have the constraint from schema.sql.
module.exports = {
  async up(queryInterface, Sequelize) {
    const [existing] = await queryInterface.sequelize.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments'
       AND COLUMN_NAME = 'head_employee_id' AND REFERENCED_TABLE_NAME IS NOT NULL;`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (existing) return;

    await queryInterface.addConstraint('departments', {
      fields: ['head_employee_id'],
      type: 'foreign key',
      name: 'fk_departments_head_employee',
      references: { table: 'employees', field: 'employee_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },
  async down(queryInterface) {
    await queryInterface.removeConstraint('departments', 'fk_departments_head_employee');
  },
};
