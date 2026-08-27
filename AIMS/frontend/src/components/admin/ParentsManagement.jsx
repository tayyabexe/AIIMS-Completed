import { useState, useMemo } from 'react';
import {
  Users, Phone, Mail, ChevronRight, UserCheck, BookOpen,
  GraduationCap, Eye, Plus, Pencil, Trash2, Save, AlertTriangle, Link2, Unlink,
  Briefcase, UserX,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage, useListParams } from '../../hooks/useAdminPage';
import Pagination from '../common/Pagination';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import Modal from '../common/Modal';
import DraftNotice from '../common/DraftNotice';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import ApiErrorNotice from '../common/ApiErrorNotice';
import CredentialsDialog from './CredentialsDialog';
import UserAvatar from '../common/UserAvatar';

/*
 * Parents / Guardians.
 *
 * Served by GET /api/admin/parents, a page at a time, with each parent's
 * children resolved for that page only.
 *
 * It previously read two portal-wide arrays out of context — all 2,000 parents
 * (695 KB) and all 2,013 students — and joined them in the browser to turn each
 * parent's list of child IDs into child records. That join is now a single SQL
 * statement over the twenty-five parents actually being shown.
 */
export default function ParentsManagement() {
  const { viewStudentProfile } = useAuth();
  const [expandedParent, setExpandedParent] = useState(null);
  const [childrenCountFilter, setChildrenCountFilter] = useState('all');

  const { params, filters, setFilter, setPage } = useListParams({
    q: '',
    limit: 25,
  });

  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.parents(p),
    params, { key: 'parents', debounceMs: 300 });

  const searchTerm = filters.q;
  const setSearchTerm = (value) => setFilter('q', value);

  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 25 };
  const parents = data?.rows ?? [];
  // Counted server-side over every parent the filter matches — see the
  // `summary` block in getParentsPage. The tiles below used to reduce these
  // from `rows`, i.e. from the 25 parents on screen, while sitting beside a
  // "Total Parents: 2,001" tile counted over all of them.
  const summary = data?.summary ?? {};

  /*
   * The sibling filter applies to the page on screen.
   *
   * It is deliberately not pushed to the server: "parents with more than one
   * child" is a HAVING over the guardian link table, and the count shown beside
   * it would then disagree with the total unless that were computed too. Left
   * as a page-local refinement, it is honest about what it filters.
   */
  const filteredParents = useMemo(() => {
    if (childrenCountFilter === 'single') return parents.filter((p) => p.children.length === 1);
    if (childrenCountFilter === 'multiple') return parents.filter((p) => p.children.length > 1);
    return parents;
  }, [parents, childrenCountFilter]);

  const totalParents = pagination.total;
  const siblingParents = summary.multipleChildren ?? 0;
  const onlyChildParents = summary.singleChild ?? 0;
  const noChildParents = summary.noChildren ?? 0;
  const linkedChildren = summary.linkedChildren ?? 0;

  const toggleExpand = (parentId) => {
    setExpandedParent(expandedParent === parentId ? null : parentId);
  };

  /*
   * A stable colour per guardian, derived from their id.
   *
   * The child rows used to read `child.avatarBg` and `child.initials`, neither
   * of which GET /api/admin/parents has ever sent — so every child avatar fell
   * through to the same hardcoded indigo, and a panel of four siblings was four
   * identical circles. Derived here instead of shipped on every row.
   */
  const AVATAR_COLOURS = [
    '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
    '#0891B2', '#EA580C', '#4F46E5', '#BE123C', '#0D9488', '#9333EA',
  ];
  const avatarBgOf = (id) => AVATAR_COLOURS[(Number(id) || 0) % AVATAR_COLOURS.length];
  const initialsOf = (name) =>
    String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase() || '?';

  /* ────────────────────────────────────────────────────────────────────────
     WRITES
     ──────────────────────────────────────────────────────────────────────
     This screen was read-only. A guardian linked to the wrong child by an
     admission stayed linked to the wrong child: there was no update, no delete
     and no way to move a link, because `student_guardians` was written once and
     never touched again.

     The four things that changed:
       - a parent can be created here, login and all, for the case where the
         parent arrives before the child is admitted;
       - name, email, phone and occupation are editable;
       - a child can be linked and unlinked one at a time;
       - a parent can be deleted — but the server refuses while children are
         still linked, and names them, which is why unlink comes first.
     ──────────────────────────────────────────────────────────────────────── */

  const EMPTY_PARENT = { first_name: '', last_name: '', email: '', phone: '', occupation: '' };

  const [editing, setEditing] = useState(null);         // null | { row } | { row: null }
  const [form, setForm] = useState(EMPTY_PARENT);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [linking, setLinking] = useState(null);          // the parent gaining a child
  const [linkForm, setLinkForm] = useState({ student_id: '', relationship: 'Guardian' });
  const [childQuery, setChildQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const online = useOnlineStatus();

  /*
   * Draft persistence for the create form only.
   *
   * An edit is seeded from the server row, so restoring a draft over it would
   * reapply stale half-finished edits with nothing on screen to distinguish
   * them from the record's real values. A create has one source for its fields
   * — what was typed — so a restore there is unambiguous.
   *
   * The parent's password is generated server-side and shown once in the
   * credentials dialog; this form never holds one, so nothing secret reaches
   * localStorage.
   */
  const parentDraft = useDraft('admin.parent.new', form, {
    enabled: !!editing && !editing.row,
    onRestore: (value) => setForm({ ...EMPTY_PARENT, ...value }),
    isEmpty: (value) => !value?.first_name?.trim()
      && !value?.last_name?.trim()
      && !value?.email?.trim()
      && !value?.phone?.trim()
      && !value?.occupation?.trim(),
  });
  const [pageError, setPageError] = useState(null);
  const [credentials, setCredentials] = useState(null);

  /*
   * The student picker searches the server rather than offering a <select> of
   * 2,000 students. Enabled only while the link dialog is open, so this screen
   * makes no extra request in its ordinary state.
   */
  const { data: childSearch } = useAdminPage(
    (p) => adminApi.students(p),
    { q: childQuery.trim(), limit: 10 }, { key: 'students', enabled: !!linking && childQuery.trim().length > 1, debounceMs: 300 });

  const childCandidates = childSearch?.rows ?? [];

  const openCreate = () => { setForm(EMPTY_PARENT); setFormError(null); setEditing({ row: null }); };

  const openEdit = (parent) => {
    /*
     * `firstName` and `lastName` come off the row now. The fallback splits the
     * joined name on the FIRST space, which was the only route before: it makes
     * "Syed Muhammad Ali" first="Syed", last="Muhammad Ali" — and then saves
     * that back over the real columns. The API sends both fields so the form
     * writes back exactly what it read.
     */
    const [first, ...rest] = String(parent.name || '').trim().split(/\s+/);
    setForm({
      first_name: parent.firstName ?? first ?? '',
      last_name: parent.lastName ?? rest.join(' ') ?? '',
      email: parent.email ?? '',
      phone: parent.phone ?? '',
      occupation: parent.occupation ?? '',
    });
    setFormError(null);
    setEditing({ row: parent });
  };

  const closeForm = () => { setEditing(null); setFormError(null); };

  const saveParent = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== '' && v != null),
    );

    try {
      if (editing.row) {
        await adminApi.updateParent(editing.row.id ?? editing.row.parent_id, payload);
      } else {
        const res = await adminApi.createParent(payload);
        // The one and only time this password is readable.
        if (res?.credentials?.password) {
          setCredentials({
            parent: {
              name: res.data?.name,
              email: res.credentials.email,
              password: res.credentials.password,
            },
          });
        }
      }
      // After the server accepts it, not on submit — a failed request must
      // leave the typed work recoverable.
      parentDraft.clear();
      closeForm();
      refresh();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const removeParent = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    setPageError(null);
    try {
      await adminApi.removeParent(target.id ?? target.parent_id);
      refresh();
    } catch (err) {
      // Expected when children are still linked: the 409 carries a blockedBy
      // array naming each child, which ApiErrorNotice renders as a list.
      setPageError(err);
    }
  };

  const linkChild = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await adminApi.linkChild(linking.id ?? linking.parent_id, {
        student_id: Number(linkForm.student_id),
        relationship: linkForm.relationship,
      });
      setLinking(null);
      setLinkForm({ student_id: '', relationship: 'Guardian' });
      setChildQuery('');
      refresh();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const unlinkChild = async (parent, child) => {
    setPageError(null);
    try {
      await adminApi.unlinkChild(parent.id ?? parent.parent_id, child.id ?? child.student_id);
      refresh();
    } catch (err) {
      setPageError(err);
    }
  };

  /*
   * The first load owns the whole screen, rather than the header tiles
   * rendering "0 parents · 0 with siblings" from the empty defaults while the
   * request is still in flight.
   */
  if (loading && !data) {
    return <RouteLoader label="Loading parents…" hint="Guardians and their linked children" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '1rem',
      }}>
        <div>
          <h2 style={{
            fontSize: '1.65rem', fontWeight: 800, color: '#0F172A',
            letterSpacing: '-0.02em', lineHeight: 1.1,
            fontFamily: "'Outfit', sans-serif", margin: 0,
          }}>
            Parents / Guardians
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            Home / <span style={{ color: '#94A3B8' }}>Parents</span>
          </span>
        </div>

        <button
          type="button"
          onClick={openCreate}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '0.6rem 1.1rem', borderRadius: '10px', border: 'none',
            backgroundColor: '#991b1b', color: '#FFFFFF', fontWeight: 700,
            fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          <Plus size={16} /> Add parent
        </button>
      </div>

      {/* Stats Cards.
          All four now count over every parent the search matches, not over the
          25 on screen — so they share one denominator and the captions no
          longer have to apologise for the three that did not. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
      }}>
        {[
          {
            label: searchTerm ? 'Matching Parents' : 'Total Parents',
            value: totalParents,
            icon: Users, fg: '#4F46E5', bg: '#EEF2FF',
            hint: searchTerm ? `matching “${searchTerm}”` : 'guardians on record',
          },
          {
            label: 'Sibling Groups',
            value: siblingParents,
            icon: Users, fg: '#D97706', bg: '#FEF3C7',
            hint: siblingParents === 0
              ? 'no guardian has two wards'
              : 'guardians with 2+ children',
          },
          {
            label: 'Only Children',
            value: onlyChildParents,
            icon: UserCheck, fg: '#059669', bg: '#ECFDF5',
            hint: 'guardians with one child',
          },
          {
            label: 'Linked Children',
            value: linkedChildren,
            icon: GraduationCap, fg: '#991B1B', bg: '#FEF2F2',
            hint: noChildParents > 0
              ? `${noChildParents.toLocaleString()} guardian${noChildParents === 1 ? '' : 's'} with none`
              : 'every guardian has a ward',
          },
        ].map(({ label, value, icon: Icon, fg, bg, hint }, i) => (
          <div key={label} className="stat-card person-card" style={{ padding: '1.25rem', '--i': i }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                backgroundColor: bg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: fg,
              }}>
                <Icon size={18} />
              </div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}
              </p>
            </div>
            <p style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', fontFamily: "'Outfit', sans-serif", margin: 0 }}>
              {value.toLocaleString()}
            </p>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>
              {hint}
            </p>
          </div>
        ))}
      </div>

      {/* Main Card */}
      <div style={{
        backgroundColor: '#FFFFFF', borderRadius: '16px',
        border: '1px solid #E2E8F0', padding: '1.25rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column', gap: '1.25rem',
      }}>
        <ApiErrorNotice error={pageError} onDismiss={() => setPageError(null)} />

        {/* Search & Filters */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.85rem',
          flexWrap: 'wrap',
        }}>
          {/* The server matches the child's name and registration number as
              well as the parent's own details, so the hint says all five —
              which is more than fits, hence FilterField. */}
          <FilterField
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search by parent name, child name, registration number, email, phone or occupation…"
            style={{ flex: '1 1 280px' }}
            inputStyle={{ padding: '0.5rem 2.2rem 0.5rem 2.2rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.85rem', boxSizing: 'border-box' }}
          />

          <select
            value={childrenCountFilter}
            onChange={(e) => setChildrenCountFilter(e.target.value)}
            style={{
              padding: '0.5rem 0.85rem', borderRadius: '8px',
              border: '1px solid #CBD5E1', fontSize: '0.85rem',
              outline: 'none', backgroundColor: '#FFFFFF',
              color: '#334155', fontWeight: 500, cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {/* Each option carries the institute-wide count, so an option that
                can only ever produce an empty list says so before it is
                chosen — this database has no guardian with two wards, and
                picking "Sibling Groups" simply emptied the page. */}
            <option value="all">All Parents ({totalParents.toLocaleString()})</option>
            <option value="multiple" disabled={siblingParents === 0}>
              Sibling Groups, 2+ children ({siblingParents.toLocaleString()})
            </option>
            <option value="single">Only Child, 1 child ({onlyChildParents.toLocaleString()})</option>
          </select>

          <span style={{
            fontSize: '0.8rem', color: '#64748B', fontWeight: 500,
            marginLeft: 'auto',
          }}>
            {/* This filter narrows the loaded page, so it counts against the
                page rather than against the 2,001 the pager reports. */}
            Showing <strong>{filteredParents.length}</strong>
            {childrenCountFilter !== 'all'
              ? <> of <strong>{parents.length}</strong> on this page</>
              : <> of <strong>{totalParents.toLocaleString()}</strong> parents</>}
          </span>
        </div>

        {/* Parents List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Names the filter actually responsible. "No parents found matching
              your search" was shown even when there was no search — including
              when the sibling dropdown was the cause, which is the case that
              always empties this list in this database. */}
          {filteredParents.length === 0 ? (
            <div style={{
              padding: '3rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.9rem',
              lineHeight: 1.6,
            }}>
              {childrenCountFilter !== 'all' && parents.length > 0 ? (
                <>
                  None of the {parents.length} guardians on this page are{' '}
                  <strong>{childrenCountFilter === 'multiple' ? 'sibling groups' : 'single-child guardians'}</strong>.
                  <br />
                  That filter applies to the loaded page only — try another page, or{' '}
                  <button
                    type="button"
                    onClick={() => setChildrenCountFilter('all')}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#991B1B', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
                  >
                    show all parents
                  </button>.
                </>
              ) : searchTerm ? (
                <>No guardian matches “<strong>{searchTerm}</strong>” by name, child, registration number, email, phone or occupation.</>
              ) : (
                'No parents on record yet. Use “Add parent” above.'
              )}
            </div>
          ) : (
            filteredParents.map((parent, index) => (
              <div
                key={parent.id}
                className="person-card"
                data-expanded={expandedParent === parent.id}
                /* Stagger capped at 12: on a 25-row page the tail would
                   otherwise sit visibly waiting more than a second. */
                style={{ '--i': Math.min(index, 12) }}
              >
                {/* Parent header.
                    A <div> rather than a <button>, because the Edit and Delete
                    controls live inside it and a button cannot contain buttons —
                    nesting them makes the inner ones unreachable by keyboard and
                    is invalid HTML. The row keeps its role and key handler so it
                    is still operable without a mouse. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(parent.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(parent.id);
                    }
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: '1rem', padding: '1rem 1.25rem',
                    border: 'none', background: expandedParent === parent.id ? '#FEF2F2' : 'white',
                    cursor: 'pointer', transition: 'background 0.15s',
                    textAlign: 'left', boxSizing: 'border-box',
                  }}
                >
                  {/* Avatar. A colour derived from the guardian's own id, so a
                      list of twenty-five is twenty-five distinguishable people
                      rather than two repeating pastels. */}
                  <UserAvatar
                    userId={parent.userId}
                    name={parent.name}
                    initials={initialsOf(parent.name)}
                    size={44}
                    shape="rounded"
                    bg={avatarBgOf(parent.id)}
                  />

                  {/* Parent Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <h4 style={{
                        fontSize: '0.95rem', fontWeight: 700, color: '#0F172A',
                        margin: 0,
                      }}>
                        {parent.name}
                      </h4>
                      <span className="badge" style={{
                        backgroundColor: parent.children.length === 0
                          ? '#FEE2E2'
                          : parent.children.length > 1 ? '#FEF3C7' : '#ECFDF5',
                        color: parent.children.length === 0
                          ? '#991B1B'
                          : parent.children.length > 1 ? '#92400E' : '#065F46',
                        fontSize: '0.65rem',
                      }}>
                        {parent.children.length === 0
                          ? 'No ward linked'
                          : `${parent.children.length} ${parent.children.length === 1 ? 'child' : 'children'}`}
                      </span>
                      {/* `occupation` is fetched on every row and is editable in
                          the dialog, but the list never showed it — so an admin
                          could only discover it by opening the edit form. */}
                      {parent.occupation && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontSize: '0.68rem', fontWeight: 700, color: '#475569',
                          backgroundColor: '#F1F5F9', padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                        }}>
                          <Briefcase size={10} /> {parent.occupation}
                        </span>
                      )}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      marginTop: '4px', flexWrap: 'wrap',
                    }}>
                      {/* A guardian with no email or phone rendered an icon
                          followed by nothing at all. Both are nullable columns
                          and an unreachable guardian is worth seeing. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: parent.email ? '#64748B' : '#CBD5E1' }}>
                        <Mail size={12} />
                        {parent.email || 'No email on record'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: parent.phone ? '#64748B' : '#CBD5E1' }}>
                        <Phone size={12} />
                        {parent.phone || 'No phone on record'}
                      </div>
                    </div>
                  </div>

                  {/* Row actions. stopPropagation on each, or clicking Edit
                      would also toggle the panel underneath. */}
                  <div className="person-card__actions" style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEdit(parent); }}
                      title="Edit this parent"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '0.35rem 0.6rem', borderRadius: '8px',
                        border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC',
                        color: '#0F172A', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <Pencil size={13} color="#991b1b" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLinking(parent); setFormError(null); }}
                      title="Link another child to this parent"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '0.35rem 0.6rem', borderRadius: '8px',
                        border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC',
                        color: '#0F172A', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <Link2 size={13} color="#2563EB" /> Link child
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(parent); }}
                      title={parent.children.length
                        ? 'Children are still linked — the server will refuse and name them'
                        : 'Delete this parent'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '0.35rem 0.6rem', borderRadius: '8px',
                        border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2',
                        color: '#DC2626', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>

                  {/* Expand indicator. One chevron that rotates, rather than
                      two swapped on state — the rotation is the affordance. */}
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: expandedParent === parent.id ? '#FEE2E2' : '#F1F5F9',
                    transition: 'background-color 0.2s',
                    flexShrink: 0,
                  }}>
                    <ChevronRight
                      className="person-chevron"
                      size={16}
                      color={expandedParent === parent.id ? '#991B1B' : '#64748B'}
                    />
                  </div>
                </div>

                {/* Expanded Children Panel */}
                {expandedParent === parent.id && (
                  <div className="person-card__panel"><div style={{
                    borderTop: '1px solid #FEE2E2',
                    padding: '1rem 1.25rem',
                    backgroundColor: '#FFFBFA',
                  }}>
                    <p style={{
                      fontSize: '0.78rem', fontWeight: 700, color: '#991B1B',
                      margin: '0 0 0.75rem', textTransform: 'uppercase',
                      letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                      <GraduationCap size={14} />
                      {/* Read "1 Child Enrolled" for a guardian with none,
                          because the test was `> 1` with no zero branch. */}
                      {parent.children.length === 0
                        ? 'No Children Enrolled'
                        : parent.children.length === 1
                          ? '1 Child Enrolled'
                          : `${parent.children.length} Children Enrolled`}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {parent.children.map((child, i) => (
                        <div
                          key={child.id}
                          className="person-subrow"
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.85rem',
                            padding: '0.75rem 1rem', borderRadius: '10px',
                            backgroundColor: '#FFFFFF',
                            border: '1px solid #F1F5F9',
                            '--i': i,
                          }}
                        >
                          {/* Student avatar. `child.avatarBg` and
                              `child.initials` were read here and neither has
                              ever been sent by the API, so every sibling got
                              the same fallback indigo. Derived from the
                              student's id, like every other roster. */}
                          <UserAvatar
                            userId={child.userId}
                            name={child.name}
                            initials={initialsOf(child.name)}
                            size={36}
                            bg={avatarBgOf(child.id)}
                          />

                          {/* Student details */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '0.5rem',
                              flexWrap: 'wrap',
                            }}>
                              <span style={{
                                fontSize: '0.88rem', fontWeight: 700, color: '#0F172A',
                                cursor: 'pointer',
                              }}
                                onClick={() => viewStudentProfile(child.id)}
                                title="View Student Profile"
                              >
                                {child.name}
                              </span>
                              <span className="badge badge-neutral" style={{ fontSize: '0.6rem' }}>
                                {child.regNo}
                              </span>
                            </div>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '0.75rem',
                              marginTop: '3px', flexWrap: 'wrap',
                            }}>
                              <span style={{ fontSize: '0.75rem', color: child.program ? '#64748B' : '#CBD5E1', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <BookOpen size={11} />
                                {child.program || 'No programme'}
                              </span>
                              {/* GET /api/admin/parents resolves each child's
                                  programme but not their batch, so this printed
                                  a bare "Batch:" with nothing after it. The
                                  relationship is what this row was missing and
                                  what the link/unlink controls now change. */}
                              <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                                {child.relationship || 'Guardian'}
                              </span>
                              <span className="badge" style={{
                                backgroundColor: child.status === 'Active' ? '#D1FAE5' : '#FEE2E2',
                                color: child.status === 'Active' ? '#065F46' : '#991B1B',
                                fontSize: '0.6rem',
                              }}>
                                {child.status}
                              </span>
                              <button
                                onClick={() => viewStudentProfile(child.id)}
                                style={{
                                  background: 'none', border: 'none', color: '#6366F1',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                                  gap: '3px', fontSize: '0.72rem', fontWeight: 600,
                                  marginLeft: 'auto', padding: '2px 6px',
                                  borderRadius: '6px',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#EEF2FF'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Eye size={13} />
                                Profile
                              </button>

                              {/* Removing a wrong guardian link — the thing this
                                  screen could never do. A real DELETE on
                                  student_guardians (the table has no is_deleted
                                  column); the audit log records who removed it. */}
                              <button
                                onClick={() => unlinkChild(parent, child)}
                                title={`Unlink ${child.name} from ${parent.name}`}
                                style={{
                                  background: 'none', border: 'none', color: '#DC2626',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                                  gap: '3px', fontSize: '0.72rem', fontWeight: 600,
                                  padding: '2px 6px', borderRadius: '6px',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                              >
                                <Unlink size={13} />
                                Unlink
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {parent.children.length === 0 && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.65rem',
                        padding: '0.9rem 1rem', borderRadius: '10px',
                        backgroundColor: '#FFFFFF', border: '1px dashed #FCA5A5',
                      }}>
                        <UserX size={16} color="#DC2626" style={{ flexShrink: 0 }} />
                        <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
                          No children linked. Use <strong>Link child</strong> above — a
                          guardian with no ward signs in to an empty parent portal.
                        </p>
                      </div>
                    )}
                  </div></div>
                )}
              </div>
            ))
          )}
        </div>

        {/* The list is served a page at a time, so it needs a pager. There
            was none before because every parent in the institute was already in
            the browser. Now the same control as every other list, including the
            jump box — 2,000 parents at 25 a page is 80 pages. */}
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          limit={pagination.limit}
          count={filteredParents.length}
          onChange={setPage}
          noun="parent"
          loading={loading}
        />
      </div>

      {/* ── Create / edit a parent ── */}
      <Modal
        open={!!editing}
        title={editing?.row ? `Edit ${editing.row.name}` : 'Add a parent'}
        icon={editing?.row ? Pencil : Users}
        onClose={closeForm}
      >
        <form onSubmit={saveParent} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ApiErrorNotice error={formError} />

          {/* Create only; the draft is not enabled for an edit. */}
          {!editing?.row && (
            <DraftNotice draft={parentDraft} online={online} onDiscard={() => setForm(EMPTY_PARENT)} />
          )}

          {!editing?.row && (
            <div style={{
              padding: '0.6rem 0.85rem', borderRadius: '8px',
              backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE',
              color: '#5B21B6', fontSize: '0.78rem', lineHeight: 1.5,
            }}>
              The parent's login is created automatically and the password is shown
              once, straight after saving. Leave the email blank to have one
              allocated. If the address already belongs to a parent, link the child
              to that account instead — a second account would leave them seeing
              only one of their children.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={modalLabel}>First name *</label>
              <input
                style={modalInput}
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required={!editing?.row}
              />
            </div>
            <div>
              <label style={modalLabel}>Last name *</label>
              <input
                style={modalInput}
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required={!editing?.row}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={modalLabel}>Email</label>
              <input
                type="email"
                style={modalInput}
                placeholder={editing?.row ? '' : 'Leave blank to generate one'}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label style={modalLabel}>Phone</label>
              <input
                style={modalInput}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label style={modalLabel}>Occupation</label>
            <input
              style={modalInput}
              value={form.occupation}
              onChange={(e) => setForm({ ...form, occupation: e.target.value })}
            />
          </div>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={closeForm} style={modalGhostBtn}>Cancel</button>
          <button
            type="button"
            onClick={saveParent}
            disabled={saving}
            style={{ ...modalPrimaryBtn, opacity: saving ? 0.7 : 1 }}
          >
            <Save size={15} /> {saving ? 'Saving…' : editing?.row ? 'Save changes' : 'Create parent'}
          </button>
        </div>
      </Modal>

      {/* ── Link a child ── */}
      <Modal
        open={!!linking}
        title={`Link a child to ${linking?.name || ''}`}
        icon={Link2}
        onClose={() => { setLinking(null); setChildQuery(''); setFormError(null); }}
      >
        <form onSubmit={linkChild} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ApiErrorNotice error={formError} />

          <div>
            <label style={modalLabel}>Find the student</label>
            {/* A type-ahead against the server, not a dropdown: there are two
                thousand students and scrolling a <select> that long to find one
                is unusable. */}
            <FilterField
              value={childQuery}
              onChange={(v) => { setChildQuery(v); setLinkForm((f) => ({ ...f, student_id: '' })); }}
              placeholder="Type at least two characters of a name or registration number…"
            />
          </div>

          {childQuery.trim().length > 1 && (
            <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              {childCandidates.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: '#94A3B8', padding: '0.85rem', margin: 0 }}>
                  No students match that.
                </p>
              ) : childCandidates.map((s) => {
                const chosen = String(linkForm.student_id) === String(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setLinkForm((f) => ({ ...f, student_id: s.id }))}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '0.6rem 0.85rem', border: 'none', cursor: 'pointer',
                      borderBottom: '1px solid #F1F5F9',
                      backgroundColor: chosen ? '#FEF2F2' : '#FFFFFF',
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>{s.name}</span>
                    <span style={{ fontSize: '0.75rem', color: '#64748B', marginLeft: '8px' }}>
                      {s.regNo} · {s.program || '—'} · {s.batch || '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <label style={modalLabel}>Relationship</label>
            <select
              style={modalInput}
              value={linkForm.relationship}
              onChange={(e) => setLinkForm((f) => ({ ...f, relationship: e.target.value }))}
            >
              {/* The enum on student_guardians.relationship — nothing else is
                  storable in that column. */}
              {['Father', 'Mother', 'Guardian'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
            A student may have more than one guardian and a guardian more than one
            student, so this adds a link rather than replacing an existing one.
          </p>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            onClick={() => { setLinking(null); setChildQuery(''); setFormError(null); }}
            style={modalGhostBtn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={linkChild}
            disabled={saving || !linkForm.student_id}
            style={{ ...modalPrimaryBtn, opacity: (saving || !linkForm.student_id) ? 0.5 : 1 }}
          >
            <Link2 size={15} /> Link child
          </button>
        </div>
      </Modal>

      {/* ── Delete a parent ── */}
      <Modal
        open={!!confirmDelete}
        title="Delete this parent?"
        icon={AlertTriangle}
        onClose={() => setConfirmDelete(null)}
        onBackdropClose={() => setConfirmDelete(null)}
        width="470px"
      >
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          <strong>{confirmDelete?.name}</strong> will be
          removed and their login disabled.
        </p>

        {confirmDelete?.children?.length > 0 && (
          <div style={{
            marginTop: '0.85rem', padding: '0.7rem 0.9rem', borderRadius: '8px',
            backgroundColor: '#FFFBEB', border: '1px solid #FDE68A',
            color: '#92400E', fontSize: '0.8rem', lineHeight: 1.5,
          }}>
            This will be <strong>refused</strong>: they are still the guardian of{' '}
            {confirmDelete.children.length === 1 ? '1 student' : `${confirmDelete.children.length} students`} —{' '}
            {confirmDelete.children.map((c) => c.name).join(', ')}. Unlink them first,
            so no student is left with no guardian on record by accident.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setConfirmDelete(null)} style={modalGhostBtn}>Cancel</button>
          <button
            type="button"
            onClick={removeParent}
            style={{ ...modalPrimaryBtn, backgroundColor: '#DC2626' }}
          >
            <Trash2 size={15} /> Delete parent
          </button>
        </div>
      </Modal>

      <CredentialsDialog result={credentials} onClose={() => setCredentials(null)} />
    </div>
  );
}

const modalLabel = {
  fontSize: '0.75rem', fontWeight: 700, color: '#334155',
  display: 'block', marginBottom: '4px',
};

const modalInput = {
  width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px',
  border: '1px solid #CBD5E1', fontSize: '0.875rem', outline: 'none',
  boxSizing: 'border-box', backgroundColor: '#FFFFFF', fontFamily: "'Inter', sans-serif",
};

const modalGhostBtn = {
  padding: '0.6rem 1.2rem', borderRadius: '8px', border: '1px solid #CBD5E1',
  backgroundColor: '#FFFFFF', color: '#475569', fontWeight: 700,
  fontSize: '0.85rem', cursor: 'pointer',
};

const modalPrimaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '0.6rem 1.3rem', borderRadius: '8px', border: 'none',
  backgroundColor: '#991b1b', color: '#FFFFFF', fontWeight: 700,
  fontSize: '0.85rem', cursor: 'pointer',
};
