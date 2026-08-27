import { useMemo, useState } from 'react';
import { Receipt, Plus, Pencil, Trash2, Save, AlertTriangle } from 'lucide-react';
import {
  feeStructures as feeStructuresApi,
  academics as academicsApi,
} from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { STALE } from '../../api/queryClient';
import useDraft, { useOnlineStatus } from '../../hooks/useDraft';
import Modal from '../common/Modal';
import DraftNotice from '../common/DraftNotice';
import ApiErrorNotice from '../common/ApiErrorNotice';

/*
 * The fee catalogue: what one semester of one programme costs, split by
 * category.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * `fee_structures` has had a full REST surface since the beginning — list, get,
 * create, update, delete, all guarded by authorize(...ADMINS) — and not one
 * line of the front end ever called it. Grep for `feeStructures` across
 * src/ before this file and the only hit was its own definition in
 * endpoints.js. So the catalogue could be read by the billing code and never
 * written by anyone.
 *
 * That mattered because of how a voucher gets its amount. feeService takes, in
 * order: the amount typed on the voucher, then the SUM of the fee_structures
 * rows for that programme and semester, then nothing. With an empty catalogue
 * every voucher had to have its amount typed by hand, one student at a time,
 * with no stated figure to check it against — which is exactly the thing a fee
 * structure is for.
 *
 * WHY A SUM AND NOT ONE ROW
 * -------------------------
 * A semester's fee is spread across several categories (Tuition, Examination,
 * Laboratory, Library). The voucher bills their total. The `fee_structure_id`
 * stored on a voucher can only point at one of them, so it holds the largest —
 * which is why this screen shows the per-programme total beside the rows: the
 * total is the number that actually reaches a student, and it appears nowhere
 * else in the portal.
 */

const ACCENT = '#991b1b';

