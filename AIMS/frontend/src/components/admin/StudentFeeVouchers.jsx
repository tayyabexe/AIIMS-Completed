import { useMemo, useState } from 'react';
import {
  Receipt, Plus, X, Loader2, AlertCircle, CheckCircle, Ban, ChevronDown, ChevronRight,
  Pencil, Trash2, Save, AlertTriangle, History, Clock,
} from 'lucide-react';
import {
  feeVouchers as vouchersApi,
  feePayments as paymentsApi,
  semesters as semestersApi,
  feeStructures as structuresApi,
} from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { STALE } from '../../api/queryClient';
import useScrollLock from '../../hooks/useScrollLock';
import Modal from '../common/Modal';
import ApiErrorNotice from '../common/ApiErrorNotice';
import Pagination from '../common/Pagination';
import { formatMoney } from '../../utils/currency';

/** The small outlined action buttons on a voucher row. */
const rowBtn = (border, colour) => ({
  background: 'none', border: `1px solid ${border}`, borderRadius: '6px',
  color: colour, fontSize: '0.72rem', fontWeight: 700,
  padding: '2px 8px', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: '4px',
});

const dialogLabel = {
  fontSize: '0.75rem', fontWeight: 700, color: '#334155',
  display: 'block', marginBottom: '4px',
};

const dialogInput = {
  width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px',
  border: '1px solid #CBD5E1', fontSize: '0.875rem', outline: 'none',
  boxSizing: 'border-box', backgroundColor: '#FFFFFF', fontFamily: "'Inter', sans-serif",
};

const dialogGhostBtn = {
  padding: '0.6rem 1.2rem', borderRadius: '8px', border: '1px solid #CBD5E1',
  backgroundColor: '#FFFFFF', color: '#475569', fontWeight: 700,
  fontSize: '0.85rem', cursor: 'pointer',
};

const dialogPrimaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '0.6rem 1.3rem', borderRadius: '8px', border: 'none',
  backgroundColor: '#991b1b', color: '#FFFFFF', fontWeight: 700,
  fontSize: '0.85rem', cursor: 'pointer',
};

/*
 * One student's fee vouchers, semester by semester, with the history of every
 * instalment paid against each.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * Billing here runs per semester: a student enrolled for six semesters is
 * issued six challans. Nothing in the portal reflected that. `semester_id` on
 * fee_vouchers was NULL on every row, the admin's fee screen showed one
 * collapsed figure per student, and a student's profile showed a single "Fee
 * Status" word. So "has semester 4 been billed yet, and what did they pay
 * against it" — the ordinary question at an accounts counter — could not be
 * answered from any screen.
 *
 * The voucher rows come from GET /api/fee-vouchers/student/:id, which returns
 * the whole settled position in one call: every voucher with its semester, its
 * instalments, and the arithmetic after any overpayment has been carried
 * forward oldest-voucher-first. Grouping is done here because it is
 * presentation; the money is not recomputed.
 *
 * `settled_paid` / `settled_due` are used rather than the raw `amount_paid`,
 * so a voucher settled by an overpayment carried across from an earlier one
 * reads as paid instead of as outstanding.
 */

const STATUS_STYLE = {
  Paid: { bg: '#D1FAE5', fg: '#065F46' },
  Partial: { bg: '#FEF3C7', fg: '#92400E' },
  Unpaid: { bg: '#F1F5F9', fg: '#475569' },
  Overdue: { bg: '#FEE2E2', fg: '#991B1B' },
  Cancelled: { bg: '#F1F5F9', fg: '#94A3B8' },
};

const PAYMENT_STATUS_STYLE = {
  Verified: { bg: '#D1FAE5', fg: '#065F46' },
  Pending: { bg: '#FEF3C7', fg: '#92400E' },
  Rejected: { bg: '#FEE2E2', fg: '#991B1B' },
};

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const inputStyle = {
  width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px',
  border: '1px solid #CBD5E1', fontSize: '0.85rem', outline: 'none',
  boxSizing: 'border-box', fontFamily: "'Inter', sans-serif",
};

const Pill = ({ palette, children }) => (
  <span style={{
    backgroundColor: palette.bg, color: palette.fg, fontSize: '0.7rem', fontWeight: 800,
    padding: '0.2rem 0.6rem', borderRadius: '9999px', display: 'inline-block',
    whiteSpace: 'nowrap',
  }}>
    {children}
  </span>
);

