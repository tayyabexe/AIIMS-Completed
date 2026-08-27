import { useCallback, useEffect, useMemo, useState } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import useLiveRefresh from '../../hooks/useLiveRefresh';
import { LIVE } from '../../api/queryClient';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../common/DraftNotice';
import RouteLoader from '../common/RouteLoader';
import Pagination from '../common/Pagination';
import {
  Megaphone, Plus, Trash2, Pencil, X, Users2, Filter, AlertTriangle, Loader2,
} from 'lucide-react';
import {
  announcements as announcementsApi,
  programs as programsApi,
  batches as batchesApi,
  sections as sectionsApi,
  semesters as semestersApi,
  users as usersApi,
} from '../../api/endpoints';

/**
 * The admin portal's Announcements screen.
 *
 * Publishing used to be possible only through the API directly - there was no
 * admin screen for announcements at all, and the only way to decide who saw one
 * was the single `target_role` column.
 *
 * AUDIENCE MODEL
 * --------------
 * An announcement carries a list of rules. Within one rule every filter that is
 * set must match the reader, so "BSCS-2022" plus "CS-4A" reaches that section
 * and nobody else. Rules OR together, so a second rule naming the Teacher role
 * adds every teacher without narrowing the first.
 *
 * An announcement with no rules is addressed to everyone, which is what the
 * "Everyone" mode sends.
 *
 * Every dropdown below is filled from the live reference tables. Nothing here
 * is a fixed list except the audience *modes*, which describe the shape of a
 * rule rather than any data.
 */

/* Mirrors the `roles` table. Role ids are a fixed part of the schema (see
   backend config/roles.js) rather than something the admin can add to, so the
   labels are named here instead of being fetched. */
const ROLES = [
  { id: 1, label: 'Super Admins' },
  { id: 2, label: 'Admins' },
  { id: 3, label: 'Teachers' },
  { id: 4, label: 'Students' },
  { id: 5, label: 'Parents' },
  { id: 6, label: 'HR' },
  { id: 7, label: 'Accountants' },
  { id: 8, label: 'Library Staff' },
];

/* The dimensions a rule can filter on. `field` is the column the API expects. */
const DIMENSIONS = [
  { field: 'role_id', label: 'Role' },
  { field: 'program_id', label: 'Programme' },
  { field: 'batch_id', label: 'Batch' },
  { field: 'section_id', label: 'Section' },
  { field: 'semester_id', label: 'Semester' },
  { field: 'user_id', label: 'Individual' },
];

const EMPTY_RULE = {
  role_id: '', program_id: '', batch_id: '', section_id: '', semester_id: '', user_id: '',
};

const card = {
  backgroundColor: '#FFFFFF',
  borderRadius: '16px',
  border: '1px solid #E2E8F0',
  boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
};

const input = {
  width: '100%', padding: '0.55rem 0.75rem', borderRadius: '10px',
  border: '1px solid #CBD5E1', fontSize: '0.85rem', color: '#0F172A',
  backgroundColor: '#FFFFFF', outline: 'none',
};

const label = {
  display: 'block', fontSize: '0.72rem', fontWeight: 700,
  color: '#64748B', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: '0.35rem',
};

const btn = (variant) => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '0.5rem 0.9rem', borderRadius: '10px',
  fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
  border: variant === 'primary' ? '1px solid #991b1b' : '1px solid #CBD5E1',
  backgroundColor: variant === 'primary' ? '#991b1b' : '#FFFFFF',
  color: variant === 'primary' ? '#FFFFFF' : '#334155',
});

const listOf = (body, ...keys) => {
  if (Array.isArray(body)) return body;
  for (const k of keys) if (Array.isArray(body?.[k])) return body[k];
  return Array.isArray(body?.data) ? body.data : [];
};

/* The sort orders the API accepts. Names, not column expressions — the server
   maps these onto whitelisted ORDER BY fragments. */
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'audience', label: 'Grouped by audience' },
];

const PAGE_SIZE = 10;

const EMPTY_FILTERS = {
  q: '', target_role: '', posted_by: '', from: '', to: '', sort: 'newest',
};

