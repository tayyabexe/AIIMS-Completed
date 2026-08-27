import { useState } from 'react';
import { useSort, SortHeader } from '../../components/common/SortableHeader';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import { formatMoney } from '../../utils/currency';
import { feePayments as feePaymentsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import {
  payableVouchersOf, voucherClaimable, voucherPending, voucherDue,
  isVoucherAwaitingVerification,
} from '../../utils/feePayable';

/*
 * The selected child's fee position, vouchers and payment history.
 *
 * Everything comes from GET /api/parent/fees, which returns one already-settled
 * position per child: the vouchers, their instalments, and billed/paid/due/
 * advance with overpayment carried forward oldest-voucher-first.
 *
 * That settlement used to run on the client — here and, separately, in the
 * student portal — and the two implementations disagreed. It is computed once
 * on the server now (feeService.getStudentPosition), so both portals show the
 * same numbers for the same child by construction.
 *
 * Two fabrications used to live here and are gone: a "semester-wise ledger"
 * invented by walking backwards from the current semester subtracting Rs. 3,000
 * a term and assuming every past semester was paid in full on a made-up date,
 * and a fee "breakdown" splitting the amount into five fixed percentages
 * (Tuition 60%, Lab 11%, Sports 5%…) matching no row in the database.
 *
 * The screen also said the same two numbers three times over — once in the KPI
 * tiles, again in a "Payment Progress" panel, and again in a "Fee Structure"
 * panel whose only two rows were "Paid to date" and "Outstanding". The position
 * is now stated once, and the space goes to the payment history, which was
 * fetched but never shown: `childReceipts` was computed only to print a count.
 */

const INK = '#0F172A';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const OK = '#047857';
const WARN = '#B45309';
const BAD = '#B91C1C';

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const card = {
  backgroundColor: '#FFFFFF',
  border: `1px solid ${LINE}`,
  borderRadius: '14px',
};

const panelHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0.75rem 1.2rem', borderBottom: `1px solid ${LINE}`,
};

const panelTitle = {
  fontSize: '0.9rem', fontWeight: 600, color: INK, margin: 0,
  fontFamily: "'Outfit', sans-serif",
};

const th = {
  padding: '0.6rem 1.2rem', textAlign: 'left', color: MUTED,
  fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap',
};

const td = { padding: '0.65rem 1.2rem', color: INK, fontSize: '0.84rem' };

const statusTone = (status) => {
  if (status === 'Paid') return { fg: OK, bg: '#ECFDF5' };
  if (status === 'Overdue') return { fg: BAD, bg: '#FEE2E2' };
  return { fg: WARN, bg: '#FEF3C7' };
};

// The raw fee/challan/receipt rows are no longer taken as props: the loader
// merges them into one settled ledger and hangs it off the child record, so
// every screen reads the same numbers.
const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Card', 'Mobile Wallet', 'Online', 'Cheque'];

