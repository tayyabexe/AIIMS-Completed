import { useMemo, useState } from 'react';
import {
  ShieldCheck, Plus, Pencil, Trash2, Save, AlertTriangle, KeyRound,
  Power, PowerOff, Crown, Building2,
} from 'lucide-react';
import { admin as adminApi, departments as departmentsApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { STALE } from '../../api/queryClient';
import { useAuth } from '../../context/AuthContext';
import FilterField from '../common/FilterField';
import { useSort, SortHeader } from '../common/SortableHeader';
import Modal from '../common/Modal';
import DraftNotice from '../common/DraftNotice';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import ApiErrorNotice from '../common/ApiErrorNotice';
import CredentialsDialog from './CredentialsDialog';
import RouteLoader from '../common/RouteLoader';
import { ROLES, ROLE_LABELS } from '../../api/roles';

/*
 * Staff accounts: Super Admin, Admin, HR, Accountant and Library Staff.
 *
 * WHY IT COVERS FIVE ROLES AND NOT TWO
 * ------------------------------------
 * Nothing in this portal could manage any of them. HR, Accounts and Library
 * accounts had no screen of any kind, and the Admin accounts were created
 * straight into the database — which is why eight of the nine in this institute
 * are called admin1@ … admin5@, testuser@, newadmin123@ and admin100@, with no
 * name attached to any of them. They are all rows in `users` under the same
 * guards, so they belong on one screen.
 *
 * THE NAMELESS ACCOUNTS
 * ---------------------
 * `users` has no name column. A staff member's name lives on `employees`, whose
 * `department_id` is NOT NULL — so a name can only be stored against a
 * department, and an administrator does not necessarily have one. That is
 * exactly why those eight rows have no employee record.
 *
 * This screen shows that state instead of hiding it: an account with no staff
 * record is flagged, its email's local part stands in for a name, and the edit
 * form offers to create the record — asking for the department in the same
 * breath, because the row cannot be written without one.
 *
 * THE THREE GUARDS, AND WHY THEY ARE ALSO DRAWN HERE
 * -------------------------------------------------
 * The server enforces them; it is the only place that can. But an admin who
 * clicks Delete on their own row and is told "no" has learned the rule the
 * expensive way, so the buttons that would be refused are disabled with the
 * reason on them:
 *
 *   1. You cannot delete or deactivate your own account.
 *   2. Only a Super Admin may edit a Super Admin, or grant that role.
 *   3. The last active Super Admin cannot be removed.
 */

const ACCENT = '#991b1b';

const STAFF_ROLES = [
  ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR, ROLES.ACCOUNTANT, ROLES.LIBRARY,
];

const EMPLOYMENT_STATUSES = ['Active', 'On Leave', 'Terminated', 'Retired'];

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
  padding: '0.55rem 0.8rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
};

const td = {
  fontSize: '0.85rem', color: '#0F172A', padding: '0.65rem 0.8rem',
  borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle',
};

