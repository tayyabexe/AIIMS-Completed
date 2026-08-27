/*
 * When a fee voucher can still be paid against — stated once, for every portal.
 *
 * THE BUG THIS EXISTS TO CLOSE
 * ----------------------------
 * The parent portal decided a voucher was payable from `settled_due` alone:
 *
 *     vouchers.filter((v) => Number(v.settled_due ?? 0) > 0 && v.status !== 'Cancelled')
 *
 * `settled_due` counts VERIFIED money only, and that is correct — a declaration
 * a family makes about its own payment moves nothing until the accounts office
 * confirms it. But it means a voucher whose whole balance is already sitting in
 * a Pending declaration still reports `settled_due > 0`, so "Submit payment"
 * stayed on screen after the parent had just used it. Pressing it again reached
 * `submitPaymentDeclaration`, which correctly refused with "This voucher is
 * already settled or fully claimed" — a correct backend answer that reads to
 * the user as a broken feature.
 *
 * The server was never the problem. It has always returned `pending_amount` per
 * voucher and `totals.pending` for the position; the screens simply did not
 * read them. That is the pattern: the backend finished, the screen did not, and
 * the gap showed up as a button that lies.
 *
 * WHAT IS CLAIMED vs WHAT IS OWED
 * -------------------------------
 * Three different numbers, and conflating any two of them is what causes this
 * class of bug:
 *
 *   settled_due     what the institute is still owed. Only verified money
 *                   reduces it. This is the BALANCE, and it must not move on a
 *                   declaration.
 *   pending_amount  what has been declared against this voucher and not yet
 *                   decided on. Not money — a claim about money.
 *   claimable       settled_due - pending_amount. What may still be declared.
 *                   This, and only this, is what a Submit button acts on.
 *
 * The balance a student sees stays `settled_due`, because that is what they owe
 * until the office says otherwise. `claimable` governs the control, never the
 * figure.
 *
 * This mirrors the server's own rule in
 * backend/src/services/feeService.js -> submitPaymentDeclaration, which sizes
 * the room as `total_payable - SUM(Verified + Pending)`. Keeping the two in
 * step is the whole point of putting it in one file: two copies of this rule is
 * how they drifted in the first place.
 */

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The outstanding balance on a voucher: what is still owed, verified money
 * only. Accepts both the server shape (`settled_due`) and the student portal's
 * mapped shape (`due`), plus the legacy `remaining_balance`.
 */
export const voucherDue = (voucher) =>
  toNumber(voucher?.settled_due ?? voucher?.due ?? voucher?.remaining_balance ?? 0);

/**
 * What has been declared against this voucher and is waiting on the accounts
 * office. Never netted off the balance — see the note above.
 */
export const voucherPending = (voucher) =>
  toNumber(voucher?.pending_amount ?? voucher?.pending ?? 0);

/**
 * How much may still be DECLARED against this voucher: the balance less
 * anything already awaiting a decision. Never negative.
 *
 * This is the cap a submit form must enforce, and it is what the server will
 * accept. Capping at the balance instead is what let a parent submit a second
 * declaration for money they had already declared.
 */
export const voucherClaimable = (voucher) =>
  Math.max(0, voucherDue(voucher) - voucherPending(voucher));

/** A cancelled voucher is not payable whatever its arithmetic says. */
export const voucherCancelled = (voucher) => voucher?.status === 'Cancelled';

/**
 * True when the portal should still offer to declare a payment against this
 * voucher.
 */
export const isVoucherPayable = (voucher) =>
  !voucherCancelled(voucher) && voucherClaimable(voucher) > 0;

/**
 * True when the voucher still owes money but every rupee of it is already
 * claimed — the state that must show "Awaiting verification" rather than a
 * Submit button. Distinct from `paid`: nothing has been settled here.
 */
export const isVoucherAwaitingVerification = (voucher) =>
  !voucherCancelled(voucher)
  && voucherDue(voucher) > 0
  && voucherClaimable(voucher) <= 0;

/**
 * The vouchers a payment may still be declared against, in the order a payer
 * should deal with them: soonest due date first, so the most urgent bill is the
 * one the picker opens on.
 */
export const payableVouchersOf = (vouchers = []) =>
  vouchers
    .filter(isVoucherPayable)
    .slice()
    .sort((a, b) => String(a.due_date || a.dueDate || '')
      .localeCompare(String(b.due_date || b.dueDate || '')));

export default isVoucherPayable;
