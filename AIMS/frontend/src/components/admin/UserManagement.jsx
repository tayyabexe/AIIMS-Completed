import { useState } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import { useAdminPage } from '../../hooks/useAdminPage';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../common/DraftNotice';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import Pagination from '../common/Pagination';
import Modal from '../common/Modal';
import ApiErrorNotice from '../common/ApiErrorNotice';
import CredentialsDialog from './CredentialsDialog';
import { useRemoteSort, SortHeader } from '../common/SortableHeader';
import {
  X, ShieldAlert, KeyRound, UserX, UserCheck, Clock,
  Unlink, RefreshCw, ShieldCheck, ChevronRight, Lock, LockOpen,
} from 'lucide-react';
import { users as usersApi, admin as adminApi } from '../../api/endpoints';
import { ROLES, ROLE_LABELS } from '../../api/roles';
import UserAvatar from '../common/UserAvatar';

/**
 * User Management — the LOGIN layer.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * Students, Parents, Teachers and Staff Accounts each manage a kind of PERSON
 * and the academic or employment data hanging off them. This screen manages the
 * `users` row — the credential itself — which is a different object with a
 * different lifecycle. It is the only place that can answer:
 *
 *   - who has been issued a login and has never once used it (1,012 here);
 *   - whose account is accumulating failed sign-in attempts (316);
 *   - who never verified their email address (229);
 *   - who is still carrying the password an admin issued them;
 *   - which accounts are deactivated;
 *   - and which logins have NO person record behind them at all (12) — those
 *     appear on no other screen in the portal, because every other list is
 *     built from the students / parents / employees tables.
 *
 * WHAT IT USED TO BE
 * ------------------
 * A wall of identical cards showing email, role and an Active pill, fetched
 * with `limit: 200` against 4,047 accounts — so 95% of them could not be
 * reached at all. No pagination, no role filter, no status filter, no sort, and
 * no actions whatsoever: an account could not be deactivated, have its role
 * corrected, or have its password reissued from here. Eight security columns
 * arrived on every row and none of them was rendered.
 *
 * WHY A TABLE AND NOT CARDS
 * -------------------------
 * The job here is comparison across many rows — "who hasn't logged in", "sort
 * by last seen" — and a card grid is the wrong instrument for that: it gives
 * every account equal visual weight and makes scanning one column impossible.
 * The table carries the list; a slide-in detail panel carries the one account
 * you are acting on, so the full record does not have to be crammed into a row.
 */

/* ── The cohorts the screen leads with ────────────────────────────────────
   Each is a real WHERE clause on the server (see STATUS_FILTERS in
   userService), so choosing one narrows all 4,047 accounts, not the page. */
const HEALTH_CHIPS = [
  { key: 'never_logged_in', field: 'neverLoggedIn', label: 'Never signed in', icon: Clock, fg: '#92400E', bg: '#FEF3C7' },
  /* Locked out by five failed sign-ins, and going nowhere until an admin
     lifts it. This chip used to be labelled "Failed attempts" and selected
     `failed_login_attempts > 0`, which put one typo in the same cohort as a
     real lockout. Both cohorts are here now, under their own names. */
  { key: 'locked', field: 'locked', label: 'Locked out', icon: Lock, fg: '#991B1B', bg: '#FEE2E2' },
  { key: 'failed_attempts', field: 'failedAttempts', label: 'Failed attempts', icon: ShieldAlert, fg: '#9A3412', bg: '#FFEDD5' },
  { key: 'must_change_password', field: 'mustChangePassword', label: 'Must change password', icon: KeyRound, fg: '#5B21B6', bg: '#F5F3FF' },
  { key: 'inactive', field: 'inactive', label: 'Deactivated', icon: UserX, fg: '#475569', bg: '#F1F5F9' },
];

const PAGE_LIMIT = 25;

const CREATABLE_ROLES = [
  ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT,
  ROLES.PARENT, ROLES.HR, ROLES.ACCOUNTANT, ROLES.LIBRARY,
];