const smallBtn = (variant = 'ghost', disabled = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  padding: '0.35rem 0.65rem', borderRadius: '8px',
  fontSize: '0.78rem', fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  ...(variant === 'danger'
    ? { border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#DC2626' }
    : { border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', color: '#0F172A' }),
});

const EMPTY = {
  role_id: String(ROLES.ADMIN),
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  department_id: '',
  designation: '',
};

export default function StaffAccountsView() {
  const { user } = useAuth();

  const [filters, setFilters] = useState({ q: '', role_id: '', is_active: '' });
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [pageError, setPageError] = useState(null);

  const online = useOnlineStatus();

  /*
   * Draft persistence for the create form.
   *
   * Only the CREATE form. An edit is seeded from a row that is already on the
   * server, so a restored draft there would silently reapply half-finished
   * changes over whatever the record says now — and the person would have no
   * way to tell the restored values from the stored ones. A create has no such
   * ambiguity: the only source for those fields is what was typed.
   *
   * `enabled` is keyed on the dialog being open AND being a create, which is
   * also what stops the draft being written while the modal is shut and what
   * makes the restore happen at the moment the form is actually on screen.
   *
   * No password is involved: this form does not collect one. The account's
   * password is generated server-side and shown once in the credentials
   * dialog, so there is nothing secret here to keep out of localStorage.
   */
  const draft = useDraft('admin.staff-account.new', form, {
    enabled: !!editing && !editing.row,
    onRestore: (value) => setForm({ ...EMPTY, ...value }),
    // An untouched form must not claim unsaved work. role_id is pre-filled, so
    // it cannot be part of the test — only the fields a person types into.
    isEmpty: (value) => !value?.first_name?.trim()
      && !value?.last_name?.trim()
      && !value?.email?.trim()
      && !value?.phone?.trim()
      && !value?.designation?.trim(),
  });

  // The one-time password, shown exactly once after a create or a reissue.
  const [credentials, setCredentials] = useState(null);

  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.admins(p),
    filters, { key: 'admins', debounceMs: 300 });

  const { data: departmentData } = useAdminPage(() => departmentsApi.list(), {}, { key: 'departments', staleTime: STALE.reference });
  const departments = departmentData?.data ?? [];

  const rows = data?.data ?? [];

  // The whole list arrives at once, so it sorts here. "Login" orders by the
  // account's active state; "Last sign-in" by the timestamp, with accounts that
  // have never signed in kept at the end rather than treated as the oldest.
  const { sorted, sort, toggle } = useSort(rows, {
    login: (r) => (r.isActive ? 1 : 0),
    lastSignIn: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).getTime() : null),
  });

  /*
   * Who is signed in, and whether they are a Super Admin.
   *
   * Both come from the token's account rather than from the row list, because
   * the rule is about the actor: an Admin viewing this screen may not touch the
   * Super Admin row no matter what the list contains.
   */
  const meId = Number(user?.userId);
  const iAmSuperAdmin = Number(user?.roleId) === ROLES.SUPER_ADMIN;

  const activeSuperAdmins = useMemo(
    () => rows.filter((r) => r.isSuperAdmin && r.isActive).length,
    [rows],
  );

  /**
   * Why a write against this row would be refused, or null if it would go
   * through. One function so the table, the tooltips and the dialogs cannot
   * disagree about it.
   */
  const refusalFor = (row, action) => {
    if (Number(row.userId) === meId && (action === 'delete' || action === 'deactivate')) {
      return `You cannot ${action} your own account.`;
    }
    if (row.isSuperAdmin && !iAmSuperAdmin) {
      return 'Only a Super Admin can change a Super Admin account.';
    }
    if (row.isSuperAdmin && activeSuperAdmins <= 1 && (action === 'delete' || action === 'deactivate')) {
      return 'This is the only active Super Admin.';
    }
    return null;
  };

  const openCreate = () => {
    setForm(EMPTY);
    setFormError(null);
    setEditing({ row: null });
  };

  const openEdit = (row) => {
    setForm({
      role_id: String(row.roleId),
      first_name: row.firstName ?? '',
      last_name: row.lastName ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      department_id: row.departmentId ?? '',
      designation: row.designation ?? '',
      employment_status: row.employmentStatus ?? '',
    });
    setFormError(null);
    setEditing({ row });
  };

  const closeForm = () => { setEditing(null); setFormError(null); };

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError(null);

    // Empty strings are dropped: an absent key means "leave alone", which is not
    // the same request as sending ''.
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== '' && v !== undefined && v !== null),
    );

    try {
      if (editing.row) {
        await adminApi.updateAdmin(editing.row.userId, payload);
      } else {
        const res = await adminApi.createAdmin(payload);
        /*
         * Straight into the credentials dialog. This is the only moment the
         * generated password is readable — the database holds a bcrypt hash — so
         * it is handed over now or reissued later, never looked up.
         */
        if (res?.credentials?.password) {
          setCredentials({
            teacher: {
              name: res.data?.name,
              employeeCode: res.data?.employeeCode || res.data?.role,
              email: res.credentials.email,
              password: res.credentials.password,
            },
          });
        }
      }
      // Cleared only after the server has accepted it. Clearing on submit
      // would discard the work if the request then failed.
      draft.clear();
      closeForm();
      refresh();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    setPageError(null);
    try {
      await adminApi.removeAdmin(target.userId);
      refresh();
    } catch (err) {
      setPageError(err);
    }
  };

  const setActive = async (row, next) => {
    setPageError(null);
    try {
      await adminApi.updateAdmin(row.userId, { is_active: next });
      refresh();
    } catch (err) {
      setPageError(err);
    }
  };

  // A lost password cannot be recovered, only replaced. See
  // provisioningService.reissueCredentials.
  const reissue = async (row) => {
    setPageError(null);
    try {
      const res = await adminApi.reissueCredentials(row.userId);
      const issued = res?.data ?? res;
      setCredentials({
        teacher: {
          name: row.name,
          employeeCode: issued.role || row.role,
          email: issued.email || row.email,
          password: issued.password,
        },
      });
      refresh();
    } catch (err) {
      setPageError(err);
    }
  };

  if (loading && !data) {
    return <RouteLoader label="Loading staff accounts…" hint="Every administrative login this institute has issued" />;
  }

  if (error && !data) return <ApiErrorNotice error={error} />;

  /*
   * `nameOnFile`, not `hasEmployeeRecord`. An account created without a
   * department has no employees row but still stores the name that was typed
   * into the create form, on `users.full_name`. Counting the employees rows
   * instead reported those people as nameless while the table showed their
   * names.
   */
  const namelessCount = rows.filter((r) => !r.nameOnFile).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{
            fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0,
            letterSpacing: '-0.02em', fontFamily: "'Outfit', sans-serif",
          }}>
            Staff Accounts
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '4px 0 0' }}>
            {rows.length} accounts · Super Admin, Admin, HR, Accounts and Library
            {namelessCount > 0 && ` · ${namelessCount} with no name on file`}
          </p>
        </div>
        <button type="button" onClick={openCreate} style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '0.6rem 1.1rem', borderRadius: '10px', border: 'none',
          backgroundColor: ACCENT, color: '#FFFFFF', fontWeight: 700,
          fontSize: '0.85rem', cursor: 'pointer',
        }}>
          <Plus size={16} /> Add staff account
        </button>
      </div>

      <ApiErrorNotice error={pageError} onDismiss={() => setPageError(null)} />

      <div style={{ ...card, padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterField
            value={filters.q}
            onChange={(v) => setFilters((f) => ({ ...f, q: v }))}
            placeholder="Search by name, email, phone, role, employee code, designation or department…"
            style={{ flex: '1 1 300px' }}
          />

          <select
            value={filters.role_id}
            onChange={(e) => setFilters((f) => ({ ...f, role_id: e.target.value }))}
            style={{ ...input, width: 'auto', minWidth: '160px' }}
          >
            <option value="">All staff roles</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>

          <select
            value={filters.is_active}
            onChange={(e) => setFilters((f) => ({ ...f, is_active: e.target.value }))}
            style={{ ...input, width: 'auto', minWidth: '150px' }}
          >
            {/* Default is both: a switched-off account is the one most often
                being looked for on this screen. */}
            <option value="">Enabled and disabled</option>
            <option value="1">Enabled only</option>
            <option value="0">Disabled only</option>
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  ['name', 'Person'], ['role', 'Role'], ['department', 'Department'],
                  ['login', 'Login'], ['lastSignIn', 'Last sign-in'],
                ].map(([key, label]) => (
                  <SortHeader
                    key={key}
                    label={label}
                    sortKey={key}
                    sort={sort}
                    onToggle={toggle}
                    style={th}
                  />
                ))}
                {/* Actions holds buttons — nothing to order by. */}
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: '2.5rem' }}>
                    No staff accounts match these filters.
                  </td>
                </tr>
              ) : sorted.map((row) => {
                const isMe = Number(row.userId) === meId;
                const deleteRefusal = refusalFor(row, 'delete');
                const editRefusal = refusalFor(row, 'edit');
                const toggleRefusal = refusalFor(row, row.isActive ? 'deactivate' : 'activate');

                return (
                  <tr key={row.userId} style={{ backgroundColor: row.isActive ? undefined : '#FAFAFA' }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                        {/* Greyed only when the name is a guess off the email. */}
                        <strong style={{ color: row.nameOnFile ? '#0F172A' : '#64748B' }}>
                          {row.name}
                        </strong>
                        {row.isSuperAdmin && (
                          <span title="Super Admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.68rem', fontWeight: 800, color: '#92400E', backgroundColor: '#FEF3C7', padding: '1px 6px', borderRadius: '5px' }}>
                            <Crown size={11} /> SUPER
                          </span>
                        )}
                        {isMe && (
                          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#1D4ED8', backgroundColor: '#DBEAFE', padding: '1px 6px', borderRadius: '5px' }}>
                            YOU
                          </span>
                        )}
                        {!row.nameOnFile && (
                          /* Not a warning about the person — a statement about
                             the record: the name beside it is the email local
                             part, because nothing is stored.

                             Keyed on `nameOnFile`, not `hasEmployeeRecord`. The
                             latter only says whether a department was set, and
                             using it put this badge next to accounts that were
                             displaying their real stored name. */
                          <span title="No name is stored for this account, so it is listed by its email address. Edit to add one." style={{ fontSize: '0.68rem', fontWeight: 700, color: '#92400E', backgroundColor: '#FEF9C3', padding: '1px 6px', borderRadius: '5px' }}>
                            name not on file
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '2px' }}>
                        {row.email}
                        {row.designation ? ` · ${row.designation}` : ''}
                      </div>
                    </td>

                    <td style={td}>{row.role}</td>

                    <td style={td}>
                      {row.department || <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>

                    <td style={td}>
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px',
                        color: row.isActive ? '#065F46' : '#7F1D1D',
                        backgroundColor: row.isActive ? '#D1FAE5' : '#FEE2E2',
                      }}>
                        {row.isActive ? 'Enabled' : 'Disabled'}
                      </span>
                      {row.mustChangePassword && (
                        /* Issued a password nobody has replaced yet, so nobody
                           has signed in as this person since it was created. */
                        <div style={{ fontSize: '0.7rem', color: '#92400E', marginTop: '3px' }}>
                          password not yet changed
                        </div>
                      )}
                    </td>

                    <td style={{ ...td, fontSize: '0.78rem', color: '#64748B' }}>
                      {row.lastLogin
                        ? new Date(row.lastLogin).toLocaleDateString()
                        : <span style={{ color: '#CBD5E1' }}>never</span>}
                    </td>

                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => reissue(row)}
                        title="Issue a new password. The current one cannot be recovered."
                        style={{ ...smallBtn(), marginRight: '5px' }}
                      >
                        <KeyRound size={13} color={ACCENT} />
                      </button>

                      <button
                        type="button"
                        onClick={() => setActive(row, !row.isActive)}
                        disabled={!!toggleRefusal}
                        title={toggleRefusal || (row.isActive ? 'Disable this login' : 'Enable this login')}
                        style={{ ...smallBtn('ghost', !!toggleRefusal), marginRight: '5px' }}
                      >
                        {row.isActive ? <PowerOff size={13} /> : <Power size={13} color="#059669" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        disabled={!!editRefusal}
                        title={editRefusal || 'Edit this account'}
                        style={{ ...smallBtn('ghost', !!editRefusal), marginRight: '5px' }}
                      >
                        <Pencil size={13} color={ACCENT} /> Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmDelete(row)}
                        disabled={!!deleteRefusal}
                        title={deleteRefusal || 'Delete this account and disable its login'}
                        style={smallBtn('danger', !!deleteRefusal)}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create / edit ── */}
      <Modal
        open={!!editing}
        title={editing?.row ? `Edit ${editing.row.name}` : 'Add a staff account'}
        icon={editing?.row ? Pencil : ShieldCheck}
        onClose={closeForm}
      >
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ApiErrorNotice error={formError} />

          {/* Only on create — the draft is not enabled for an edit, so this
              would render an empty strip there. */}
          {!editing?.row && (
            <DraftNotice draft={draft} online={online} onDiscard={() => setForm(EMPTY)} />
          )}

          {!editing?.row && (
            <div style={{
              padding: '0.6rem 0.85rem', borderRadius: '8px',
              backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE',
              color: '#5B21B6', fontSize: '0.78rem', lineHeight: 1.5,
            }}>
              The login is created for you and the password is shown once, straight
              after saving. Leave the email blank to have one allocated in the
              institute's own firstname.lastname@ format.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={label}>First name *</label>
              <input
                style={input}
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required={!editing?.row}
              />
            </div>
            <div>
              <label style={label}>Last name *</label>
              <input
                style={input}
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required={!editing?.row}
              />
            </div>
          </div>

          <div>
            <label style={label}>Role *</label>
            <select
              style={input}
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
              required
            >
              {STAFF_ROLES.map((r) => (
                <option
                  key={r}
                  value={r}
                  // Granting Super Admin is a Super Admin's act alone. Disabled
                  // rather than hidden, so the rule is visible instead of the
                  // option simply being missing.
                  disabled={r === ROLES.SUPER_ADMIN && !iAmSuperAdmin}
                >
                  {ROLE_LABELS[r]}
                  {r === ROLES.SUPER_ADMIN && !iAmSuperAdmin ? ' — Super Admin only' : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={label}>Email</label>
              <input
                type="email"
                style={input}
                placeholder={editing?.row ? '' : 'Leave blank to generate one'}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label style={label}>Phone</label>
              <input
                style={input}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          {/*
            The department is what makes the name storable — see the header. It
            is optional so nobody has to file the registrar under Electrical
            Engineering just to give them a login, but the consequence of leaving
            it out is stated rather than left to be discovered.
          */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={label}>Department</label>
              <select
                style={input}
                value={form.department_id}
                onChange={(e) => setForm({ ...form, department_id: e.target.value })}
              >
                <option value="">No staff record</option>
                {departments.map((d) => (
                  <option key={d.department_id ?? d.id} value={d.department_id ?? d.id}>
                    {d.department_name ?? d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Designation</label>
              <input
                style={input}
                placeholder="e.g. Accounts Officer"
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </div>
          </div>

          <p style={{
            fontSize: '0.74rem', margin: 0, lineHeight: 1.5,
            color: form.department_id ? '#94A3B8' : '#92400E',
          }}>
            <Building2 size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
            {form.department_id
              ? 'A staff record will hold this person\'s designation, employee code and department alongside their name.'
              : 'Optional. The name is stored on the account either way — without a department there is simply no staff record to carry a designation, employee code or employment status.'}
          </p>

          {editing?.row?.hasEmployeeRecord && (
            <div>
              <label style={label}>Employment status</label>
              <select
                style={input}
                value={form.employment_status ?? ''}
                onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
              >
                <option value="">Leave unchanged</option>
                {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={closeForm} style={{ ...smallBtn(), padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '0.6rem 1.3rem', borderRadius: '8px', border: 'none',
              backgroundColor: ACCENT, color: '#FFFFFF', fontWeight: 700,
              fontSize: '0.85rem', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            <Save size={15} />
            {saving ? 'Saving…' : editing?.row ? 'Save changes' : 'Create account'}
          </button>
        </div>
      </Modal>

      {/* ── Delete confirmation ── */}
      <Modal
        open={!!confirmDelete}
        title="Delete this staff account?"
        icon={AlertTriangle}
        onClose={() => setConfirmDelete(null)}
        onBackdropClose={() => setConfirmDelete(null)}
        width="460px"
      >
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          <strong>{confirmDelete?.name}</strong> ({confirmDelete?.email}) will be
          hidden from this list <em>and</em> their login disabled — both, so the
          account cannot still be signed into.
        </p>
        <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: '0.6rem 0 0', lineHeight: 1.5 }}>
          The row is kept in the database and the email address stays reserved, so
          it cannot be reused for a new account.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setConfirmDelete(null)} style={{ ...smallBtn(), padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '0.6rem 1.3rem', borderRadius: '8px', border: 'none',
              backgroundColor: '#DC2626', color: '#FFFFFF', fontWeight: 700,
              fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            <Trash2 size={15} /> Delete account
          </button>
        </div>
      </Modal>

      <CredentialsDialog result={credentials} onClose={() => setCredentials(null)} />
    </div>
  );
}
