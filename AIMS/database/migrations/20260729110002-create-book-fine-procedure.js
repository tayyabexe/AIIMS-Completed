'use strict';

// The only genuinely justified new procedure found in this pass (task said
// "if required" - this is the one real gap). vw_overdue_book_issues
// (previous migration) surfaced that all 68 currently-overdue book_issues
// live have fine_amount = 0.00, unflagged - the exact same problem
// sp_mark_overdue_fees solved for tuition fees, just never built for the
// library module. Idempotent: recomputes fine_amount from due_date each
// run rather than incrementing it, so running it twice in a day is safe.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('DROP PROCEDURE IF EXISTS sp_calculate_book_fines');
    await queryInterface.sequelize.query(`
CREATE PROCEDURE sp_calculate_book_fines()
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- PKR 10.00/day overdue - no late-fee policy is defined anywhere in
    -- the schema or docs, this is a placeholder rate and the only literal
    -- in this procedure, so it's a one-line change if the real policy
    -- differs.
    UPDATE book_issues
       SET fine_amount = DATEDIFF(CURDATE(), due_date) * 10.00
     WHERE return_date IS NULL
       AND due_date < CURDATE();

    COMMIT;
END`);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP PROCEDURE IF EXISTS sp_calculate_book_fines');
  },
};