const card = {
  backgroundColor: '#FFFFFF', borderRadius: '14px', border: '1px solid #E2E8F0',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const label = {
  fontSize: '0.75rem', fontWeight: 700, color: '#334155',
  display: 'block', marginBottom: '4px',
};

const input = {
  width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px',
  border: '1px solid #CBD5E1', fontSize: '0.875rem', outline: 'none',
  boxSizing: 'border-box', backgroundColor: '#FFFFFF', fontFamily: "'Inter', sans-serif",
};

const th = {
  textAlign: 'left', fontSize: '0.7rem', fontWeight: 800, color: '#64748B',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  padding: '0.6rem 0.85rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
};

const td = {
  fontSize: '0.85rem', color: '#0F172A', padding: '0.7rem 0.85rem',
  borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle',
};

const btn = (variant = 'ghost') => ({
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  padding: variant === 'primary' ? '0.6rem 1.1rem' : '0.35rem 0.65rem',
  borderRadius: '8px', cursor: 'pointer',
  fontSize: variant === 'primary' ? '0.85rem' : '0.78rem', fontWeight: 700,
  ...(variant === 'primary'
    ? { border: 'none', backgroundColor: ACCENT, color: '#FFFFFF' }
    : { border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', color: '#0F172A' }),
});

/*
 * The categories a fee is split into.
 *
 * Offered as a list rather than a free-text box because the voucher total is a
 * SUM over these rows: "Tuition" and "tuition" would both be stored, both be
 * summed, and bill the student twice for the same thing. Free text is still
 * accepted by the API — this is the UI declining to be the source of that.
 */
const FEE_CATEGORIES = ['Tuition', 'Examination', 'Laboratory', 'Library', 'Admission', 'Security Deposit', 'Transport'];

const EMPTY = {
  program_id: '', semester_id: '', fee_category: 'Tuition', amount: '',
};

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-PK')}`;

export default function FeeStructuresView() {
  const [editing, setEditing] = useState(null);   // null | { row } | { row: null }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const online = useOnlineStatus();

  /*
   * An abandoned fee line survives a refresh.
   *
   * Four fields is not an hour of typing, but it is a decision — which
   * programme, which semester, which category, how much — and the amount is
   * usually copied off a sheet of paper or another screen. Losing it means
   * going back to that source, which is the annoying part, not the retyping.
   *
   * The key separates a new line from an edit of an existing one, and carries
   * the row id on the edit, so a draft meant for structure 12 can never load
   * onto structure 13. Same shape as the announcements form, which is the
   * existing precedent for drafting an edit in this codebase.
   */
  const draftKey = editing?.row
    ? `admin.fee-structure.${editing.row.id}`
    : 'admin.fee-structure.new';

  const draft = useDraft(draftKey, form, {
    enabled: !!editing,
    onRestore: setForm,
    /*
     * fee_category defaults to "Tuition", so an untouched form is NOT an empty
     * object. Emptiness is judged on the fields a person actually fills, or
     * every opened-and-closed dialog would leave a draft behind.
     */
    isEmpty: (value) => !value?.amount
      && !value?.program_id
      && !value?.semester_id,
  });

  const structures = useAdminPage(() => feeStructuresApi.list(), [], { key: 'fee-structures' });
  // Programmes and semesters come from the structure overview, the same
  // snapshot the Academic Structure screen reads, so this form can only offer a
  // programme that actually exists.
  const tree = useAdminPage(() => academicsApi.overview(), {}, { key: 'academics-overview', staleTime: STALE.reference });

  /*
   * useAdminPage stores the whole response body, and these two endpoints wrap
   * differently: /api/fee-structures returns its rows under `data`, while
   * /api/academics/overview returns each list at the top level. Reading the
   * wrong one yields an empty array rather than an error, so it is spelled out
   * here rather than guessed.
   */
  const rows = structures.data?.data ?? [];
  const programs = tree.data?.programs ?? [];
  const semesters = tree.data?.semesters ?? [];

  // Semesters belong to a programme, so the second dropdown follows the first.
  // Offering all forty of them and letting the server refuse the mismatch is
  // how someone bills BBA's semester 3 to a computer science cohort.
  const semestersForProgram = useMemo(
    () => semesters.filter((s) => String(s.programId) === String(form.program_id)),
    [semesters, form.program_id],
  );

  /*
   * What each programme+semester adds up to — the figure a voucher would
   * actually carry. Shown because no single row answers "what does this cost".
   */
  const totals = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.programId}|${r.semesterId}`;
      map.set(key, (map.get(key) || 0) + Number(r.amount || 0));
    }
    return map;
  }, [rows]);

  const openCreate = () => {
    setForm(EMPTY);
    setFormError(null);
    setEditing({ row: null });
  };

  const openEdit = (row) => {
    setForm({
      program_id: row.programId ?? '',
      semester_id: row.semesterId ?? '',
      fee_category: row.category ?? 'Tuition',
      amount: row.amount ?? '',
    });
    setFormError(null);
    setEditing({ row });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const payload = {
        program_id: Number(form.program_id),
        semester_id: Number(form.semester_id),
        fee_category: form.fee_category,
        amount: Number(form.amount),
      };

      if (editing.row) await feeStructuresApi.update(editing.row.id, payload);
      else await feeStructuresApi.create(payload);

      // Only after the server has taken it. Clearing before the await would
      // throw the work away on a failed save, which is the moment it matters.
      draft.clear();
      setEditing(null);
      structures.refresh();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await feeStructuresApi.remove(confirmDelete.id);
      setConfirmDelete(null);
      structures.refresh();
    } catch (err) {
      setFormError(err);
      setConfirmDelete(null);
    }
  };

  return (
    <div style={{ ...card, padding: '1.25rem', marginTop: '1.25rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem',
      }}>
        <div>
          <h3 style={{
            fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: 0,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            fontFamily: "'Outfit', sans-serif",
          }}>
            <Receipt size={18} color={ACCENT} /> Fee structure
          </h3>
          <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0.25rem 0 0' }}>
            What a semester of each programme costs. A voucher with no amount typed on
            it bills the total of these rows.
          </p>
        </div>

        <button type="button" onClick={openCreate} style={btn('primary')}>
          <Plus size={16} /> Add fee line
        </button>
      </div>

      <ApiErrorNotice error={structures.error} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Programme</th>
              <th style={th}>Semester</th>
              <th style={th}>Category</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={{ ...th, textAlign: 'right' }}>Semester total</th>
              <th style={th}>In use by</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !structures.loading && (
              <tr>
                <td style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: '2rem' }} colSpan={7}>
                  No fee lines yet. Until one exists, every voucher needs its amount typed by hand.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.program || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                <td style={td}>{r.semesterLabel || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                <td style={td}><strong>{r.category}</strong></td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {money(r.amount)}
                </td>
                <td style={{
                  ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: '#475569', fontWeight: 700,
                }}>
                  {money(totals.get(`${r.programId}|${r.semesterId}`))}
                </td>
                <td style={td}>
                  <span style={{
                    fontSize: '0.78rem', fontWeight: 600,
                    color: r.voucherCount > 0 ? '#475569' : '#CBD5E1',
                  }}>
                    {r.voucherCount} voucher{r.voucherCount === 1 ? '' : 's'}
                  </span>
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openEdit(r)} style={btn()}>
                    <Pencil size={13} /> Edit
                  </button>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(r)}
                    style={{ ...btn(), border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#DC2626' }}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Create / edit ── */}
      <Modal
        open={!!editing}
        title={`${editing?.row ? 'Edit' : 'Add'} fee line`}
        icon={editing?.row ? Pencil : Plus}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ApiErrorNotice error={formError} />
          <DraftNotice draft={draft} online={online} onDiscard={() => setForm(EMPTY)} compact />

          <div>
            <label style={label}>Programme *</label>
            <select
              value={form.program_id}
              onChange={(e) => setForm({ ...form, program_id: e.target.value, semester_id: '' })}
              required
              style={input}
            >
              <option value="">Choose…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={label}>Semester *</label>
            <select
              value={form.semester_id}
              onChange={(e) => setForm({ ...form, semester_id: e.target.value })}
              required
              disabled={!form.program_id}
              style={{ ...input, opacity: form.program_id ? 1 : 0.6 }}
            >
              <option value="">
                {form.program_id ? 'Choose…' : 'Choose a programme first'}
              </option>
              {semestersForProgram.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}{s.isArchived ? ' · past' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={label}>Category *</label>
            <select
              value={form.fee_category}
              onChange={(e) => setForm({ ...form, fee_category: e.target.value })}
              required
              style={input}
            >
              {FEE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '4px 0 0' }}>
              One row per category. The voucher bills their sum.
            </p>
          </div>

          <div>
            <label style={label}>Amount (Rs.) *</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
              style={input}
            />
          </div>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setEditing(null)} style={{ ...btn(), padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} style={{ ...btn('primary'), opacity: saving ? 0.7 : 1 }}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* ── Delete confirmation ── */}
      <Modal
        open={!!confirmDelete}
        title="Delete this fee line?"
        icon={AlertTriangle}
        onClose={() => setConfirmDelete(null)}
        onBackdropClose={() => setConfirmDelete(null)}
        width="460px"
      >
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          <strong>{confirmDelete?.category}</strong> for {confirmDelete?.program}
          {' '}{confirmDelete?.semesterLabel} ({money(confirmDelete?.amount)}) will be removed.
        </p>
        <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: '0.6rem 0 0' }}>
          {confirmDelete?.voucherCount > 0
            /* Said plainly: this table has no soft-delete, and vouchers already
               issued keep the amount they were billed. Removing the line changes
               what the NEXT voucher costs, not what anyone already owes. */
            ? `${confirmDelete.voucherCount} voucher(s) were billed from this line. They keep their amounts — only future vouchers change.`
            : 'This row is deleted outright; the table has no undo.'}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setConfirmDelete(null)} style={{ ...btn(), padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button type="button" onClick={remove} style={{ ...btn('primary'), backgroundColor: '#DC2626' }}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