const EMPTY_FORM = { email: '', password: '', role_id: String(ROLES.TEACHER), phone: '' };

const initialsOf = (name, email) => {
  const source = (name && name.trim()) || String(email || '').split('@')[0];
  return source.split(/[\s._-]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase() || '?';
};

const AVATAR_COLOURS = [
  '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
  '#0891B2', '#EA580C', '#4F46E5', '#BE123C', '#0D9488', '#9333EA',
];
const avatarBgOf = (id) => AVATAR_COLOURS[(Number(id) || 0) % AVATAR_COLOURS.length];

/*
 * "Never" is the most important value this column takes, and a dash does not
 * say it. An account issued two years ago and never used is the single clearest
 * signal on this screen, so it is spelled out.
 */
const relativeTime = (value) => {
  if (!value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  const years = Math.floor(days / 365);
  return `${years} yr${years === 1 ? '' : 's'} ago`;
};

const absoluteDate = (value) => (value
  ? new Date(value).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : null);

export default function UserManagement({ showAddModal, onCloseAddModal }) {

  /* Server-applied, every one of them. */
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState(null);   // the account in the panel
  const [pageError, setPageError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [confirm, setConfirm] = useState(null);     // { user, action }

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const online = useOnlineStatus();

  /*
   * Sorting is REMOTE. The table pages, so sorting the 25 loaded rows would
   * reorder the page rather than the table — see the note in SortableHeader.
   */
  const { sort, toggle, params: sortParams } = useRemoteSort(null, () => setPage(1));

  /*
   * Declared HERE, below the filter state and useRemoteSort, and not up with
   * the other state at the top of the component.
   *
   * It reads `page`, `search`, the three filters and `sortParams`, and a
   * `const` cannot be used above its declaration. Placing it where the old
   * `useState` block sat threw "Cannot access 'page' before initialization"
   * and took the route down — caught on screen, not by the linter.
   */
  /*
   * The user directory, on the shared cache.
   *
   * This was the last admin list still fetching by hand — six pieces of state
   * and a hand-rolled 300ms debounce for the search box. `useAdminPage` owns
   * both now: the debounce is what the query is KEYED on, so typing does not
   * fire a request per keystroke, and the four derived values below are read
   * straight off the cached response.
   */
  const usersQuery = useAdminPage(
    (p) => usersApi.list(p),
    {
      page,
      limit: PAGE_LIMIT,
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(roleFilter ? { role_id: roleFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(orphansOnly ? { orphans: 'only' } : {}),
      ...sortParams,
    },
    { key: 'users', debounceMs: 300 },
  );

  const rows = Array.isArray(usersQuery.data?.data) ? usersQuery.data.data : [];
  const summary = usersQuery.data?.summary || {};
  const roleCounts = usersQuery.data?.roleCounts || [];
  const total = Number(usersQuery.data?.total ?? 0);
  const loading = usersQuery.loading;
  const error = usersQuery.error;
  const load = usersQuery.refresh;

  const draft = useDraft('admin.user.new', { ...form, password: '' }, {
    enabled: !!showAddModal,
    onRestore: (value) => setForm({ ...EMPTY_FORM, ...value, password: '' }),
    isEmpty: (value) => !value?.email?.trim() && !value?.phone?.trim(),
  });

  useScrollLock(!!showAddModal);


  const pages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const activeFilters = [search, roleFilter, statusFilter, orphansOnly ? '1' : '']
    .filter(Boolean).length;

  const clearFilters = () => {
    setSearch(''); setRoleFilter(''); setStatusFilter(''); setOrphansOnly(false); setPage(1);
  };

  const chooseStatus = (key) => {
    setStatusFilter((current) => (current === key ? '' : key));
    setOrphansOnly(false);
    setPage(1);
  };

  /* ── Actions ─────────────────────────────────────────────────────────
     None of these existed. An account could be looked at and nothing else. */

  const setActive = async (user, isActive) => {
    setBusyId(user.user_id);
    setPageError(null);
    try {
      await usersApi.update(user.user_id, { is_active: isActive });
      await load();
      setSelected((s) => (s && s.user_id === user.user_id ? { ...s, is_active: isActive } : s));
    } catch (err) {
      setPageError(err);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  /*
   * Lift a lockout. Deliberately its own action rather than a field on the
   * edit form: an account is locked because somebody failed to sign in to it
   * five times, and that is a decision an admin should take on purpose, not
   * undo as a side effect of correcting a phone number.
   *
   * The endpoint clears the attempt counter along with the lock — a lock
   * lifted with five failures still on the clock would snap shut on the
   * account holder's next typo.
   */
  const unlock = async (user) => {
    setBusyId(user.user_id);
    setPageError(null);
    try {
      await usersApi.unlock(user.user_id);
      await load();
      setSelected((s) => (s && s.user_id === user.user_id
        ? { ...s, locked_at: null, failed_login_attempts: 0 }
        : s));
    } catch (err) {
      setPageError(err);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const changeRole = async (user, roleId) => {
    setBusyId(user.user_id);
    setPageError(null);
    try {
      await usersApi.update(user.user_id, { role_id: Number(roleId) });
      await load();
      setSelected((s) => (s && s.user_id === user.user_id ? { ...s, role_id: Number(roleId) } : s));
    } catch (err) {
      setPageError(err);
    } finally {
      setBusyId(null);
    }
  };

  // Issues a NEW password and shows it exactly once. The old one is a bcrypt
  // hash and cannot be read back, so this is the only remedy for a lost one.
  const reissue = async (user) => {
    setBusyId(user.user_id);
    setPageError(null);
    try {
      const res = await adminApi.reissueCredentials(user.user_id);
      if (res?.credentials?.password) {
        setCredentials({
          account: {
            name: user.full_name || user.email,
            email: res.credentials.email || user.email,
            password: res.credentials.password,
          },
        });
      }
      await load();
    } catch (err) {
      setPageError(err);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const closeModal = () => { setForm(EMPTY_FORM); setFormError(null); onCloseAddModal?.(); };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password) {
      setFormError('An email address and a password are required.');
      return;
    }
    if (form.password.length < 8) {
      setFormError('The password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await usersApi.create({
        email: form.email.trim(),
        password_hash: form.password,
        role_id: Number(form.role_id),
        phone: form.phone.trim() || undefined,
      });
      draft.clear();
      closeModal();
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not create the account.');
    } finally {
      setSaving(false);
    }
  };

  const roleName = (id) => ROLE_LABELS[Number(id)] || `Role ${id}`;

  /* Only the very first load owns the screen; filtering keeps the table up
     and dims the pager, like every other list in the portal. */
  if (loading && !rows.length && !total) {
    return <RouteLoader label="Loading accounts…" hint="Every login this institute has issued" />;
  }

  return (
    <div className="tab-transition" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
            User Management
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            Logins and access · {(summary.accounts ?? 0).toLocaleString()} accounts across {roleCounts.length} roles
          </span>
        </div>
      </div>

      {/* ── Account health ──────────────────────────────────────────────
          A meter, not five more stat cards: these five cohorts are parts of
          one population, and showing them as segments of a single bar says
          "how much of the estate is in trouble" in a way five separate
          numbers cannot. Each segment and chip is also the filter for that
          cohort, because the number is exactly what you want to click. */}
      <div style={{
        backgroundColor: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0',
        padding: '1.25rem 1.35rem', boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
        display: 'flex', flexDirection: 'column', gap: '0.9rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Account health
          </span>
          <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>
            counted over all {(summary.accounts ?? 0).toLocaleString()} live logins
          </span>
        </div>

        <div className="ad-meter" title="Share of accounts in each state">
          {HEALTH_CHIPS.map((c) => {
            const value = summary[c.field] ?? 0;
            const pct = summary.accounts ? (value / summary.accounts) * 100 : 0;
            if (!pct) return null;
            return <span key={c.key} style={{ width: `${pct}%`, backgroundColor: c.fg }} />;
          })}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {HEALTH_CHIPS.map(({ key, field, label, icon: Icon, fg, bg }) => {
            const value = summary[field] ?? 0;
            const active = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseStatus(key)}
                aria-pressed={active}
                disabled={value === 0 && !active}
                title={value === 0 ? `No accounts are ${label.toLowerCase()}` : `Show the ${value} ${label.toLowerCase()} accounts`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '0.4rem 0.85rem', borderRadius: '9999px',
                  border: active ? 'none' : `1px solid ${fg}22`,
                  backgroundColor: active ? fg : bg,
                  color: active ? '#FFFFFF' : fg,
                  fontSize: '0.75rem', fontWeight: 700,
                  cursor: value === 0 && !active ? 'not-allowed' : 'pointer',
                  opacity: value === 0 && !active ? 0.45 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={13} /> {value.toLocaleString()} {label}
              </button>
            );
          })}

          {/* The orphans are a different KIND of problem — not an account
              state but a broken link to a person — so it reads separately. */}
          <button
            type="button"
            onClick={() => { setOrphansOnly((v) => !v); setStatusFilter(''); setPage(1); }}
            aria-pressed={orphansOnly}
            disabled={(summary.orphans ?? 0) === 0 && !orphansOnly}
            title="Logins with no student, parent or employee record behind them — invisible on every other screen"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '0.4rem 0.85rem', borderRadius: '9999px',
              border: orphansOnly ? 'none' : '1px dashed #CBD5E1',
              backgroundColor: orphansOnly ? '#0F172A' : '#FFFFFF',
              color: orphansOnly ? '#FFFFFF' : '#475569',
              fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Unlink size={13} /> {(summary.orphans ?? 0).toLocaleString()} No person record
          </button>
        </div>
      </div>

      <ApiErrorNotice error={pageError} onDismiss={() => setPageError(null)} />

      {/* ── Table ── */}
      <div style={{
        backgroundColor: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column',
        gap: '1rem', padding: '1.25rem',
      }}>
        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <FilterField
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search by email address…"
            style={{ flex: '1 1 240px' }}
            inputStyle={{ padding: '0.5rem 2.2rem', border: '1px solid #CBD5E1', borderRadius: '10px', fontSize: '0.85rem', boxSizing: 'border-box' }}
          />

          {/* Every option carries its real count, so no role can be picked
              that returns nothing. */}
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            style={selectStyle}
          >
            <option value="">All roles ({(summary.accounts ?? 0).toLocaleString()})</option>
            {roleCounts.filter((r) => r.accounts > 0).map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.roleName} ({r.accounts.toLocaleString()})
              </option>
            ))}
          </select>

          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters} style={ghostBtn}>
              <X size={13} /> Clear {activeFilters}
            </button>
          )}

          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500, marginLeft: 'auto' }}>
            {activeFilters > 0
              ? <>Showing <strong>{rows.length}</strong> of <strong>{total.toLocaleString()}</strong> matching</>
              : <><strong>{total.toLocaleString()}</strong> accounts</>}
          </span>
        </div>

        {error && <p style={{ color: '#DC2626', fontWeight: 600, fontSize: '0.85rem' }}>Could not load accounts: {error}</p>}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.72rem', color: '#64748B', fontWeight: 700 }}>
                <SortHeader label="Account" sortKey="email" sort={sort} onToggle={toggle} style={thStyle} />
                <SortHeader label="Role" sortKey="role" sort={sort} onToggle={toggle} style={thStyle} />
                <SortHeader label="Last sign-in" sortKey="last_login" sort={sort} onToggle={toggle} style={thStyle}
                  title="Never-used accounts sort last in both directions" />
                <SortHeader label="Failed" sortKey="failed" sort={sort} onToggle={toggle} align="center" style={thStyle} />
                <th style={{ ...thStyle, textAlign: 'left' }}>Flags</th>
                <SortHeader label="Created" sortKey="created" sort={sort} onToggle={toggle} style={thStyle} />
                <th style={{ ...thStyle, textAlign: 'right' }}>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.9rem' }}>
                    {activeFilters > 0
                      ? <>No account matches these filters. <button type="button" onClick={clearFilters} style={linkBtn}>Clear them</button>.</>
                      : 'No user accounts found.'}
                  </td>
                </tr>
              )}

              {rows.map((u, i) => {
                const active = u.is_active !== false;
                const orphan = !u.profile_type;
                const busy = busyId === u.user_id;
                return (
                  <tr
                    key={u.user_id}
                    className="person-subrow"
                    onClick={() => setSelected(u)}
                    style={{
                      borderBottom: '1px solid #F1F5F9', fontSize: '0.85rem',
                      cursor: 'pointer', opacity: busy ? 0.5 : 1,
                      backgroundColor: selected?.user_id === u.user_id ? '#FEF2F2' : 'transparent',
                      '--i': Math.min(i, 12),
                    }}
                  >
                    {/* Account */}
                    <td style={{ padding: '0.7rem 0.9rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* A disabled account keeps the grey square rather than
                            its photograph: the row is greyed out on purpose, and
                            a full-colour portrait in it would read as active. */}
                        <UserAvatar
                          userId={active ? u.user_id : null}
                          name={u.full_name || u.email}
                          initials={initialsOf(u.full_name, u.email)}
                          size={32}
                          shape="rounded"
                          bg={active ? avatarBgOf(u.user_id) : '#CBD5E1'}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {/* `users` has no name column — the API joins it
                                from students/parents/employees. An account with
                                no person record has genuinely no name. */}
                            {u.full_name || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No person record</span>}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#64748B' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td style={{ padding: '0.7rem 0.9rem' }}>
                      <span style={{
                        backgroundColor: '#F1F5F9', color: '#475569',
                        padding: '0.18rem 0.55rem', borderRadius: '6px',
                        fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                        {roleName(u.role_id)}
                      </span>
                    </td>

                    {/* Last sign-in */}
                    <td style={{ padding: '0.7rem 0.9rem' }} title={absoluteDate(u.last_login) || 'This account has never been used'}>
                      {u.last_login
                        ? <span style={{ color: '#334155', fontWeight: 600 }}>{relativeTime(u.last_login)}</span>
                        : <span style={{ color: '#B45309', fontWeight: 700 }}>Never</span>}
                    </td>

                    {/* Failed attempts */}
                    <td style={{ padding: '0.7rem 0.9rem', textAlign: 'center' }}>
                      {u.failed_login_attempts > 0
                        ? <span style={{
                          backgroundColor: '#FEE2E2', color: '#991B1B',
                          padding: '0.12rem 0.5rem', borderRadius: '9999px',
                          fontSize: '0.72rem', fontWeight: 800,
                        }}>{u.failed_login_attempts}</span>
                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>

                    {/* Flags — the whole security state in one glanceable cell */}
                    <td style={{ padding: '0.7rem 0.9rem' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {/* Locked reads before everything else: it is the one
                            flag here that is stopping somebody working right
                            now, and the only one with a one-click remedy. */}
                        {u.locked_at && <Flag tone="red" icon={Lock} label="Locked out" />}
                        {!active && <Flag tone="slate" icon={UserX} label="Deactivated" />}
                        {u.must_change_password && <Flag tone="violet" icon={KeyRound} label="Must change password" />}
                        {orphan && <Flag tone="dark" icon={Unlink} label="No person record" />}
                        {/*
                          "Email unverified" used to sit above, and `u.email_verified`
                          used to be required here for an account to read as Healthy.
                          Since nothing in the system could ever set that column to 1,
                          every account carried the orange badge and no account could
                          ever be Healthy. Both are gone; the three flags left are ones
                          an admin can actually act on.
                        */}
                        {active && !u.locked_at && !u.must_change_password && !orphan && (
                          <Flag tone="green" icon={ShieldCheck} label="Healthy" />
                        )}
                      </div>
                    </td>

                    {/* Created */}
                    <td style={{ padding: '0.7rem 0.9rem', color: '#64748B', fontSize: '0.78rem' }}
                      title={absoluteDate(u.created_at) || ''}>
                      {relativeTime(u.created_at) || '—'}
                    </td>

                    <td style={{ padding: '0.7rem 0.9rem', textAlign: 'right', color: '#CBD5E1' }}>
                      <ChevronRight size={16} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pages={pages}
          total={total}
          limit={PAGE_LIMIT}
          count={rows.length}
          onChange={setPage}
          noun="account"
          loading={loading}
        />
      </div>

      {/* ── Detail panel ────────────────────────────────────────────────
          A slide-in drawer rather than another modal: acting on an account is
          a task you do repeatedly down a list, and a centred dialog that has
          to be dismissed before you can see the next row fights that. The
          table stays visible and keeps its selection. */}
      {selected && (
        <>
          <div
            onClick={() => setSelected(null)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.35)', zIndex: 900 }}
          />
          <aside
            className="user-drawer"
            role="dialog"
            aria-label={`Account ${selected.email}`}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px, 92vw)',
              backgroundColor: '#FFFFFF', zIndex: 901, boxShadow: '-12px 0 40px rgba(15,23,42,0.16)',
              display: 'flex', flexDirection: 'column', overflowY: 'auto',
            }}
          >
            <div style={{
              padding: '1.25rem 1.35rem', borderBottom: '1px solid #E2E8F0',
              display: 'flex', alignItems: 'flex-start', gap: '0.85rem',
            }}>
              <UserAvatar
                userId={selected.is_active !== false ? selected.user_id : null}
                name={selected.full_name || selected.email}
                initials={initialsOf(selected.full_name, selected.email)}
                size={46}
                shape="rounded"
                bg={selected.is_active !== false ? avatarBgOf(selected.user_id) : '#CBD5E1'}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                  {selected.full_name || 'No person record'}
                </h3>
                <p style={{ fontSize: '0.8rem', color: '#64748B', margin: '2px 0 0', wordBreak: 'break-all' }}>
                  {selected.email}
                </p>
                <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '4px 0 0' }}>
                  Account #{selected.user_id}
                  {selected.profile_type && ` · linked to a ${selected.profile_type} record`}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748B' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Every login-layer column the row could not fit. */}
              <section>
                <h4 style={sectionLabel}>Sign-in record</h4>
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.55rem 1rem', fontSize: '0.82rem' }}>
                  <Detail label="Last sign-in" value={absoluteDate(selected.last_login) || 'Never used'} warn={!selected.last_login} />
                  <Detail label="Failed attempts" value={selected.failed_login_attempts ?? 0} warn={selected.failed_login_attempts > 0} />
                  <Detail
                    label="Locked out"
                    value={selected.locked_at ? absoluteDate(selected.locked_at) : 'No'}
                    warn={!!selected.locked_at}
                  />
                  <Detail label="Password last changed" value={absoluteDate(selected.last_password_change) || 'Never changed'} warn={!selected.last_password_change} />
                  <Detail label="Must change password" value={selected.must_change_password ? 'Yes' : 'No'} warn={selected.must_change_password} />
                  <Detail label="Credentials issued" value={absoluteDate(selected.credentials_issued_at) || 'Not by this portal'} />
                  <Detail label="Account created" value={absoluteDate(selected.created_at) || '—'} />
                </dl>
              </section>

              <section>
                <h4 style={sectionLabel}>Role</h4>
                {/* Changing a role changes what the token can reach, so it is
                    a live control rather than a label. Super Admin is absent:
                    the API refuses it for anyone who is not already one. */}
                <select
                  value={String(selected.role_id)}
                  onChange={(e) => changeRole(selected, e.target.value)}
                  disabled={busyId === selected.user_id}
                  style={{ ...selectStyle, width: '100%' }}
                >
                  {CREATABLE_ROLES.map((id) => (
                    <option key={id} value={id}>{ROLE_LABELS[id]}</option>
                  ))}
                  {!CREATABLE_ROLES.includes(Number(selected.role_id)) && (
                    <option value={selected.role_id}>{roleName(selected.role_id)}</option>
                  )}
                </select>
              </section>

              <section>
                <h4 style={sectionLabel}>Access</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* First, because it is the only control here that answers a
                      person waiting on the phone to be let back in. */}
                  {selected.locked_at && (
                    <button
                      type="button"
                      onClick={() => unlock(selected)}
                      disabled={busyId === selected.user_id}
                      style={{ ...drawerBtn, borderColor: '#FCA5A5', color: '#991B1B', backgroundColor: '#FEF2F2' }}
                    >
                      <LockOpen size={15} /> Unlock this account
                    </button>
                  )}

                  {selected.is_active !== false ? (
                    <button
                      type="button"
                      onClick={() => setConfirm({ user: selected, action: 'deactivate' })}
                      disabled={busyId === selected.user_id}
                      style={{ ...drawerBtn, borderColor: '#FCA5A5', color: '#DC2626', backgroundColor: '#FEF2F2' }}
                    >
                      <UserX size={15} /> Deactivate this login
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActive(selected, true)}
                      disabled={busyId === selected.user_id}
                      style={{ ...drawerBtn, borderColor: '#A7F3D0', color: '#059669', backgroundColor: '#ECFDF5' }}
                    >
                      <UserCheck size={15} /> Reactivate this login
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setConfirm({ user: selected, action: 'reissue' })}
                    disabled={busyId === selected.user_id}
                    style={drawerBtn}
                  >
                    <RefreshCw size={15} /> Issue a new password
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '0.6rem 0 0', lineHeight: 1.5 }}>
                  Deactivating blocks sign-in without deleting anything — the person
                  record and their academic history stay intact. A reissued password
                  is shown once and cannot be read back afterwards. An account locks
                  itself after five failed sign-ins and stays locked until you unlock
                  it here; unlocking also clears the failed-attempt count.
                </p>
              </section>
            </div>
          </aside>
        </>
      )}

      {/* ── Confirm a destructive or irreversible action ── */}
      <Modal
        open={!!confirm}
        title={confirm?.action === 'reissue' ? 'Issue a new password?' : 'Deactivate this login?'}
        icon={confirm?.action === 'reissue' ? KeyRound : UserX}
        onClose={() => setConfirm(null)}
        onBackdropClose={() => setConfirm(null)}
        width="460px"
      >
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          {confirm?.action === 'reissue' ? (
            <>
              A new password will be generated for <strong>{confirm?.user?.email}</strong> and
              shown to you <strong>once</strong>. Their current password stops working
              immediately, so make sure you can pass the new one on.
            </>
          ) : (
            <>
              <strong>{confirm?.user?.email}</strong> will no longer be able to sign in.
              Nothing is deleted — their record and history are untouched, and the
              login can be reactivated from this screen at any time.
            </>
          )}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setConfirm(null)} style={ghostBtn}>Cancel</button>
          <button
            type="button"
            onClick={() => (confirm.action === 'reissue'
              ? reissue(confirm.user)
              : setActive(confirm.user, false))}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none',
              backgroundColor: confirm?.action === 'reissue' ? '#5B21B6' : '#DC2626',
              color: '#FFFFFF', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            {confirm?.action === 'reissue' ? 'Issue new password' : 'Deactivate'}
          </button>
        </div>
      </Modal>

      <CredentialsDialog result={credentials} onClose={() => setCredentials(null)} />

      {/* ── Add User Modal ── */}
      {showAddModal && (
        <>
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 999 }} onClick={closeModal} />
          <form
            onSubmit={handleCreate}
            style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'white', borderRadius: '16px', padding: '2rem', width: '480px', maxWidth: '90vw', zIndex: 1000 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: "'Outfit', sans-serif", color: '#0f172a', margin: 0 }}>Add New User</h3>
              <button type="button" onClick={closeModal} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', padding: '0.25rem' }}>
                <X size={20} />
              </button>
            </div>

            <DraftNotice draft={draft} online={online} onDiscard={() => setForm(EMPTY_FORM)} />

            {formError && (
              <div style={{ padding: '0.65rem 0.85rem', borderRadius: '10px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.82rem', fontWeight: 500, marginBottom: '1rem' }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* A name is not asked for here: `users` has no name column. The
                  person record (student, parent or employee) carries it and is
                  created from its own screen — which is why a login created
                  here shows as "No person record" until one is linked. */}
              <input
                type="email"
                placeholder="Email Address"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                style={{ padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '0.875rem', outline: 'none' }}
              />
              <input
                type="password"
                placeholder="Temporary Password (min 8 characters)"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                style={{ padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '0.875rem', outline: 'none' }}
              />
              <input
                type="tel"
                placeholder="Phone (optional)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                style={{ padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '0.875rem', outline: 'none' }}
              />
              <select
                value={form.role_id}
                onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                style={{ padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '0.875rem', outline: 'none', color: '#475569' }}
              >
                {CREATABLE_ROLES.map((id) => (
                  <option key={id} value={id}>{ROLE_LABELS[id]}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={saving}
                style={{ padding: '0.75rem', backgroundColor: saving ? '#b45c5c' : '#991b1b', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

const FLAG_TONES = {
  slate: { fg: '#475569', bg: '#F1F5F9' },
  orange: { fg: '#9A3412', bg: '#FFEDD5' },
  violet: { fg: '#5B21B6', bg: '#F5F3FF' },
  dark: { fg: '#0F172A', bg: '#E2E8F0' },
  // The one flag that means somebody cannot work right now.
  red: { fg: '#991B1B', bg: '#FEE2E2' },
  green: { fg: '#065F46', bg: '#ECFDF5' },
};

function Flag({ tone, icon: Icon, label }) {
  const t = FLAG_TONES[tone] || FLAG_TONES.slate;
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        backgroundColor: t.bg, color: t.fg,
        padding: '0.12rem 0.45rem', borderRadius: '5px',
        fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <Icon size={10} /> {label}
    </span>
  );
}

function Detail({ label, value, warn = false }) {
  return (
    <>
      <dt style={{ color: '#64748B', fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right', fontWeight: 700, color: warn ? '#B45309' : '#0F172A' }}>
        {value}
      </dd>
    </>
  );
}

const thStyle = { padding: '0.7rem 0.9rem', fontSize: '0.72rem' };

const selectStyle = {
  padding: '0.5rem 0.85rem', borderRadius: '10px', border: '1px solid #CBD5E1',
  fontSize: '0.82rem', fontWeight: 600, color: '#334155',
  backgroundColor: '#FFFFFF', outline: 'none', cursor: 'pointer',
};

const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  padding: '0.5rem 0.85rem', borderRadius: '10px', border: '1px solid #CBD5E1',
  backgroundColor: '#FFFFFF', color: '#475569', fontWeight: 700,
  fontSize: '0.8rem', cursor: 'pointer',
};

const drawerBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
  padding: '0.6rem 0.9rem', borderRadius: '10px', border: '1px solid #CBD5E1',
  backgroundColor: '#FFFFFF', color: '#334155', fontWeight: 700,
  fontSize: '0.82rem', cursor: 'pointer', width: '100%',
};

const linkBtn = {
  background: 'none', border: 'none', padding: 0, color: '#991B1B',
  fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem',
};

const sectionLabel = {
  fontSize: '0.7rem', fontWeight: 800, color: '#64748B',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  margin: '0 0 0.6rem',
};