const todayIso = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function ParentFeeView({ wards, selectedChildId }) {
  /*
   * Declaring a payment.
   *
   * This does not settle anything. POST /api/fee-payments/submit writes the
   * instalment as Pending and leaves the voucher alone until the accounts
   * office verifies it — a parent confirming their own payment would otherwise
   * be able to clear a balance by typing a number. The form says so plainly
   * rather than implying the money has landed.
   */
  // Re-reads /api/parent/* after a declaration lands, so the screen stops
  // showing the position from before it. See the call in submitPayment.
  const { reloadParentData } = useAuth();

  const [form, setForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const online = useOnlineStatus();

  /*
   * A part-filled payment declaration survives a crash or a refresh.
   *
   * The key carries the voucher, so a declaration started against one voucher
   * can never reappear against another — which would attach money to the wrong
   * bill. The stored draft is only a form: nothing is sent to the server, and
   * nothing is settled, until the parent presses Submit.
   */
  const paymentDraft = useDraft(
    `parent.payment.${form?.fee_voucher_id || 'none'}`,
    form,
    {
      enabled: !!form,
      onRestore: (value) => { if (value) setForm(value); },
      isEmpty: (value) => !value || !value.amount_paid,
    },
  );
  const [submitted, setSubmitted] = useState(null);

  const child = wards.find((c) => c.id === selectedChildId) || wards[0];

  const vouchers = child?.feeVouchers || [];
  const payments = child?.feeTransactions || [];

  /*
   * Voucher sorting. Each accessor reads the same value the cell prints —
   * `settled_paid` / `settled_due` are the position after overpayment has been
   * carried across, so sorting on the raw `amount_paid` would order the table
   * by a number that is not on screen.
   */
  const {
    sorted: sortedVouchers, sort: voucherSort, toggle: toggleVoucherSort,
  } = useSort(vouchers, {
    voucher: (v) => v.voucher_number,
    due: (v) => (v.due_date ? new Date(v.due_date).getTime() : null),
    billed: (v) => Number(v.total_payable ?? 0),
    paid: (v) => Number(v.settled_paid ?? v.amount_paid ?? 0),
    balance: (v) => Number(v.settled_due ?? v.remaining_balance ?? 0),
    status: (v) => {
      const paid = Number(v.settled_paid ?? v.amount_paid ?? 0);
      const due = Number(v.settled_due ?? v.remaining_balance ?? 0);
      return due === 0 ? 'Paid' : paid > 0 ? 'Partial' : (v.status || 'Unpaid');
    },
  });

  const billed = child?.feeBilled ?? 0;
  const paid = child?.feePaid ?? 0;
  const outstanding = child?.feeOutstanding ?? 0;
  const advance = child?.feeAdvance ?? 0;
  const awaiting = child?.feePending ?? 0;

  /*
   * Only a voucher that still has room for a DECLARATION can be paid against.
   *
   * This used to filter on `settled_due > 0` alone. `settled_due` counts
   * verified money only — correctly, because a declaration settles nothing —
   * so a voucher whose whole balance was already sitting in a Pending
   * submission still passed the test and kept its "Submit payment" button.
   * Pressing it again reached the server, which refused with "already settled
   * or fully claimed": a correct answer that read as a broken feature.
   *
   * The rule lives in utils/feePayable.js now, shared with the student portal,
   * and mirrors the server's own room calculation in submitPaymentDeclaration.
   */
  const payableVouchers = payableVouchersOf(vouchers);

  // Still owes money, but every rupee of it is already claimed. These get an
  // "Awaiting verification" line in place of a button, so the parent can see
  // their submission landed rather than being told there is nothing to pay.
  const awaitingVouchers = vouchers.filter(isVoucherAwaitingVerification);

  const openForm = (voucher) => {
    setFormError(null);
    setSubmitted(null);
    setForm({
      fee_voucher_id: voucher.fee_voucher_id,
      voucher_number: voucher.voucher_number,
      // The cap is what may still be DECLARED — the balance less anything
      // already awaiting a decision — so the form cannot offer to submit money
      // the server will refuse as already claimed.
      max: voucherClaimable(voucher),
      amount_paid: String(voucherClaimable(voucher) || ''),
      payment_method: 'Bank Transfer',
      payment_date: todayIso(),
    });
  };

  const submitPayment = async () => {
    if (!form) return;
    setFormError(null);

    const amount = Number(form.amount_paid);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter the amount you paid.');
      return;
    }
    if (amount > form.max) {
      setFormError(`That is more than the ${formatMoney(form.max)} outstanding on this voucher.`);
      return;
    }

    setSubmitting(true);
    try {
      await feePaymentsApi.submit({
        fee_voucher_id: form.fee_voucher_id,
        amount_paid: amount,
        payment_method: form.payment_method,
        payment_date: form.payment_date,
      });
      setSubmitted(
        `Submitted ${formatMoney(amount)} against ${form.voucher_number}. `
        + 'The accounts office will confirm it — the balance will not change until then.',
      );
      // The local copy is only dropped once the declaration has been sent.
      paymentDraft.clear();
      setForm(null);

      /*
       * Re-read the position, so the screen agrees with the server it just
       * told the parent had accepted their submission.
       *
       * Without this the fee screen keeps rendering the bundle loaded at
       * sign-in for the rest of the session: the voucher still shows as
       * payable, the "Submit payment" button is still offered against money
       * that is now fully claimed, and Payment History still says "None yet"
       * under a message confirming a payment was submitted. Pressing the
       * button again reached the server, which refused it — correctly — as
       * "already settled or fully claimed", which reads to the parent as the
       * feature being broken.
       *
       * This is the same reload the student portal does through the profile
       * provider. The parent portal shares the payable RULE with it but had no
       * way to refetch, so it could not share the behaviour.
       */
      await reloadParentData?.();
    } catch (err) {
      setFormError(err.message || 'Could not submit that payment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!child) return null;

  const status = child.feeStatus || null;
  const tone = statusTone(status);
  const progress = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : null;

  const tiles = [
    { label: 'Total billed', value: formatMoney(billed), color: INK, note: `${vouchers.length} voucher${vouchers.length === 1 ? '' : 's'}` },
    { label: 'Paid', value: formatMoney(paid), color: INK, note: payments.length ? `${payments.length} payment${payments.length === 1 ? '' : 's'}` : 'No payments recorded' },
    advance > 0
      // Paid beyond what has been billed: credit, not a negative balance.
      ? { label: 'Advance balance', value: formatMoney(advance), color: OK, note: 'Carried against future vouchers' }
      : { label: 'Outstanding', value: formatMoney(outstanding), color: outstanding > 0 ? BAD : OK, note: outstanding > 0 ? 'Payable now' : 'Nothing due' },
    { label: 'Status', value: status || '—', color: status ? tone.fg : MUTED, note: child.dueDate ? `Due ${formatDate(child.dueDate)}` : 'No due date set' },
  ];

  // Shown only when there is something to show, and never folded into the
  // Paid or Outstanding tiles — an unverified claim is not money received.
  if (awaiting > 0) {
    tiles.push({
      label: 'Awaiting verification',
      value: formatMoney(awaiting),
      color: WARN,
      note: 'Submitted by you, not yet confirmed',
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      <div>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: INK, margin: '0 0 0.25rem', fontFamily: "'Outfit', sans-serif" }}>
          Fee Details
        </h2>
        <p style={{ fontSize: '0.85rem', color: MUTED, margin: 0 }}>
          {[child.name, child.regNo, child.program].filter((v) => v && v !== '—').join(' · ')}
        </p>
      </div>

      {vouchers.length === 0 ? (
        <div style={{ ...card, padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: INK, margin: '0 0 0.35rem' }}>
            No fee records
          </p>
          <p style={{ fontSize: '0.84rem', color: MUTED, margin: 0 }}>
            No fee has been issued to {child.name} yet.
          </p>
        </div>
      ) : (
        <>
          {/* The position, stated once. */}
          <div style={{ ...card, padding: '1.1rem 1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              {tiles.map((t) => (
                <div key={t.label}>
                  <p style={{ fontSize: '0.76rem', color: MUTED, fontWeight: 600, margin: 0 }}>{t.label}</p>
                  <p style={{ fontSize: '1.3rem', fontWeight: 700, color: t.color, margin: '2px 0 0', lineHeight: 1.15, fontFamily: "'Outfit', sans-serif" }}>
                    {t.value}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: FAINT, margin: '2px 0 0' }}>{t.note}</p>
                </div>
              ))}
            </div>

            {progress !== null && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ height: '6px', backgroundColor: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '3px',
                    width: `${progress}%`,
                    backgroundColor: outstanding > 0 ? (status === 'Overdue' ? BAD : WARN) : OK,
                  }} />
                </div>
                <p style={{ fontSize: '0.75rem', color: MUTED, margin: '6px 0 0' }}>
                  {progress}% of billed fees paid
                </p>
              </div>
            )}
          </div>

          {/* Vouchers issued */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={panelHeader}>
              <h3 style={panelTitle}>Vouchers</h3>
              <span style={{ fontSize: '0.76rem', color: MUTED }}>
                {vouchers.length} issued
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: `1px solid ${LINE}` }}>
                    {[
                      ['voucher', 'Voucher', 'left'], ['due', 'Due date', 'left'],
                      ['billed', 'Billed', 'right'], ['paid', 'Paid', 'right'],
                      ['balance', 'Balance', 'right'], ['status', 'Status', 'center'],
                    ].map(([key, label, align]) => (
                      <SortHeader
                        key={key}
                        label={label}
                        sortKey={key}
                        sort={voucherSort}
                        onToggle={toggleVoucherSort}
                        align={align}
                        style={th}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedVouchers.map((v) => {
                    // `settled_paid` / `settled_due` are the position after
                    // overpayment has been carried across; `amount_paid` on the
                    // row is what was literally received against this voucher.
                    const paid = Number(v.settled_paid ?? v.amount_paid ?? 0);
                    /*
                     * THE BALANCE COLUMN IS THE BALANCE.
                     *
                     * This read `voucherClaimable(v)` — due MINUS anything
                     * declared and awaiting a decision. So declaring a payment
                     * for the full amount made this table report Balance
                     * Rs. 0 and Status "Paid", while the panel directly
                     * underneath it correctly said "the balance stays at
                     * Rs. 55,000 until the accounts office confirms it". Two
                     * statements on one screen, contradicting each other, and
                     * the wrong one was the one that looked authoritative.
                     *
                     * `voucherClaimable` answers "how much may still be
                     * SUBMITTED against this voucher". That is the right
                     * question for a Submit button and the wrong one for a
                     * ledger. A declaration is a claim about money, not money:
                     * until it is verified the family still owes every rupee.
                     */
                    const due = voucherDue(v);
                    const claimed = voucherPending(v);
                    const carried = Number(v.carried_in ?? 0);
                    const overdue = v.status === 'Overdue' && due > 0;
                    /*
                     * "Awaiting" outranks "Unpaid" but never "Paid": money
                     * that has been claimed in full is not settled, and saying
                     * so is the point, but the reader still needs to see that
                     * something has been done about it.
                     */
                    const label = due === 0
                      ? 'Paid'
                      : claimed >= due
                        ? 'Awaiting'
                        : paid > 0 ? 'Partial' : (v.status || 'Unpaid');
                    const vt = statusTone(overdue ? 'Overdue' : label);
                    return (
                      <tr key={v.fee_voucher_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ ...td, fontWeight: 600 }}>{v.voucher_number}</td>
                        <td style={{ ...td, color: overdue ? BAD : MUTED }}>{formatDate(v.due_date)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{formatMoney(v.total_payable)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {formatMoney(paid)}
                          {carried > 0 && (
                            // Money that reached this voucher as an
                            // overpayment on another one, not as a payment
                            // made against it.
                            <span style={{ display: 'block', fontSize: '0.71rem', color: FAINT, fontWeight: 400 }}>
                              incl. {formatMoney(carried)} carried forward
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: due > 0 ? BAD : OK }}>
                          {formatMoney(due)}
                          {claimed > 0 && due > 0 && (
                            // Named under the balance rather than subtracted
                            // from it, so the reader can see both the debt and
                            // what has been said about it.
                            <span style={{ display: 'block', fontSize: '0.71rem', color: WARN, fontWeight: 400 }}>
                              {formatMoney(claimed)} declared, unverified
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 600, padding: '2px 9px',
                            borderRadius: '20px', backgroundColor: vt.bg, color: vt.fg,
                          }}>
                            {overdue ? 'Overdue' : label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Submit a payment.
              A declaration, not a transaction: the row lands Pending and the
              balance above does not move until the accounts office verifies
              it. There is no payment gateway in this system, so what a parent
              can do here is tell the institute a transfer has been made and
              give it the details to check against. */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={panelHeader}>
              <h3 style={panelTitle}>Submit a payment</h3>
              <span style={{ fontSize: '0.76rem', color: MUTED }}>
                {payableVouchers.length
                  ? `${payableVouchers.length} voucher${payableVouchers.length === 1 ? '' : 's'} outstanding`
                  : awaitingVouchers.length
                    ? `${awaitingVouchers.length} awaiting verification`
                    : 'Nothing outstanding'}
              </span>
            </div>

            <div style={{ padding: '1rem 1.2rem' }}>
              {submitted && (
                <p style={{
                  fontSize: '0.82rem', color: OK, backgroundColor: '#ECFDF5',
                  border: '1px solid #A7F3D0', borderRadius: '8px',
                  padding: '0.65rem 0.8rem', margin: '0 0 0.9rem',
                }}>
                  {submitted}
                </p>
              )}

              {/* Vouchers whose whole balance is already declared. Shown
                  above the payable list and never as a button — the money is
                  claimed, and claiming it twice is what the server refuses. */}
              {awaitingVouchers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: payableVouchers.length ? '0.9rem' : 0 }}>
                  {awaitingVouchers.map((v) => (
                    <div
                      key={`awaiting-${v.fee_voucher_id}`}
                      style={{
                        border: '1px solid #FDE68A', backgroundColor: '#FFFBEB',
                        borderRadius: '10px', padding: '0.65rem 0.85rem',
                      }}
                    >
                      <p style={{ fontSize: '0.85rem', fontWeight: 600, color: INK, margin: 0 }}>
                        {v.voucher_number} · awaiting verification
                      </p>
                      <p style={{ fontSize: '0.75rem', color: WARN, margin: '2px 0 0' }}>
                        {formatMoney(voucherPending(v))} declared and not yet confirmed
                        by the accounts office. The balance stays at{' '}
                        {formatMoney(voucherDue(v))} until it is.
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {payableVouchers.length === 0 ? (
                <p style={{ fontSize: '0.84rem', color: MUTED, margin: 0 }}>
                  {awaitingVouchers.length
                    ? 'Everything outstanding has been declared and is waiting on the '
                      + 'accounts office. There is nothing further to submit.'
                    : `Every voucher issued to ${child.name} is settled. Nothing to pay.`}
                </p>
              ) : !form ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ fontSize: '0.82rem', color: MUTED, margin: '0 0 0.3rem' }}>
                    Already paid at the bank? Tell us, and the accounts office will
                    confirm it against their records.
                  </p>
                  {payableVouchers.map((v) => {
                    /*
                     * Both numbers, named here rather than borrowed.
                     *
                     * `claimed` was read from a `const` declared inside the
                     * VOUCHER TABLE's map, 126 lines up and in a scope this
                     * one cannot see. It threw ReferenceError the moment a
                     * payable voucher existed — which is to say, every time a
                     * parent actually had something to pay. It did not show up
                     * when the fix was written because the only voucher in the
                     * database at that moment was fully settled, so this
                     * branch never rendered.
                     *
                     * `due` is the raw balance, which is what "outstanding"
                     * means to the reader. `claimed` is what has been declared
                     * against it and not yet decided on. They are deliberately
                     * separate: the balance does not move when a declaration
                     * is made, and reporting one as the other is the whole
                     * confusion this panel exists to undo.
                     */
                    const due = Number(v.settled_due ?? v.remaining_balance ?? 0);
                    const claimed = voucherPending(v);
                    return (
                      <div
                        key={v.fee_voucher_id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: '1rem', flexWrap: 'wrap',
                          border: `1px solid ${LINE}`, borderRadius: '10px',
                          padding: '0.65rem 0.85rem',
                        }}
                      >
                        <div>
                          <p style={{ fontSize: '0.85rem', fontWeight: 600, color: INK, margin: 0 }}>
                            {v.voucher_number}
                          </p>
                          <p style={{ fontSize: '0.75rem', color: FAINT, margin: '2px 0 0' }}>
                            {formatMoney(due)} outstanding
                            {claimed > 0 ? ` · ${formatMoney(claimed)} already declared` : ''}
                            {v.due_date ? ` · due ${formatDate(v.due_date)}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openForm(v)}
                          style={{
                            fontSize: '0.8rem', fontWeight: 600, color: '#FFFFFF',
                            backgroundColor: INK, border: 'none', borderRadius: '8px',
                            padding: '0.5rem 0.9rem', cursor: 'pointer',
                          }}
                        >
                          Submit payment
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <p style={{ fontSize: '0.82rem', color: MUTED, margin: 0 }}>
                    Paying <strong style={{ color: INK }}>{form.voucher_number}</strong> —{' '}
                    {formatMoney(form.max)} outstanding.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 600, color: MUTED }}>
                      Amount paid
                      <input
                        type="number"
                        min="1"
                        max={form.max}
                        step="0.01"
                        value={form.amount_paid}
                        onChange={(e) => setForm({ ...form, amount_paid: e.target.value })}
                        style={{
                          display: 'block', width: '100%', marginTop: '4px',
                          padding: '0.5rem 0.6rem', fontSize: '0.85rem', color: INK,
                          border: `1px solid ${LINE}`, borderRadius: '8px',
                        }}
                      />
                    </label>

                    <label style={{ fontSize: '0.76rem', fontWeight: 600, color: MUTED }}>
                      How you paid
                      <select
                        value={form.payment_method}
                        onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                        style={{
                          display: 'block', width: '100%', marginTop: '4px',
                          padding: '0.5rem 0.6rem', fontSize: '0.85rem', color: INK,
                          border: `1px solid ${LINE}`, borderRadius: '8px', backgroundColor: '#FFFFFF',
                        }}
                      >
                        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>

                    <label style={{ fontSize: '0.76rem', fontWeight: 600, color: MUTED }}>
                      Date paid
                      <input
                        type="date"
                        value={form.payment_date}
                        max={todayIso()}
                        onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                        style={{
                          display: 'block', width: '100%', marginTop: '4px',
                          padding: '0.5rem 0.6rem', fontSize: '0.85rem', color: INK,
                          border: `1px solid ${LINE}`, borderRadius: '8px',
                        }}
                      />
                    </label>
                  </div>

                  <DraftNotice draft={paymentDraft} online={online} compact />

                  {formError && (
                    <p style={{
                      fontSize: '0.8rem', color: BAD, backgroundColor: '#FEE2E2',
                      border: '1px solid #FECACA', borderRadius: '8px',
                      padding: '0.55rem 0.7rem', margin: 0,
                    }}>
                      {formError}
                    </p>
                  )}

                  <p style={{ fontSize: '0.76rem', color: FAINT, margin: 0 }}>
                    This records what you have told us. The balance changes only once
                    the accounts office has checked it against their records.
                  </p>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={submitPayment}
                      disabled={submitting}
                      style={{
                        fontSize: '0.82rem', fontWeight: 600, color: '#FFFFFF',
                        backgroundColor: submitting ? FAINT : INK, border: 'none',
                        borderRadius: '8px', padding: '0.55rem 1rem',
                        cursor: submitting ? 'default' : 'pointer',
                      }}
                    >
                      {submitting ? 'Submitting…' : 'Submit for verification'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForm(null); setFormError(null); }}
                      disabled={submitting}
                      style={{
                        fontSize: '0.82rem', fontWeight: 600, color: MUTED,
                        backgroundColor: '#FFFFFF', border: `1px solid ${LINE}`,
                        borderRadius: '8px', padding: '0.55rem 1rem', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Payment history — fetched by the old screen, but never shown. */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={panelHeader}>
              <h3 style={panelTitle}>Payment history</h3>
              <span style={{ fontSize: '0.76rem', color: MUTED }}>
                {payments.length ? `${formatMoney(paid)} received` : 'None yet'}
              </span>
            </div>

            {payments.length === 0 ? (
              <p style={{ fontSize: '0.84rem', color: MUTED, margin: 0, padding: '1.5rem 1.2rem', textAlign: 'center' }}>
                No payments have been recorded against {child.name}’s vouchers.
              </p>
            ) : (
              /* A row list rather than a five-column table. Every field is
                 still here — date, receipt number, voucher settled, method,
                 amount, late flag — but ranked: the date and amount are what a
                 parent scans for, the two reference numbers are secondary and
                 sit under their own line so they never read as one number. */
              <div>
                {payments.map((p) => {
                  return (
                    <div
                      key={p.fee_payment_id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '1rem',
                        padding: '0.8rem 1.2rem', borderBottom: '1px solid #F1F5F9',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ minWidth: '150px' }}>
                        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: INK, margin: 0 }}>
                          {formatDate(p.payment_date)}
                        </p>
                        <p style={{ fontSize: '0.73rem', color: FAINT, margin: '2px 0 0' }}>
                          {p.receipt_number ? `Receipt ${p.receipt_number}` : 'No receipt number'}
                        </p>
                      </div>

                      <div style={{ flex: 1, minWidth: '170px' }}>
                        <p style={{ fontSize: '0.82rem', color: MUTED, margin: 0 }}>
                          Against {p.voucherNumber || 'an unmatched voucher'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
                          {p.payment_method && (
                            <span style={{
                              fontSize: '0.71rem', fontWeight: 600, color: MUTED,
                              backgroundColor: '#F1F5F9', padding: '2px 8px', borderRadius: '20px',
                            }}>
                              {p.payment_method}
                            </span>
                          )}
                          {/* A declaration this parent made that nobody has
                              confirmed. It is listed so they can see it was
                              received, but it is not counted as paid. */}
                          {p.status === 'Pending' && (
                            <span style={{
                              fontSize: '0.71rem', fontWeight: 600, color: WARN,
                              backgroundColor: '#FEF3C7', padding: '2px 8px', borderRadius: '20px',
                            }}>
                              Awaiting verification
                            </span>
                          )}
                          {p.status === 'Rejected' && (
                            <span style={{
                              fontSize: '0.71rem', fontWeight: 600, color: BAD,
                              backgroundColor: '#FEE2E2', padding: '2px 8px', borderRadius: '20px',
                            }}>
                              Rejected
                            </span>
                          )}
                          {p.is_late && (
                            <span style={{
                              fontSize: '0.71rem', fontWeight: 600, color: WARN,
                              backgroundColor: '#FEF3C7', padding: '2px 8px', borderRadius: '20px',
                            }}>
                              Paid late
                            </span>
                          )}
                        </div>
                      </div>

                      <p style={{
                        fontSize: '0.95rem', fontWeight: 700, margin: 0,
                        fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap',
                        // An unconfirmed or refused claim is greyed and struck
                        // so it never reads as part of the total received.
                        color: p.status === 'Verified' ? INK : FAINT,
                        textDecoration: p.status === 'Rejected' ? 'line-through' : 'none',
                      }}>
                        {formatMoney(p.amount_paid)}
                      </p>
                    </div>
                  );
                })}

                {/* The sum of the rows above, so the history reconciles against
                    the "Paid" figure in the summary without the reader adding
                    it up themselves.

                    Verified rows only — a pending declaration is listed above
                    but is not money received, and including it here would make
                    this total disagree with the summary by exactly the amount
                    awaiting verification. */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.75rem 1.2rem', backgroundColor: '#F8FAFC',
                }}>
                  <span style={{ fontSize: '0.8rem', color: MUTED, fontWeight: 600 }}>
                    Total received
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: INK, fontFamily: "'Outfit', sans-serif" }}>
                    {formatMoney(
                      payments
                        .filter((p) => (p.status ?? 'Verified') === 'Verified')
                        .reduce((s, p) => s + Number(p.amount_paid || 0), 0),
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
