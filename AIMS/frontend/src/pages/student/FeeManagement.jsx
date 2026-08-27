import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import { useStudentProfile } from '../../context/StudentProfileContext';
import { formatMoney } from '../../utils/currency';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import { feePayments as feePaymentsApi } from '../../api/endpoints';
import {
  payableVouchersOf, voucherClaimable, voucherPending,
  isVoucherAwaitingVerification,
} from '../../utils/feePayable';
import './StudentDashboard.css';
import './FeeManagement.css';
import { SkeletonRegion, SkeletonStatRow, SkeletonList } from '../../components/common/Skeleton';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconAlertCircle,
} from '../../components/student/icons';

/*
 * The signed-in student's own fees.
 *
 * This page used to be four hardcoded arrays: a Rs. 185,000 total, eight fee
 * categories, eight semesters of payments and ten invented transactions with
 * payment methods ("UPI", "Credit Card") that do not exist in this system.
 *
 * Every figure now comes from ONE call — GET /api/fee-vouchers/me — which
 * returns the student's whole position already settled by the server:
 *
 *   vouchers[]        -> what was billed (total_payable, issue/due date, status)
 *   vouchers[].payments[] -> what has actually been paid, instalment by
 *                        instalment, each with its receipt number and method
 *   vouchers[].settled_paid / settled_due / carried_in
 *                     -> the same voucher after overpayment has been carried
 *                        forward oldest-voucher-first
 *   totals            -> billed / paid / due / advance for the whole position
 *
 * That replaces the five endpoints this page used to merge by hand
 * (/api/student-fees, /api/challans, /api/receipts, /api/payments and the old
 * /api/fee-payments). Their tables were consolidated into `fee_vouchers` and
 * `fee_payments`, and the carry-forward now runs once in
 * feeService.getStudentPosition instead of twice on two clients that disagreed.
 *
 * NOT SHOWN, because the data does not support it:
 *   - A per-category breakdown (Tuition / Examination / Laboratory / Library).
 *     `fee_structures` does hold those four categories, but every voucher
 *     actually raised links to a Tuition Fee row — the other three have never
 *     been billed to anyone. A breakdown would be a single 100% Tuition bar, so
 *     the page reports per voucher, which is the real unit of billing here.
 *   - Scholarships and late-fee rules. Neither has a table in aims_db, so
 *     neither is claimed. (`fee_payments.is_late` flags a late instalment but
 *     carries no surcharge.)
 */

const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const money = (n) => formatMoney(n);

/** "2026-08-15" -> "15 Aug 2026". Dates arrive as MySQL DATE strings. */
const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Days until a due date; negative once it has passed. */
const daysUntil = (value) => {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
};

/** How a voucher's remaining balance should read. */
/*
 * A voucher's settlement state, from the three numbers that are easy to
 * conflate and mean quite different things:
 *
 *   due     — what is owed. VERIFIED money only. The balance.
 *   pending — declared and not yet decided on. A claim about money.
 *   paid    — what has actually been received.
 *
 * 'awaiting' sits between unpaid and paid: the whole balance has been claimed,
 * so there is nothing further for the student to submit, but the institute has
 * not agreed that the money arrived and the balance has not moved. Saying
 * "Paid" here would be the screen taking the payer's word for it; saying
 * "Unpaid" would hide that anything had been done.
 */
const settlementOf = (v) => {
  if ((v.due ?? 0) <= 0) return 'paid';
  if ((v.pending ?? 0) >= (v.due ?? 0)) return 'awaiting';
  return (v.paid ?? 0) > 0 ? 'partial' : 'unpaid';
};

const SETTLEMENT_LABEL = {
  paid: '✓ Paid', partial: 'Partial', unpaid: 'Unpaid', awaiting: 'Awaiting',
};

/* Urgency of an outstanding voucher, from its own due date — not a hardcoded
   "high/medium/low" tag. */
const priorityOf = (v) => {
  const days = daysUntil(v.dueDate);
  if (days === null) return 'medium';
  if (days < 0) return 'high';
  if (days <= 14) return 'high';
  if (days <= 45) return 'medium';
  return 'low';
};

const priorityLabel = (v) => {
  const days = daysUntil(v.dueDate);
  if (days === null) return 'due';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'due today';
  return `in ${days}d`;
};

const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Card', 'Mobile Wallet', 'Online', 'Cheque'];

