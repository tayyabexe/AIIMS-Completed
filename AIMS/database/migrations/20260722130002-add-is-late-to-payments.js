'use strict';

// Bug found during a from-scratch migration test (Day 12): on the shared
// Aiven DB, `payments` already existed (from schema.sql's bootstrap) when
// this migration first ran, so a plain addColumn worked fine there. But on a
// truly fresh database built only from `sequelize db:migrate`, this
// migration's timestamp (2026-07-22) runs long before
// 20260724100026-create-payments.js ever creates the table - so the original
// unguarded addColumn failed with "Table 'payments' doesn't exist". Guarded
// the same way as the table-creation migrations: no-op if the table isn't
// there yet or the column is already present (idempotent either way). The
// column itself is now also declared directly in
// 20260724100026-create-payments.js so a fresh install ends up correct
// regardless of which of the two migrations actually adds it.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('payments')) return;

    const columns = await queryInterface.describeTable('payments');
    if (columns.is_late) return;

    await queryInterface.addColumn('payments', 'is_late', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('payments')) return;

    const columns = await queryInterface.describeTable('payments');
    if (!columns.is_late) return;

    await queryInterface.removeColumn('payments', 'is_late');
  },
};
