'use strict';

// Adds is_deleted indexes for the soft-deletable tables that were missed when
// constraints.sql added matching indexes for students/employees/teachers/
// subjects/books (is_deleted itself is low-cardinality, but every query on
// these models goes through a Sequelize defaultScope filtering is_deleted =
// false, so an unfiltered "list all active X" lookup benefits from it).
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('departments', ['is_deleted'], { name: 'idx_departments_deleted' });
    await queryInterface.addIndex('programs', ['is_deleted'], { name: 'idx_programs_deleted' });
    await queryInterface.addIndex('batches', ['is_deleted'], { name: 'idx_batches_deleted' });
    await queryInterface.addIndex('sections', ['is_deleted'], { name: 'idx_sections_deleted' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('departments', 'idx_departments_deleted');
    await queryInterface.removeIndex('programs', 'idx_programs_deleted');
    await queryInterface.removeIndex('batches', 'idx_batches_deleted');
    await queryInterface.removeIndex('sections', 'idx_sections_deleted');
  },
};