/** Today as the YYYY-MM-DD a date input expects. */
const todayIso = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const FeeManagement = () => {
  const { studentData, loading, error, reload } = useStudentProfile();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const [activeTab, setActiveTab] = useState('all');

  /*
   * Declaring a payment.
   *
   * The backend has always allowed this: POST /api/fee-payments/submit lists
   * ROLES.STUDENT, and mayAccessStudent resolves a student caller to their own
   * record. Only the screen was missing, so a student could see a bill and had
   * no way to say they had paid it while their parent could. The workflow here
   * is deliberately the parent's, not a lighter version of it.
   *
   * It settles nothing. The row lands Pending, the balance above does not move,
   * and the accounts office decides. There is no payment gateway in this
   * system — what a student can do is tell the institute a transfer was made
   * and give it the details to check against.
   */
  const [form, setForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const online = useOnlineStatus();

  /*
   * A part-filled declaration survives a refresh or a crash.
   *
   * The key carries the voucher, so a declaration begun against one bill can
   * never reappear against another — that would attach money to the wrong
   * voucher. Nothing is sent until Submit is pressed.
   */
  const paymentDraft = useDraft(
    `student.payment.${form?.fee_voucher_id || 'none'}`,
    form,
    {
      enabled: !!form,
      onRestore: (value) => { if (value) setForm(value); },
      isEmpty: (value) => !value || !value.amount_paid,
    },
  );

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management', active: true },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  const fees = studentData?.fees || null;

  const vouchers = useMemo(() => fees?.vouchers || [], [fees]);
  const transactions = useMemo(() => fees?.transactions || [], [fees]);

  const paidPct = fees?.paidPercent ?? 0;

  /* The filter belongs to the voucher table and nothing else. It used to sit on
     the Payment History card while only affecting a second table underneath it,
     so choosing "Paid" left the visible list of payments unchanged. */
  const tabOptions = ['all', 'unpaid', 'paid'];
  const visibleVouchers = vouchers.filter((v) => {
    if (activeTab === 'all') return true;
    const s = settlementOf(v);
    return activeTab === 'paid' ? s === 'paid' : s !== 'paid';
  });

  /* Bars are drawn on one shared money scale, so the tallest voucher is the
     largest bill. Previously each bar's height was its own percentage paid,
     while the number printed above it was an absolute amount — a fully paid
     Rs. 45,000 voucher drew taller than a part-paid Rs. 97,500 one. */
  const maxBilled = vouchers.reduce((m, v) => Math.max(m, v.amount ?? 0), 0);

  /*
   * What may still be declared against, and what is already claimed.
   *
   * The rule is shared with the parent portal (utils/feePayable.js) rather than
   * written twice: `settled_due > 0` is NOT the test, because a voucher whose
   * whole balance is sitting in a Pending declaration still owes that money and
   * would keep its Submit button forever.
   */
  const payableVouchers = useMemo(() => payableVouchersOf(vouchers), [vouchers]);
  const awaitingVouchers = useMemo(
    () => vouchers.filter(isVoucherAwaitingVerification), [vouchers],
  );

  const openForm = (v) => {
    setFormError(null);
    setSubmitted(null);
    setForm({
      fee_voucher_id: v.feeVoucherId,
      voucher_number: v.voucherNumber,
      // The cap is what may still be CLAIMED, not the whole balance, so the
      // form cannot offer to submit money the server will refuse as already
      // claimed.
      max: voucherClaimable(v),
      amount_paid: String(voucherClaimable(v) || ''),
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
      setFormError(`That is more than the ${money(form.max)} still outstanding on this voucher.`);
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
        `Submitted ${money(amount)} against ${form.voucher_number}. `
        + 'The accounts office will confirm it — your balance will not change until then.',
      );
      // Dropped only once the declaration has actually been sent.
      paymentDraft.clear();
      setForm(null);
      // Pull the position again so the voucher moves straight to "awaiting
      // verification" instead of still offering a button that would be refused.
      if (typeof reload === 'function') await reload();
    } catch (err) {
      setFormError(err.message || 'Could not submit that payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasFeeData = Boolean(fees?.hasData);

  const renderBody = () => {
    if (loading) {
      // The totals strip and the voucher list, at the size they will be.
      return (
        <SkeletonRegion label="Loading your fee record">
          <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
          <SkeletonList rows={5} avatar={false} />
        </SkeletonRegion>
      );
    }

    if (error) {
      return (
        <div className="fee-empty-card">
          <div className="fee-empty-icon"><IconAlertCircle /></div>
          <h3 className="fee-empty-title">Could not load your fees</h3>
          <p className="fee-empty-text">{error}</p>
        </div>
      );
    }

    if (!hasFeeData) {
      return (
        <div className="fee-empty-card">
          <div className="fee-empty-icon"><IconCard /></div>
          <h3 className="fee-empty-title">No Fee Data Available</h3>
          <p className="fee-empty-text">
            There are no fee vouchers or payments recorded against your account.
          </p>
        </div>
      );
    }

    return (
      <>
        {/* ── 1. Summary + chart, side by side ────────────────────────────
            The totals and the per-voucher picture of the same money read
            together. The summary used to be two cards: a progress ring that
            listed Total Billed / Paid / Due underneath it, beside a stat row
            printing the same three figures again. */}
        <div className="fee-top-grid">
          <div className="fee-summary-card">
            <div className="fee-summary-head">
              <span className="card-title">Fee Summary</span>
              <span className="fee-summary-pct">
                {fees.paidPercent === null ? '—' : `${paidPct}% paid`}
              </span>
            </div>

            <div className="fee-progress-track">
              <div className="fee-progress-fill" style={{ width: `${paidPct}%` }}></div>
            </div>

            <div className="summary-stats-row">
              <div className="summary-stat-box green">
                <span className="summary-stat-value">{money(fees.totalBilled)}</span>
                <span className="summary-stat-label">Total Billed</span>
              </div>
              <div className="summary-stat-box blue">
                <span className="summary-stat-value">{money(fees.totalPaid)}</span>
                <span className="summary-stat-label">Total Paid</span>
              </div>
              <div className="summary-stat-box red">
                <span className="summary-stat-value">{money(fees.totalDue)}</span>
                <span className="summary-stat-label">Amount Due</span>
              </div>
              {/* Advance replaces the voucher count when the student is in
                  credit, because a surplus is the thing they need told.
                  Money declared and not yet confirmed outranks both: it is the
                  thing the student most needs to see the state of, and it is
                  deliberately NOT folded into Total Paid or netted off Amount
                  Due, because an unverified claim is not money received. */}
              {fees.totalPending > 0 ? (
                <div className="summary-stat-box amber">
                  <span className="summary-stat-value">{money(fees.totalPending)}</span>
                  <span className="summary-stat-label">Awaiting Verification</span>
                </div>
              ) : fees.advance > 0 ? (
                <div className="summary-stat-box green">
                  <span className="summary-stat-value">{money(fees.advance)}</span>
                  <span className="summary-stat-label">Advance Balance</span>
                </div>
              ) : (
                <div className="summary-stat-box amber">
                  <span className="summary-stat-value">{vouchers.length}</span>
                  <span className="summary-stat-label">Vouchers Issued</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Chart ────────────────────────────────────────────────────
              Bar height is the voucher's amount on a scale shared by every bar,
              and the green portion is what has been paid off it. */}
          <div className="semester-card">
            <span className="card-title">Payment by Voucher</span>
            <div className="semester-chart">
              {vouchers.map((v) => {
                const billed = v.amount ?? 0;
                // Height of the whole bar relative to the largest voucher.
                const barPct = maxBilled > 0 ? (billed / maxBilled) * 100 : 0;
                // Height of the green portion within that bar.
                const fillPct = billed > 0 ? Math.min(((v.paid ?? 0) / billed) * 100, 100) : 0;
                return (
                  <div className="sem-bar-col" key={v.key}>
                    <span className="sem-bar-amount">{money(billed)}</span>
                    <div
                      className="sem-bar-track"
                      style={{ height: `${barPct}%` }}
                      title={`${v.voucherNumber || 'Voucher'} — ${money(v.paid)} paid of ${money(billed)}`}
                    >
                      <div className="sem-bar-fill" style={{ height: `${fillPct}%` }}></div>
                    </div>
                    <span className="sem-bar-label" title={v.voucherNumber || ''}>
                      {v.voucherNumber ? v.voucherNumber.replace(/^VCH-/, '') : `#${v.feeVoucherId}`}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="sem-chart-legend">
              <span><i className="sem-dot paid"></i> Paid</span>
              <span><i className="sem-dot pending"></i> Outstanding</span>
            </div>
          </div>
        </div>

        {/* ── 2. Vouchers ─────────────────────────────────────────────────
            Every voucher, one row each, with its own balance. This single
            table replaces three separate renderings of the same rows: an
            "Upcoming Dues" list, a "Breakdown by Voucher" card of progress
            bars, and a voucher table buried under Payment History. */}
        <div className="table-card">
          <div className="table-card-header">
            <span className="card-title" style={{ margin: 0 }}>Your Vouchers</span>
            <div className="tab-pills">
              {tabOptions.map((t) => (
                <button
                  key={t}
                  className={`tab-pill ${activeTab === t ? 'active' : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="transaction-table">
            <div className="table-row cols-voucher table-head">
              <span>Voucher No.</span>
              <span>Due Date</span>
              <span className="num">Amount</span>
              <span className="num">Paid</span>
              <span className="num">Balance</span>
              <span>Status</span>
            </div>

            {visibleVouchers.length === 0 ? (
              <div className="table-row cols-voucher">
                <span className="cell-desc" style={{ gridColumn: '1 / -1' }}>
                  {vouchers.length === 0
                    ? 'No vouchers have been raised against your account yet.'
                    : `No ${activeTab} vouchers.`}
                </span>
              </div>
            ) : (
              visibleVouchers.map((v) => {
                const settlement = settlementOf(v);
                return (
                  <div className="table-row cols-voucher" key={v.key}>
                    <span className="cell-desc">
                      {v.voucherNumber || `#${v.feeVoucherId}`}
                    </span>
                    <span className="cell-date">
                      {formatDate(v.dueDate)}
                      {/* Urgency stays on the row it belongs to, instead of in
                          a banner repeating the same voucher at the bottom of
                          the page. */}
                      {settlement !== 'paid' && (
                        <span className={`due-tag ${priorityOf(v)}`}>{priorityLabel(v)}</span>
                      )}
                    </span>
                    <span className="cell-amount num">{money(v.amount)}</span>
                    <span className="cell-paid num">
                      {money(v.paid)}
                      {v.carriedIn > 0 && (
                        <span className="cell-note">
                          incl. {money(v.carriedIn)} carried forward
                        </span>
                      )}
                    </span>
                    <span className={`num ${v.due > 0 ? 'cell-due' : 'cell-muted'}`}>
                      {money(v.due)}
                      {v.pending > 0 && v.due > 0 && (
                        // Named under the balance rather than subtracted from
                        // it. Until the accounts office verifies it, every
                        // rupee of the balance is still owed.
                        <span className="cell-note cell-note-pending">
                          {money(v.pending)} declared, unverified
                        </span>
                      )}
                    </span>
                    <span className={`category-status ${settlement}`}>
                      {SETTLEMENT_LABEL[settlement]}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── 2b. Declare a payment ───────────────────────────────────────
            A declaration, not a transaction. The row lands Pending and the
            balance above does not move until the accounts office verifies it.

            This existed for parents and not for students, although the backend
            authorised both from the day the endpoint was written. A student
            could see their bill and had no way to say they had paid it. */}
        <div className="table-card">
          <div className="table-card-header">
            <span className="card-title" style={{ margin: 0 }}>Submit a payment</span>
            <span className="table-header-note">
              {payableVouchers.length
                ? `${payableVouchers.length} voucher${payableVouchers.length === 1 ? '' : 's'} outstanding`
                : awaitingVouchers.length
                  ? `${awaitingVouchers.length} awaiting verification`
                  : 'Nothing outstanding'}
            </span>
          </div>

          <div className="fee-submit-body">
            <DraftNotice draft={paymentDraft} online={online} />

            {submitted && <p className="fee-submit-ok">{submitted}</p>}

            {/* Vouchers whose whole balance is already declared. Never a
                button — the money is claimed, and claiming it twice is what
                the server refuses. */}
            {awaitingVouchers.length > 0 && (
              <div className="fee-submit-list">
                {awaitingVouchers.map((v) => (
                  <div className="fee-submit-row awaiting" key={`awaiting-${v.key}`}>
                    <div>
                      <p className="fee-submit-voucher">
                        {v.voucherNumber || `#${v.feeVoucherId}`} · awaiting verification
                      </p>
                      <p className="fee-submit-note warn">
                        {money(voucherPending(v))} declared and not yet confirmed by the
                        accounts office. Your balance stays at {money(v.due)} until it is.
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {payableVouchers.length === 0 ? (
              <p className="fee-submit-note">
                {awaitingVouchers.length
                  ? 'Everything outstanding has been declared and is waiting on the '
                    + 'accounts office. There is nothing further to submit.'
                  : 'Every voucher issued to you is settled. Nothing to pay.'}
              </p>
            ) : !form ? (
              <div className="fee-submit-list">
                <p className="fee-submit-note">
                  Already paid at the bank? Tell us, and the accounts office will
                  confirm it against their records.
                </p>
                {payableVouchers.map((v) => {
                  const claimable = voucherClaimable(v);
                  const claimed = voucherPending(v);
                  return (
                    <div className="fee-submit-row" key={`payable-${v.key}`}>
                      <div>
                        <p className="fee-submit-voucher">
                          {v.voucherNumber || `#${v.feeVoucherId}`}
                        </p>
                        <p className="fee-submit-note">
                          {money(claimable)} outstanding
                          {claimed > 0 ? ` · ${money(claimed)} already declared` : ''}
                          {v.dueDate ? ` · due ${formatDate(v.dueDate)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="fee-submit-btn"
                        onClick={() => openForm(v)}
                      >
                        Submit payment
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="fee-submit-form">
                <p className="fee-submit-note">
                  Paying <strong>{form.voucher_number}</strong> — {money(form.max)} outstanding.
                </p>

                <div className="fee-submit-fields">
                  <label className="fee-submit-field">
                    <span>Amount paid</span>
                    <input
                      type="number"
                      min="1"
                      max={form.max}
                      step="0.01"
                      value={form.amount_paid}
                      onChange={(e) => setForm({ ...form, amount_paid: e.target.value })}
                    />
                  </label>

                  <label className="fee-submit-field">
                    <span>Method</span>
                    <select
                      value={form.payment_method}
                      onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    >
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>

                  <label className="fee-submit-field">
                    <span>Date paid</span>
                    <input
                      type="date"
                      value={form.payment_date}
                      max={todayIso()}
                      onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                    />
                  </label>
                </div>

                {formError && <p className="fee-submit-error">{formError}</p>}

                {/* Said plainly rather than implied. A student who believes this
                    cleared the balance will not chase the office. */}
                <p className="fee-submit-note">
                  This tells the accounts office you have paid. It does not clear
                  the balance — they confirm it against their records first.
                </p>

                <div className="fee-submit-actions">
                  <button
                    type="button"
                    className="fee-submit-btn"
                    onClick={submitPayment}
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting…' : 'Submit for verification'}
                  </button>
                  <button
                    type="button"
                    className="fee-submit-btn ghost"
                    onClick={() => { paymentDraft.clear(); setForm(null); setFormError(null); }}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 3. Payment history ──────────────────────────────────────────
            Receipts only, no filter. The paid/pending pills that used to sit
            here never applied to these rows — a recorded payment is always a
            payment — and they only filtered the voucher table underneath. */}
        <div className="table-card">
          <div className="table-card-header">
            <span className="card-title" style={{ margin: 0 }}>Payment History</span>
            <span className="table-header-note">
              {transactions.length} payment{transactions.length === 1 ? '' : 's'}
              {fees.totalPending > 0
                ? ` · ${money(fees.totalPending)} awaiting verification`
                : ' recorded'}
            </span>
          </div>

          <div className="transaction-table">
            <div className="table-row cols-3 table-head">
              <span>Date</span>
              <span>Voucher No.</span>
              <span className="num">Amount</span>
            </div>
            {transactions.length === 0 ? (
              <div className="table-row cols-3">
                <span className="cell-desc" style={{ gridColumn: '1 / -1' }}>
                  No payments have been recorded against your account yet.
                </span>
              </div>
            ) : (
              transactions.map((t) => (
                <div className="table-row cols-3" key={t.id}>
                  <span className="cell-date">{formatDate(t.date)}</span>
                  <span className="cell-desc">
                    {t.voucherNumber || '—'}
                    {/* A declaration is not a receipt. Marked here because this
                        table is the one place the two sit side by side, and an
                        unconfirmed claim that reads as confirmed money is how a
                        student stops chasing a payment that never landed. */}
                    {t.status && t.status !== 'Verified' && (
                      <span className={`fee-pay-tag ${t.status.toLowerCase()}`}>
                        {t.status === 'Pending' ? 'Awaiting verification' : t.status}
                      </span>
                    )}
                  </span>
                  <span className="cell-amount num">{money(t.amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="dashboard-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${isMenuOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand" onClick={() => window.history.back()}>
          <span className="brand-icon"><IconCap2 /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2026</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* ── Main wrapper ── */}
      <div className="main-wrapper">
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Fee Management</span>
        </div>

        {/* ── Page content ── */}
        <div className="fee-page">
          <div className="fee-page-header">
            <div>
              <h1 className="fee-title">Fee Management</h1>
              {/* The academic year used to be printed as a fixed string. The
                  student's own programme and semester are what is known. */}
              <p className="fee-subtitle">
                {studentData?.profile?.program && studentData.profile.program !== '—'
                  ? `${studentData.profile.program} — ${studentData.profile.semester}`
                  : 'Your fee record'}
              </p>
            </div>
          </div>

          {renderBody()}
        </div>
      </div>
    </div>
  );
};

export default FeeManagement;