export default function StudentFeeVouchers({
  studentId, studentName, programId, currentSemesterId, currentSemesterLabel,
}) {
  const { data, loading, error, refresh } = useAdminPage(
    () => vouchersApi.position(studentId),
    { studentId }, { key: 'voucher-position', enabled: !!studentId });

  // Only for the "issue a voucher" form's semester dropdown, so it is not
  // fetched until that form is opened.
  const [showIssue, setShowIssue] = useState(false);

  const { data: semesterData } = useAdminPage(
    () => semestersApi.list(programId ? { program_id: programId } : {}),
    { programId: programId ?? null }, { key: 'semesters', staleTime: STALE.reference, enabled: showIssue });

  /*
   * The API serialises these camel-cased — `semesterId`, `number`, `label` —
   * not as the raw column names. Reading `semester_id`/`semester_number` gave
   * every option the key `undefined` (React duly warned about the duplicate
   * keys) and printed a bare "Semester" with no number after it, so the two
   * options in the list were indistinguishable. Both shapes are accepted here
   * so the dropdown survives whichever one the endpoint returns.
   */
  const semesterOptions = (semesterData?.data ?? semesterData?.rows ?? []).map((s) => ({
    id: s.semesterId ?? s.semester_id ?? s.id,
    number: s.number ?? s.semester_number,
    label: s.label ?? `Semester ${s.number ?? s.semester_number ?? ''}`.trim(),
  }));

  // Freeze the voucher list behind the issue form.
  useScrollLock(showIssue);

  const vouchers = useMemo(() => data?.vouchers ?? [], [data]);
  const totals = data?.totals ?? {};

  /*
   * Grouped by semester, newest semester first, with the vouchers that carry no
   * semester collected at the end.
   *
   * Those unassigned rows are not a bug to hide: every voucher that predates
   * this screen has semester_id NULL, because nothing ever set it. Showing them
   * under "Unassigned" says so plainly, instead of silently filing them under
   * whichever semester happened to sort first.
   */
  const groups = useMemo(() => {
    const bySemester = new Map();

    for (const v of vouchers) {
      const key = v.semester?.semester_id ?? 'unassigned';
      if (!bySemester.has(key)) {
        bySemester.set(key, {
          key,
          number: v.semester?.semester_number ?? null,
          label: v.semester?.label ?? 'Unassigned semester',
          rows: [],
        });
      }
      bySemester.get(key).rows.push(v);
    }

    return [...bySemester.values()]
      .map((g) => ({
        ...g,
        billed: g.rows.reduce((t, v) => t + Number(v.total_payable || 0), 0),
        paid: g.rows.reduce((t, v) => t + Number(v.settled_paid || 0), 0),
        due: g.rows.reduce((t, v) => t + Number(v.settled_due || 0), 0),
        pending: g.rows.reduce((t, v) => t + Number(v.pending_amount || 0), 0),
      }))
      .sort((a, b) => {
        // Unassigned last, then by semester number descending.
        if (a.number === null) return 1;
        if (b.number === null) return -1;
        return b.number - a.number;
      });
  }, [vouchers]);

  /*
   * Which semester groups are expanded.
   *
   * Held as overrides against a default rather than as the open set itself, so
   * "the newest semester is open" works on the very first render — before any
   * voucher has arrived and there is nothing to seed a set from.
   */
  const [openOverrides, setOpenOverrides] = useState({});
  const isOpen = (key, index) => openOverrides[key] ?? index === 0;

  const toggle = (key, index) => {
    setOpenOverrides((current) => ({ ...current, [key]: !(current[key] ?? index === 0) }));
  };

  // ── Issue a voucher ──────────────────────────────────────────────────────
  const [form, setForm] = useState({ semester_id: '', total_payable: '', due_date: '' });
  const [issuing, setIssuing] = useState(false);
  const [formError, setFormError] = useState('');
  const [banner, setBanner] = useState(null);

  /*
   * The fee structure that will be billed, shown rather than described.
   *
   * The dialog used to carry a paragraph explaining that a blank amount falls
   * back to the programme's fee structure — which left the admin to take that
   * on trust and only learn the figure after the voucher existed. The lines
   * themselves are loaded instead and totalled on screen, so the amount about
   * to be billed is visible before the button is pressed.
   */
  const { data: structureData } = useAdminPage(
    () => structuresApi.list(),
    {}, { key: 'fee-structures', staleTime: STALE.reference, enabled: showIssue });

  // The semester the voucher will land on: whichever is picked, else the
  // student's current one — the same order of precedence the server applies.
  const targetSemesterId = form.semester_id
    ? Number(form.semester_id)
    : (currentSemesterId ?? null);

  const billingLines = useMemo(() => {
    const rows = structureData?.data ?? structureData?.rows ?? [];
    return rows
      .filter((r) => Number(r.programId ?? r.program_id) === Number(programId))
      .filter((r) => targetSemesterId == null
        || Number(r.semesterId ?? r.semester_id) === Number(targetSemesterId))
      .map((r) => ({
        id: r.feeStructureId ?? r.fee_structure_id ?? r.id,
        category: r.category ?? r.fee_category,
        amount: Number(r.amount || 0),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [structureData, programId, targetSemesterId]);

  const structureTotal = billingLines.reduce((sum, l) => sum + l.amount, 0);

  const targetSemesterLabel = form.semester_id
    ? (semesterOptions.find((s) => Number(s.id) === Number(form.semester_id))?.label ?? 'this semester')
    : (currentSemesterLabel || 'the current semester');

  const flash = (tone, text) => {
    setBanner({ tone, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const issue = async (e) => {
    e.preventDefault();
    setFormError('');
    setIssuing(true);

    try {
      const result = await vouchersApi.create({
        student_id: Number(studentId),
        // Left out entirely rather than sent empty: the server falls back to
        // the student's current semester and to the fee structure on record,
        // and an empty string would fail validation instead of falling back.
        semester_id: form.semester_id ? Number(form.semester_id) : undefined,
        total_payable: form.total_payable !== '' ? Number(form.total_payable) : undefined,
        due_date: form.due_date || undefined,
      });

      setShowIssue(false);
      // Cleared only once the server has issued it. The catch below leaves the
      // dialog open and populated on failure — the usual failure here is "this
      // semester already has a live voucher", which the admin fixes by
      // changing the semester in the same form.
      setForm({ semester_id: '', total_payable: '', due_date: '' });
      flash('success', result.message || 'Voucher issued.');
      refresh();

    } catch (err) {
      // Left open, with the message: a rejection here is almost always "this
      // semester already has a live voucher", which the admin needs to read.
      setFormError(err.message);
    } finally {
      setIssuing(false);
    }
  };

  const cancelVoucher = async (voucher) => {
    try {
      await vouchersApi.update(voucher.fee_voucher_id, { status: 'Cancelled' });
      flash('success', `${voucher.voucher_number} cancelled.`);
      refresh();
    } catch (err) {
      flash('error', `Could not cancel ${voucher.voucher_number}: ${err.message}`);
    }
  };

  /* ── Amending and deleting a voucher ──────────────────────────────────────
     Issuing and cancelling were the only two things this screen could do, so a
     challan raised with the wrong amount or the wrong due date could only be
     cancelled and replaced — which leaves two rows in the student's history for
     one bill.

     The server refuses the amendments that would make the arithmetic untrue: a
     bill cannot be lowered below money already verified, a due date cannot
     precede its issue date, and a voucher cannot be moved to a semester the
     student already holds a live voucher for.
     ────────────────────────────────────────────────────────────────────────── */

  const [editingVoucher, setEditingVoucher] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [deletingVoucher, setDeletingVoucher] = useState(null);
  const [dialogError, setDialogError] = useState(null);

  const openEdit = (v) => {
    setEditForm({
      total_payable: v.total_payable ?? '',
      issue_date: String(v.issue_date || '').slice(0, 10),
      due_date: String(v.due_date || '').slice(0, 10),
      semester_id: v.semester?.semester_id ?? '',
    });
    setDialogError(null);
    setEditingVoucher(v);
  };

  const saveVoucher = async (e) => {
    e?.preventDefault();
    setDialogError(null);
    setIssuing(true);
    try {
      await vouchersApi.update(editingVoucher.fee_voucher_id, {
        total_payable: editForm.total_payable !== '' ? Number(editForm.total_payable) : undefined,
        issue_date: editForm.issue_date || undefined,
        due_date: editForm.due_date || undefined,
        semester_id: editForm.semester_id !== '' ? Number(editForm.semester_id) : undefined,
      });
      setEditingVoucher(null);
      flash('success', `${editingVoucher.voucher_number} updated.`);
      refresh();
    } catch (err) {
      setDialogError(err);
    } finally {
      setIssuing(false);
    }
  };

  const deleteVoucher = async () => {
    setDialogError(null);
    try {
      await vouchersApi.remove(deletingVoucher.fee_voucher_id);
      const number = deletingVoucher.voucher_number;
      setDeletingVoucher(null);
      flash('success', `${number} deleted.`);
      refresh();
    } catch (err) {
      /*
       * The expected answer whenever anything has been paid: the FK is ON
       * DELETE CASCADE, so deleting the voucher would destroy those payment
       * rows, and the server refuses and says how many and how much. Kept in
       * the dialog so the "cancel instead" alternative is one click away.
       */
      setDialogError(err);
    }
  };

  return (
    <div style={{
      backgroundColor: 'white', borderRadius: '16px', border: '1px solid #E2E8F0',
      padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      display: 'flex', flexDirection: 'column', gap: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h4 style={{
            fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', margin: 0,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <Receipt size={18} color="#DC2626" /> Fee Vouchers by Semester
          </h4>
          <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '3px 0 0' }}>
            Every challan raised for {studentName || 'this student'}, and what has been paid against it
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setShowIssue(true); setFormError(''); }}
          style={{
            backgroundColor: '#991b1b', color: 'white', fontWeight: 700, border: 'none',
            borderRadius: '8px', padding: '0.5rem 1rem', fontSize: '0.82rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          <Plus size={15} /> Issue Voucher
        </button>
      </div>

      {banner && (
        <div style={{
          padding: '0.6rem 0.9rem', borderRadius: '8px', fontSize: '0.82rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          backgroundColor: banner.tone === 'success' ? '#ECFDF5' : '#FEF2F2',
          border: `1px solid ${banner.tone === 'success' ? '#A7F3D0' : '#FECACA'}`,
          color: banner.tone === 'success' ? '#065F46' : '#991B1B',
        }}>
          {banner.tone === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {banner.text}
        </div>
      )}

      {/* Position totals. `advance` and `pending` are shown only when they are
          non-zero, because a nil advance is not information. */}
      {!loading && !error && (
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          {[
            ['Billed', totals.billed, '#0F172A'],
            ['Paid', totals.paid, '#059669'],
            ['Outstanding', totals.due, (totals.due ?? 0) > 0 ? '#DC2626' : '#64748B'],
            ...((totals.advance ?? 0) > 0 ? [['Advance', totals.advance, '#059669']] : []),
            ...((totals.pending ?? 0) > 0 ? [['Awaiting verification', totals.pending, '#D97706']] : []),
          ].map(([label, value, colour]) => (
            // Sized to the figure, not stretched across the card: three
            // "Rs. 0" tiles spread over 1,100px read as a dashboard of
            // nothing. min-width keeps them from collapsing to the label.
            <div key={label} style={{
              flex: '0 1 auto', minWidth: '130px',
              backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
              borderRadius: '10px', padding: '0.6rem 0.85rem',
            }}>
              <span style={{
                fontSize: '0.66rem', fontWeight: 800, color: '#94A3B8',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {label}
              </span>
              <p style={{ fontSize: '1.05rem', fontWeight: 900, color: colour, margin: '2px 0 0' }}>
                {formatMoney(value ?? 0)}
              </p>
            </div>
          ))}
        </div>
      )}

      {loading && !data && (
        <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0, padding: '1rem 0' }}>
          Loading fee history…
        </p>
      )}

      {error && (
        <div style={{
          padding: '0.7rem 0.9rem', borderRadius: '8px', backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.82rem',
        }}>
          Could not load the fee history: {error}
          <button
            onClick={refresh}
            style={{
              marginLeft: 8, border: '1px solid #FECACA', background: 'white',
              borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
              color: '#991B1B', fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0, padding: '1.5rem 0', textAlign: 'center' }}>
          No fee voucher has been raised for this student yet.
        </p>
      )}

      {/* ── The history, one block per semester ───────────────────────────── */}
      {groups.map((group, index) => {
        const open = isOpen(group.key, index);

        return (
          <div key={group.key} style={{ border: '1px solid #E2E8F0', borderRadius: '12px', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => toggle(group.key, index)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '1rem', padding: '0.75rem 1rem', backgroundColor: '#F8FAFC',
                border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: '#0F172A', fontSize: '0.9rem' }}>
                {open ? <ChevronDown size={16} color="#64748B" /> : <ChevronRight size={16} color="#64748B" />}
                {group.label}
                <span style={{ fontWeight: 600, color: '#94A3B8', fontSize: '0.75rem' }}>
                  · {group.rows.length} voucher{group.rows.length === 1 ? '' : 's'}
                </span>
              </span>

              <span style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.78rem', flexWrap: 'wrap' }}>
                <span style={{ color: '#64748B' }}>
                  Billed <strong style={{ color: '#0F172A' }}>{formatMoney(group.billed)}</strong>
                </span>
                <span style={{ color: '#64748B' }}>
                  Paid <strong style={{ color: '#059669' }}>{formatMoney(group.paid)}</strong>
                </span>
                <span style={{ color: '#64748B' }}>
                  Due <strong style={{ color: group.due > 0 ? '#DC2626' : '#64748B' }}>{formatMoney(group.due)}</strong>
                </span>
                {group.pending > 0 && (
                  <Pill palette={PAYMENT_STATUS_STYLE.Pending}>
                    {formatMoney(group.pending)} awaiting verification
                  </Pill>
                )}
              </span>
            </button>

            {open && (
              <div style={{ padding: '0.5rem 1rem 1rem' }}>
                {group.rows.map((v) => (
                  <div key={v.fee_voucher_id} style={{ paddingTop: '0.85rem' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '0.85rem', flexWrap: 'wrap', paddingBottom: '0.5rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>{v.voucher_number}</strong>
                        <Pill palette={STATUS_STYLE[v.status] || STATUS_STYLE.Unpaid}>{v.status}</Pill>
                        <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                          Issued {formatDate(v.issue_date)} · Due {formatDate(v.due_date)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.8rem' }}>
                        <span style={{ color: '#0F172A', fontWeight: 700 }}>{formatMoney(v.total_payable)}</span>
                        <span style={{ color: '#059669', fontWeight: 700 }}>{formatMoney(v.settled_paid)} paid</span>
                        {Number(v.carried_in) > 0 && (
                          <span style={{ color: '#94A3B8', fontSize: '0.72rem' }}>
                            incl. {formatMoney(v.carried_in)} carried forward
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(v)}
                          title="Amend the amount, the dates or the semester"
                          style={rowBtn('#CBD5E1', '#475569')}
                        >
                          <Pencil size={12} /> Edit
                        </button>

                        {v.status !== 'Cancelled' && v.status !== 'Paid' && (
                          <button
                            type="button"
                            onClick={() => cancelVoucher(v)}
                            title="Cancel this voucher — it stops counting towards the balance and frees the semester for a replacement"
                            style={rowBtn('#FECACA', '#991B1B')}
                          >
                            <Ban size={12} /> Cancel
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => { setDialogError(null); setDeletingVoucher(v); }}
                          // Deliberately offered even when payments exist: the
                          // server's refusal is the informative outcome, and it
                          // names how much money is attached.
                          title={(v.payments || []).length
                            ? 'Payments are recorded against this voucher — the server will refuse and point at Cancel'
                            : 'Delete this voucher'}
                          style={rowBtn('#FECACA', '#DC2626')}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>

                    {/* Instalments. A rejected row is kept and shown: a refused
                        claim is part of the trail, and hiding it would leave the
                        parent's "I submitted that" unanswerable. */}
                    {(v.payments || []).length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ color: '#94A3B8', textAlign: 'left', fontWeight: 700 }}>
                            <th style={{ padding: '0.3rem 0.5rem', fontWeight: 700 }}>Receipt</th>
                            <th style={{ padding: '0.3rem 0.5rem', fontWeight: 700 }}>Date</th>
                            <th style={{ padding: '0.3rem 0.5rem', fontWeight: 700 }}>Method</th>
                            <th style={{ padding: '0.3rem 0.5rem', fontWeight: 700, textAlign: 'right' }}>Amount</th>
                            <th style={{ padding: '0.3rem 0.5rem', fontWeight: 700 }}>State</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.payments.map((p) => (
                            <tr key={p.fee_payment_id} style={{ borderTop: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '0.35rem 0.5rem', color: '#475569' }}>
                                {p.receipt_number || '—'}
                              </td>
                              <td style={{ padding: '0.35rem 0.5rem', color: '#64748B' }}>
                                {formatDate(p.payment_date)}
                              </td>
                              <td style={{ padding: '0.35rem 0.5rem', color: '#64748B' }}>
                                {p.payment_method}
                              </td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                                {formatMoney(p.amount_paid)}
                              </td>
                              <td style={{ padding: '0.35rem 0.5rem' }}>
                                <Pill palette={PAYMENT_STATUS_STYLE[p.status] || PAYMENT_STATUS_STYLE.Pending}>
                                  {p.status}
                                </Pill>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ fontSize: '0.76rem', color: '#94A3B8', margin: '0 0 0 0.5rem' }}>
                        Nothing paid against this voucher yet.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Issue voucher ─────────────────────────────────────────────────── */}
      {showIssue && (
        <div
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.6)',
            backdropFilter: 'blur(4px)', zIndex: 130, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
          onClick={() => { if (!issuing) setShowIssue(false); }}
        >
          <form
            onSubmit={issue}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white', borderRadius: '18px', width: '100%',
              maxWidth: '460px', border: '1px solid #E2E8F0', overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '1.15rem 1.5rem', borderBottom: '1px solid #E2E8F0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                Issue Fee Voucher
              </h3>
              <button type="button" onClick={() => setShowIssue(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {formError && (
                <div style={{ padding: '0.6rem 0.85rem', borderRadius: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.8rem' }}>
                  {formError}
                </div>
              )}

              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                Semester
                <select
                  value={form.semester_id}
                  onChange={(e) => setForm({ ...form, semester_id: e.target.value })}
                  style={{ ...inputStyle, marginTop: '4px' }}
                >
                  <option value="">
                    {currentSemesterLabel ? `${currentSemesterLabel} (current)` : 'Current semester'}
                  </option>
                  {semesterOptions
                    .filter((s) => Number(s.id) !== Number(currentSemesterId))
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                </select>
              </label>

              {/* The fee structure on record for that semester, itemised. This
                  is the figure the voucher carries when the amount is left
                  alone, so it is put on screen rather than described. */}
              <div style={{
                border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  padding: '0.5rem 0.8rem', backgroundColor: '#F8FAFC',
                  borderBottom: '1px solid #E2E8F0',
                }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Fee structure · {targetSemesterLabel}
                  </span>
                </div>

                {billingLines.length === 0 ? (
                  <p style={{ margin: 0, padding: '0.7rem 0.8rem', fontSize: '0.78rem', color: '#94A3B8' }}>
                    No fee structure on record for this semester — enter an amount below.
                  </p>
                ) : (
                  <div style={{ padding: '0.5rem 0.8rem' }}>
                    {billingLines.map((line) => (
                      <div key={line.id} style={{
                        display: 'flex', justifyContent: 'space-between', gap: '1rem',
                        fontSize: '0.8rem', padding: '0.2rem 0', color: '#475569',
                      }}>
                        <span>{line.category}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(line.amount)}</span>
                      </div>
                    ))}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', gap: '1rem',
                      marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px solid #E2E8F0',
                      fontSize: '0.9rem', fontWeight: 800, color: '#0F172A',
                    }}>
                      <span>Will be billed</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(form.total_payable !== '' ? Number(form.total_payable) : structureTotal)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                Amount payable
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={structureTotal > 0 ? String(structureTotal) : ''}
                  value={form.total_payable}
                  onChange={(e) => setForm({ ...form, total_payable: e.target.value })}
                  style={{ ...inputStyle, marginTop: '4px' }}
                />
              </label>

              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                Due date
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  style={{ ...inputStyle, marginTop: '4px' }}
                />
              </label>
            </div>

            <div style={{
              padding: '1rem 1.5rem', borderTop: '1px solid #E2E8F0',
              display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', backgroundColor: '#F8FAFC',
            }}>
              <button
                type="button"
                onClick={() => setShowIssue(false)}
                style={{ padding: '0.55rem 1.1rem', borderRadius: '8px', border: '1px solid #CBD5E1', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={issuing}
                style={{
                  padding: '0.55rem 1.1rem', borderRadius: '8px', border: 'none',
                  backgroundColor: issuing ? '#CBD5E1' : '#991b1b', color: 'white',
                  fontWeight: 700, cursor: issuing ? 'not-allowed' : 'pointer', fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {issuing && <Loader2 size={14} className="fee-voucher-spin" />}
                {issuing ? 'Issuing…' : 'Issue Voucher'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Amend a voucher ──────────────────────────────────────────────── */}
      <Modal
        open={!!editingVoucher}
        title={`Amend ${editingVoucher?.voucher_number || ''}`}
        icon={Pencil}
        onClose={() => setEditingVoucher(null)}
      >
        <form onSubmit={saveVoucher} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ApiErrorNotice error={dialogError} />

          <div>
            <label style={dialogLabel}>Amount billed</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              style={dialogInput}
              value={editForm.total_payable}
              onChange={(e) => setEditForm({ ...editForm, total_payable: e.target.value })}
            />
            <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '4px 0 0' }}>
              {/* Stated up front because it is the amendment most often
                  attempted on the wrong voucher. */}
              Cannot be set below the {formatMoney(editingVoucher?.settled_paid ?? 0)} already
              verified against this voucher.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={dialogLabel}>Issue date</label>
              <input
                type="date"
                style={dialogInput}
                value={editForm.issue_date}
                onChange={(e) => setEditForm({ ...editForm, issue_date: e.target.value })}
              />
            </div>
            <div>
              <label style={dialogLabel}>Due date</label>
              <input
                type="date"
                style={dialogInput}
                value={editForm.due_date}
                onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label style={dialogLabel}>Semester</label>
            <select
              style={dialogInput}
              value={editForm.semester_id}
              onChange={(e) => setEditForm({ ...editForm, semester_id: e.target.value })}
            >
              <option value="">Leave as it is</option>
              {semesterOptions.map((s) => (
                <option key={s.semester_id ?? s.id} value={s.semester_id ?? s.id}>
                  {s.label || `Semester ${s.semester_number ?? s.number}`}
                  {s.program || s.program_name ? ` — ${s.program || s.program_name}` : ''}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '4px 0 0' }}>
              Moving it is refused if the student already holds a live voucher for
              that semester — two challans for one term doubles their balance.
            </p>
          </div>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setEditingVoucher(null)} style={dialogGhostBtn}>Cancel</button>
          <button
            type="button"
            onClick={saveVoucher}
            disabled={issuing}
            style={{ ...dialogPrimaryBtn, opacity: issuing ? 0.7 : 1 }}
          >
            <Save size={15} /> {issuing ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Modal>

      {/* ── Delete a voucher ─────────────────────────────────────────────── */}
      <Modal
        open={!!deletingVoucher}
        title={`Delete ${deletingVoucher?.voucher_number || ''}?`}
        icon={AlertTriangle}
        onClose={() => setDeletingVoucher(null)}
        width="480px"
      >
        <ApiErrorNotice error={dialogError} />

        <p style={{ fontSize: '0.88rem', color: '#475569', margin: dialogError ? '0.85rem 0 0' : 0, lineHeight: 1.55 }}>
          A voucher is deleted outright — there is no soft-delete column on this
          table.
        </p>

        {(deletingVoucher?.payments || []).length > 0 ? (
          <div style={{
            marginTop: '0.85rem', padding: '0.7rem 0.9rem', borderRadius: '8px',
            backgroundColor: '#FFFBEB', border: '1px solid #FDE68A',
            color: '#92400E', fontSize: '0.8rem', lineHeight: 1.5,
          }}>
            This will be <strong>refused</strong>.{' '}
            {deletingVoucher.payments.length === 1 ? '1 payment is' : `${deletingVoucher.payments.length} payments are`}{' '}
            recorded against it, and the database would delete them along with the
            voucher. Cancel it instead — that withdraws the challan and keeps every
            receipt intact.
          </div>
        ) : (
          <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: '0.6rem 0 0' }}>
            Nothing has been paid against it, so there is no payment record to lose.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setDeletingVoucher(null)} style={dialogGhostBtn}>Cancel</button>

          {(deletingVoucher?.payments || []).length > 0
            && deletingVoucher?.status !== 'Cancelled' && (
            <button
              type="button"
              onClick={() => { const v = deletingVoucher; setDeletingVoucher(null); cancelVoucher(v); }}
              style={{ ...dialogPrimaryBtn, backgroundColor: '#D97706' }}
            >
              <Ban size={15} /> Cancel the voucher instead
            </button>
          )}

          <button
            type="button"
            onClick={deleteVoucher}
            style={{ ...dialogPrimaryBtn, backgroundColor: '#DC2626' }}
          >
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </Modal>

      <PaymentHistory studentId={studentId} />

      {/* Named locally so it cannot collide with the `spin` keyframes several
          other screens declare inline. */}
      <style>{`
        .fee-voucher-spin { animation: fee-voucher-spin 1s linear infinite; }
        @keyframes fee-voucher-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/*
 * The payment ledger for this student: GET /api/fee-payments/history.
 *
 * WHY IT IS NOT THE INSTALMENT TABLES ABOVE
 * -----------------------------------------
 * Those are grouped by voucher and ordered by the voucher's semester — the right
 * shape for "what does this bill still owe". This is a ledger: every instalment
 * across every voucher on ONE timeline, the one that matters for money, which is
 * when the accounts office approved it. The row above a payment here is the one
 * approved before it.
 *
 * Pending rows are kept at the top by the server rather than sorted into the
 * date order, because an undecided claim is the thing on this screen someone has
 * to act on, and burying it under two years of settled instalments is how it
 * stopped being acted on.
 *
 * THE APPROXIMATE TIMESTAMPS
 * --------------------------
 * 1,909 rows in this database had their approval date backfilled from
 * `updated_at` by migration 20260812160000, because `verified_at` did not exist
 * when they were approved. The API flags each of those with
 * `approvedAtIsApproximate`, and they are drawn as estimates — italic, with a
 * tilde and a stated reason — rather than as facts. A backfilled timestamp is
 * evidence of an edit and only probably of the approval, and presenting it as
 * exact would make it look like something this system watched happen.
 */
function PaymentHistory({ studentId }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data, loading, error } = useAdminPage(
    (p) => paymentsApi.history(p),
    { student_id: studentId, page, limit: 15, status: status || undefined }, { key: 'payment-history', enabled: !!studentId });

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {};
  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 15 };

  const approximateCount = rows.filter((r) => r.approvedAtIsApproximate).length;

  const when = (value) => (value ? new Date(value).toLocaleString() : null);

  return (
    <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h4 style={{
            fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: 0,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <History size={17} color="#2563EB" /> Payment history
          </h4>
          <p style={{ fontSize: '0.76rem', color: '#94A3B8', margin: '3px 0 0' }}>
            Every instalment, ordered by the date the accounts office approved it
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            ['Verified', totals.verified, '#059669'],
            ['Awaiting', totals.pending, '#D97706'],
            ['Rejected', totals.rejected, '#DC2626'],
          ].map(([t, v, colour]) => (
            <span key={t} style={{ fontSize: '0.76rem', color: '#64748B' }}>
              {t} <strong style={{ color: colour }}>{formatMoney(v ?? 0)}</strong>
            </span>
          ))}

          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            style={{ ...dialogInput, width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="">All states</option>
            <option value="Pending">Awaiting verification</option>
            <option value="Verified">Verified</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
      </div>

      <ApiErrorNotice error={error} />

      {approximateCount > 0 && (
        <div style={{
          marginTop: '0.85rem', padding: '0.6rem 0.85rem', borderRadius: '8px',
          backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
          color: '#475569', fontSize: '0.76rem', lineHeight: 1.5,
          display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
        }}>
          <Clock size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>
            {approximateCount} of the {rows.length} rows below show an{' '}
            <em>estimated</em> approval date, marked “~”. Those were approved
            before this system recorded an approval time, so the date shown was
            recovered from when the row was last edited — close, but not the
            moment it was actually approved. No approver is named for them, and
            none has been invented.
          </span>
        </div>
      )}

      <div style={{ overflowX: 'auto', marginTop: '0.85rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ color: '#94A3B8', textAlign: 'left' }}>
              {['Receipt', 'Voucher', 'Amount', 'Method', 'Paid on (claimed)', 'Approved', 'Approved by', 'State'].map((h) => (
                <th key={h} style={{ padding: '0.35rem 0.5rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', color: '#94A3B8' }}>
                  {loading ? 'Loading…' : 'No payments recorded for this student.'}
                </td>
              </tr>
            ) : rows.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                <td style={{ padding: '0.4rem 0.5rem', color: '#475569', fontFamily: 'ui-monospace, monospace' }}>
                  {p.receiptNumber || '—'}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', color: '#475569' }}>
                  {p.voucher?.number}
                  {p.voucher?.semester && (
                    <span style={{ color: '#94A3B8' }}> · {p.voucher.semester}</span>
                  )}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                  {formatMoney(p.amount)}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', color: '#64748B' }}>{p.method}</td>
                <td style={{ padding: '0.4rem 0.5rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                  {p.claimedPaidOn ? String(p.claimedPaidOn).slice(0, 10) : '—'}
                </td>

                {/* The approval moment — the column this whole view is sorted
                    on, and the one that has to distinguish measured from
                    estimated. */}
                <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>
                  {p.approvedAt ? (
                    p.approvedAtIsApproximate ? (
                      <span
                        title="Estimated: recovered from when the row was last edited, because no approval time was recorded at the time."
                        style={{ color: '#92400E', fontStyle: 'italic' }}
                      >
                        ~ {when(p.approvedAt)}
                      </span>
                    ) : (
                      <span style={{ color: '#0F172A' }}>{when(p.approvedAt)}</span>
                    )
                  ) : (
                    <span style={{ color: '#D97706', fontWeight: 700 }}>not yet decided</span>
                  )}
                </td>

                <td style={{ padding: '0.4rem 0.5rem', color: '#64748B' }}>
                  {p.approvedBy?.email
                    ?? (p.approvedAtIsApproximate
                      /* Deliberately not filled in. The migration dated these
                         rows; it could not know who approved them. */
                      ? <span style={{ color: '#CBD5E1' }} title="Not recorded at the time">not recorded</span>
                      : <span style={{ color: '#CBD5E1' }}>—</span>)}
                </td>

                <td style={{ padding: '0.4rem 0.5rem' }}>
                  <Pill palette={PAYMENT_STATUS_STYLE[p.status] || PAYMENT_STATUS_STYLE.Pending}>
                    {p.status}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.total > pagination.limit && (
        <div style={{ marginTop: '0.85rem' }}>
          <Pagination
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            limit={pagination.limit}
            count={rows.length}
            onChange={setPage}
            noun="payment"
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
