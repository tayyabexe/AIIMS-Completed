'use strict';

// Found via a full information_schema audit of all 45 tables (not just the
// Sequelize-managed ones): three tables have an is_deleted column with no
// supporting index.
//   - users: missed by both constraints.sql's original pass (which covered
//     students/employees/teachers/subjects/books) and the later
//     20260722110001 optimization pass (which covered departments/programs/
//     batches/sections) - User.js has applied `defaultScope: { where: {
//     is_deleted: false } }` on every query this whole time with no index
//     backing it.
//   - classrooms: gained an is_deleted-filtering defaultScope when
//     Classroom.js was added, but its backfill migration didn't add this
//     index (constraints.sql's original pass predates the Classroom model
//     and never covered it either).
//   - parents: has no Sequelize model yet, but the physical column and the
//     same query pattern (filtering out soft-deleted rows) will apply once
//     one exists - and the index costs nothing to add now.
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('users', ['is_deleted'], { name: 'idx_users_deleted' });
    await queryInterface.addIndex('classrooms', ['is_deleted'], { name: 'idx_classrooms_deleted' });
    await queryInterface.addIndex('parents', ['is_deleted'], { name: 'idx_parents_deleted' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'idx_users_deleted');
    await queryInterface.removeIndex('classrooms', 'idx_classrooms_deleted');
    await queryInterface.removeIndex('parents', 'idx_parents_deleted');
  },
};