export default function AnnouncementsView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /*
   * The notice board is filtered and paged by the SERVER.
   *
   * It previously called list() with no arguments at all and rendered whatever
   * came back — no search, no audience filter, no date window, no pager. That
   * is workable at fourteen notices and unusable at four hundred, and a
   * board that cannot be searched is a board nobody reads.
   *
   * Filtering client-side was not an option: the endpoint pages, so a search
   * over the loaded rows would quietly mean "search page 1", which looks like
   * it worked and is wrong.
   */
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState({ audiences: [], authors: [] });

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1); // a narrower query invalidates whatever page you were on
  };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => k !== 'sort' && v !== '').length;

  /* Reference data for the audience dropdowns. */
  const [refs, setRefs] = useState({
    programs: [], batches: [], sections: [], semesters: [], users: [],
  });

  const [editing, setEditing] = useState(null); // null | {} for new | row for edit
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  /* Freeze the notice board behind the compose form and the delete
     confirmation. The compose form is tall enough to scroll internally, which
     is exactly the case where the wheel hands the rest of the gesture to the
     page behind it once the form reaches its end. */
  useScrollLock(!!editing || !!confirmDelete);

  /* ── Load the announcements this admin has published access to. An admin
        sees every announcement, so no filtering is applied here. ── */
  /*
   * `quiet` is what the heartbeat below passes: it refreshes the rows without
   * putting the board back into its loading state, so a background refresh
   * never blanks the list somebody is reading.
   */
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      // Only the filters that are set are sent, so an untouched board still
      // makes the same plain request it always did.
      const params = { page, limit: PAGE_SIZE };
      for (const [k, v] of Object.entries(filters)) if (v !== '') params[k] = v;

      const res = await announcementsApi.list(params);
      setItems(listOf(res, 'announcements'));
      setTotal(Number(res?.total ?? 0));
      if (res?.options) setOptions(res.options);
    } catch (err) {
      setError(err.message || 'Could not load announcements.');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  /*
   * Debounced, because `q` re-runs this on every keystroke. 300ms matches the
   * other filtered lists in the portal (useAdminPage's default).
   */
  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  /*
   * This board holds its own rows rather than going through the shared cache —
   * it owns paging, the filter set and the audience options that arrive with
   * the list — so it does not inherit the portal's polling defaults and has to
   * keep itself current. An announcement published by another administrator
   * now appears here on its own, and the refresh is quiet: no skeleton, no
   * scroll jump.
   */
  useLiveRefresh(() => load({ quiet: true }), LIVE.records);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /* ── Reference data. Loaded once; a failure on any one list leaves that
        dropdown empty rather than blocking the whole screen. ── */
  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      programsApi.list(), batchesApi.list(), sectionsApi.list(),
      semestersApi.list(), usersApi.list({ limit: 500 }),
    ]).then(([p, b, s, sem, u]) => {
      if (cancelled) return;
      const val = (r) => (r.status === 'fulfilled' ? r.value : null);
      setRefs({
        programs: listOf(val(p), 'programs'),
        batches: listOf(val(b), 'batches'),
        sections: listOf(val(s), 'sections'),
        semesters: listOf(val(sem), 'semesters'),
        users: listOf(val(u), 'users'),
      });
    });

    return () => { cancelled = true; };
  }, []);

  /* Options per dimension, built from the live reference rows. */
  const optionsFor = useCallback((field) => {
    switch (field) {
      case 'role_id':
        return ROLES.map((r) => ({ value: r.id, label: r.label }));
      case 'program_id':
        return refs.programs.map((p) => ({ value: p.program_id, label: p.program_name }));
      case 'batch_id':
        return refs.batches.map((b) => ({ value: b.batch_id, label: b.batch_name }));
      case 'section_id':
        return refs.sections.map((s) => ({
          value: s.section_id,
          // Sections repeat their letter across batches, so the batch is shown
          // alongside to keep two "CS-4A"-style names apart.
          label: `${s.section_name}${batchName(s.batch_id) ? ` — ${batchName(s.batch_id)}` : ''}`,
        }));
      case 'semester_id':
        return refs.semesters.map((s) => ({
          value: s.semester_id,
          label: `Semester ${s.semester_number}${s.program_name ? ` — ${s.program_name}` : ''}`,
        }));
      case 'user_id':
        return refs.users.map((u) => ({
          value: u.user_id,
          // /api/users exposes the resolved name as `full_name`; many accounts
          // have no profile row behind them, so the email is the fallback and
          // is always present.
          label: u.full_name ? `${u.full_name} (${u.email})` : u.email,
        }));
      default:
        return [];
    }
    function batchName(id) {
      return refs.batches.find((b) => b.batch_id === id)?.batch_name || '';
    }
  }, [refs]);

  /* ── Form state ── */
  const [form, setForm] = useState({ title: '', content: '', mode: 'everyone', rules: [] });
  const online = useOnlineStatus();

  /*
   * A half-written announcement survives a crash or a refresh.
   *
   * An announcement is a body of prose plus an audience built rule by rule —
   * minutes of work that lived only in React state. The key separates a new
   * announcement from an edit of an existing one, so editing announcement 12
   * can never resurrect a draft meant for a brand new notice.
   */
  const draftKey = editing?.announcement_id
    ? `admin.announcement.${editing.announcement_id}`
    : 'admin.announcement.new';

  const draft = useDraft(draftKey, form, {
    enabled: !!editing,
    onRestore: setForm,
    isEmpty: (value) => !value?.title?.trim() && !value?.content?.trim(),
  });

  const openNew = () => {
    setForm({ title: '', content: '', mode: 'everyone', rules: [{ ...EMPTY_RULE }] });
    setFormError(null);
    setEditing({});
  };

  const openEdit = (row) => {
    const rules = (row.targets || []).map((t) => ({
      role_id: t.role_id ?? '',
      program_id: t.program_id ?? '',
      batch_id: t.batch_id ?? '',
      section_id: t.section_id ?? '',
      semester_id: t.semester_id ?? '',
      user_id: t.user_id ?? '',
    }));
    setForm({
      title: row.title || '',
      content: row.content || '',
      mode: rules.length ? 'targeted' : 'everyone',
      rules: rules.length ? rules : [{ ...EMPTY_RULE }],
    });
    setFormError(null);
    setEditing(row);
  };

  const closeForm = () => { setEditing(null); setFormError(null); };

  const setRule = (index, field, value) => {
    setForm((f) => ({
      ...f,
      rules: f.rules.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    }));
  };

  /* The Individual field is typed against emails, so the two directions of the
     mapping live here. A half-typed email simply resolves to no user, which
     leaves that filter unset rather than guessing at who was meant. */
  const emailForUser = useCallback(
    (userId) => (userId === '' || userId == null
      ? ''
      : refs.users.find((u) => String(u.user_id) === String(userId))?.email || ''),
    [refs.users],
  );

  const userIdForEmail = useCallback(
    (email) => refs.users.find((u) => u.email === email)?.user_id ?? '',
    [refs.users],
  );

  const addRule = () => setForm((f) => ({ ...f, rules: [...f.rules, { ...EMPTY_RULE }] }));
  const removeRule = (index) =>
    setForm((f) => ({ ...f, rules: f.rules.filter((_, i) => i !== index) }));

  /* Rules with nothing selected are dropped rather than sent — the API rejects
     an empty rule, and an admin who added a row and changed their mind should
     not have to delete it to publish. */
  const packedRules = useMemo(
    () => form.rules
      .map((r) => Object.fromEntries(
        Object.entries(r).filter(([, v]) => v !== '' && v !== null),
      ))
      .filter((r) => Object.keys(r).length > 0),
    [form.rules],
  );

  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setFormError('A title and a message are both required.');
      return;
    }
    if (form.mode === 'targeted' && packedRules.length === 0) {
      setFormError('Choose at least one filter, or switch the audience to Everyone.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        // An empty list clears targeting, which is how "Everyone" is stored.
        targets: form.mode === 'targeted' ? packedRules : [],
      };
      // target_role is what decides the audience when there are no rules, so it
      // is only sent in Everyone mode.
      if (form.mode === 'everyone') payload.target_role = 'All';

      if (editing?.announcement_id) {
        await announcementsApi.update(editing.announcement_id, payload);
      } else {
        await announcementsApi.create(payload);
      }

      // The local copy is only dropped once the server has it.
      draft.clear();
      closeForm();
      await load();
    } catch (err) {
      // The API names the filter at fault ("No such batch: 9999"), which is far
      // more useful than a generic failure.
      setFormError(err.message || 'Could not save the announcement.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (row) => {
    setSaving(true);
    try {
      await announcementsApi.remove(row.announcement_id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete the announcement.');
    } finally {
      setSaving(false);
    }
  };

  const message = (text, tone = '#94A3B8') => (
    <div style={{ ...card, padding: '3rem', textAlign: 'center', color: tone, fontWeight: 600 }}>
      {text}
    </div>
  );

  return (
    <div className="tab-transition" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Announcements
          </h2>
          {/* Counts the whole filtered set, not the page — `items.length` was
              at most one page and read as the size of the board. */}
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            {loading
              ? 'Loading…'
              : activeFilterCount > 0
                ? `${total} matching · ${items.length} on this page`
                : `${total} published`}
          </span>
        </div>
        <button onClick={openNew} style={btn('primary')}>
          <Plus size={15} /> New Announcement
        </button>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────
          Every value here is applied by the SERVER, so they narrow the whole
          board rather than the page in front of you. The audience and author
          lists are built from the notices that exist, each with its count, so
          no option can be chosen that matches nothing. */}
      <div style={{ ...card, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <Filter size={14} /> Filter
          </span>

          <input
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="Search titles and body text…"
            style={{ ...input, width: 'auto', flex: '1 1 240px' }}
          />

          <select
            value={filters.target_role}
            onChange={(e) => setFilter('target_role', e.target.value)}
            style={{ ...input, width: 'auto' }}
          >
            <option value="">Any audience</option>
            {options.audiences.map((a) => (
              <option key={a.value} value={a.value}>{a.value} ({a.count})</option>
            ))}
          </select>

          <select
            value={filters.posted_by}
            onChange={(e) => setFilter('posted_by', e.target.value)}
            style={{ ...input, width: 'auto' }}
          >
            <option value="">Anyone</option>
            {options.authors.map((a) => (
              <option key={a.value} value={a.value}>{a.label} ({a.count})</option>
            ))}
          </select>

          <select
            value={filters.sort}
            onChange={(e) => setFilter('sort', e.target.value)}
            style={{ ...input, width: 'auto' }}
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B' }}>Posted between</label>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilter('from', e.target.value)}
            style={{ ...input, width: 'auto' }}
          />
          <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>and</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilter('to', e.target.value)}
            style={{ ...input, width: 'auto' }}
          />

          {activeFilterCount > 0 && (
            <button onClick={clearFilters} style={{ ...btn(), marginLeft: 'auto' }}>
              <X size={13} /> Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

      {loading && <RouteLoader label="Loading announcements…" hint="Everything published to the institute" />}
      {!loading && error && message(`Could not load announcements: ${error}`, '#DC2626')}
      {/* An empty board and an empty RESULT are different situations and used
          to render the same sentence. */}
      {!loading && !error && items.length === 0 && (
        activeFilterCount > 0
          ? message(
            filters.q
              ? `No announcement matches “${filters.q}”${filters.target_role ? ` for ${filters.target_role}` : ''}.`
              : 'No announcement matches these filters.',
          )
          : message('Nothing has been published yet. Use “New Announcement” to post the first.')
      )}

      {/* ── List ── */}
      {!loading && !error && items.length > 0 && (
        <div style={{ ...card, padding: '0.5rem 0' }}>
          {items.map((a, i) => (
            <div
              key={a.announcement_id}
              className="person-subrow"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.9rem',
                padding: '1rem 1.5rem',
                borderBottom: i < items.length - 1 ? '1px solid #F1F5F9' : 'none',
                '--i': i,
              }}
            >
              <span style={{
                width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#FEF2F2', color: '#991b1b',
              }}>
                <Megaphone size={16} />
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.9rem', color: '#0F172A' }}>{a.title}</strong>
                  {/* Who it reaches, resolved to names by the API. */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    backgroundColor: a.targets?.length ? '#EFF6FF' : '#F1F5F9',
                    color: a.targets?.length ? '#2563EB' : '#64748B',
                  }}>
                    <Users2 size={11} />
                    {a.audience_label || a.target_role || 'Everyone'}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#475569', margin: '3px 0 0' }}>{a.content}</p>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>
                  {a.created_at
                    ? new Date(a.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })
                    : ''}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                <button onClick={() => openEdit(a)} style={btn()} title="Edit">
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setConfirmDelete(a)}
                  style={{ ...btn(), color: '#DC2626', borderColor: '#FECACA' }}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The same shared pager every other list in the portal uses. There was
          none here at all, because the board fetched everything at once. */}
      {!loading && !error && total > 0 && (
        <Pagination
          page={page}
          pages={pages}
          total={total}
          limit={PAGE_SIZE}
          count={items.length}
          onChange={setPage}
          noun="announcement"
          loading={loading}
        />
      )}

      {/* ── Create / edit modal ── */}
      {editing && (
        <div
          onClick={closeForm}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, padding: '1.5rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...card, width: '100%', maxWidth: '640px',
              maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1.1rem 1.5rem', borderBottom: '1px solid #E2E8F0',
            }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                {editing.announcement_id ? 'Edit Announcement' : 'New Announcement'}
              </h3>
              <button onClick={closeForm} style={{ ...btn(), padding: '0.35rem 0.5rem' }}>
                <X size={15} />
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

              <DraftNotice draft={draft} online={online} onDiscard={() => setForm({ title: '', content: '', mode: 'everyone', rules: [] })} />

              {formError && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '0.7rem 0.9rem', borderRadius: '10px',
                  backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
                  color: '#991B1B', fontSize: '0.82rem', fontWeight: 600,
                }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label style={label} htmlFor="ann-title">Title</label>
                <input
                  id="ann-title"
                  style={input}
                  maxLength={150}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>

              <div>
                <label style={label} htmlFor="ann-content">Message</label>
                <textarea
                  id="ann-content"
                  rows={4}
                  style={{ ...input, resize: 'vertical' }}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
              </div>

              {/* ── Audience ── */}
              <div>
                <span style={label}>Audience</span>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  {[
                    { key: 'everyone', text: 'Everyone' },
                    { key: 'targeted', text: 'Specific audience' },
                  ].map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setForm({ ...form, mode: m.key })}
                      style={{
                        ...btn(form.mode === m.key ? 'primary' : undefined),
                        flex: 1, justifyContent: 'center',
                      }}
                    >
                      {m.text}
                    </button>
                  ))}
                </div>

                {form.mode === 'everyone' && (
                  <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0 }}>
                    Every signed-in account will see this announcement.
                  </p>
                )}

                {form.mode === 'targeted' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
                      Within one group, every filter you set must match — a batch
                      plus a section reaches that section only. Add another group
                      to reach a second audience as well.
                    </p>

                    {form.rules.map((rule, index) => (
                      <div
                        key={index}
                        style={{
                          border: '1px solid #E2E8F0', borderRadius: '12px',
                          padding: '0.9rem', backgroundColor: '#F8FAFC',
                        }}
                      >
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          marginBottom: '0.65rem',
                        }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            fontSize: '0.72rem', fontWeight: 800, color: '#475569',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            <Filter size={12} /> Group {index + 1}
                          </span>
                          {form.rules.length > 1 && (
                            <button
                              onClick={() => removeRule(index)}
                              style={{ ...btn(), padding: '0.25rem 0.45rem', color: '#DC2626', borderColor: '#FECACA' }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '0.6rem',
                        }}>
                          {DIMENSIONS.map((d) => (
                            <div key={d.field}>
                              <label style={{ ...label, fontSize: '0.65rem' }}>{d.label}</label>

                              {/* Individual is a type-ahead rather than a
                                  dropdown: the institute has hundreds of
                                  accounts, and scrolling a <select> that long
                                  to find one person is unusable. Email is the
                                  key because it is unique on the users row. */}
                              {d.field === 'user_id' ? (
                                <>
                                  <input
                                    style={input}
                                    list={`ann-users-${index}`}
                                    placeholder="Search by name or email"
                                    value={emailForUser(rule.user_id)}
                                    onChange={(e) =>
                                      setRule(index, 'user_id', userIdForEmail(e.target.value))}
                                  />
                                  <datalist id={`ann-users-${index}`}>
                                    {refs.users.map((u) => (
                                      <option key={u.user_id} value={u.email}>
                                        {u.full_name || u.email}
                                      </option>
                                    ))}
                                  </datalist>
                                </>
                              ) : (
                                <select
                                  style={{ ...input, cursor: 'pointer' }}
                                  value={rule[d.field]}
                                  onChange={(e) => setRule(index, d.field, e.target.value)}
                                >
                                  <option value="">Any</option>
                                  {optionsFor(d.field).map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <button onClick={addRule} style={{ ...btn(), alignSelf: 'flex-start' }}>
                      <Plus size={14} /> Add another group
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: '0.6rem',
              padding: '1rem 1.5rem', borderTop: '1px solid #E2E8F0',
            }}>
              <button onClick={closeForm} disabled={saving} style={btn()}>Cancel</button>
              <button onClick={save} disabled={saving} style={btn('primary')}>
                {saving && <Loader2 size={14} className="spin" />}
                {editing.announcement_id ? 'Save Changes' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation. A delete is permanent: the table has no
            is_deleted column, so the row and its audience rules go for good. ── */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, padding: '1.5rem',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: '420px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: '0 0 0.5rem' }}>
              Delete this announcement?
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 1.25rem' }}>
              “{confirmDelete.title}” will be removed permanently, along with its
              audience settings. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button onClick={() => setConfirmDelete(null)} disabled={saving} style={btn()}>Cancel</button>
              <button
                onClick={() => doDelete(confirmDelete)}
                disabled={saving}
                style={{ ...btn('primary'), backgroundColor: '#DC2626', borderColor: '#DC2626' }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
