import { useMemo, useState } from 'react';
import { useServerQuery } from '../../hooks/useAdminPage';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import { Plus } from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import Pagination from '../../components/faculty/Pagination.jsx';
import Modal from '../../components/faculty/Modal.jsx';
import { useToast } from '../../components/faculty/Toast.jsx';
import { announcements as announcementsApi } from '../../api/endpoints';
import './Announcements.css';

/*
 * Announcements, from the real `announcements` table.
 *
 * This page used to hold ten hardcoded rows ("Mid-Term Exam Schedule
 * Released", "Lab Closed This Friday", …) in component state. Creating or
 * editing one only pushed into that array, so every announcement a teacher
 * wrote disappeared on refresh and no student ever saw it.
 *
 * It now reads and writes GET/POST/PUT /api/announcements. A teacher sees the
 * notices addressed to Teachers or to everyone — that filtering is applied
 * server-side from their token, not here.
 *
 * Two columns the old table showed do not exist in the schema and are gone:
 *  - "Status" (Published/Draft): an announcement row is published by existing;
 *    there is no draft state to store.
 *  - "Target Class" (CS-301 Sec A …): the column is `target_role`, an audience
 *    such as Student or Teacher, not a class section.
 */

// Values `announcements.target_role` actually holds, plus the catch-all.
const AUDIENCES = ['All', 'Student', 'Teacher', 'Parent', 'HR'];
const ALL_AUDIENCES = 'All Audiences';
const PAGE_SIZE = 6;

const EMPTY_FORM = { title: '', content: '', target_role: 'Student' };

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function Announcements() {
  const showToast = useToast();

  /*
   * Shared with the parent notifications view and the student dashboard, which
   * read the same feed at smaller limits. Keyed by the limit, so those stay
   * genuinely different requests rather than one overwriting another.
   */
  const announcementsQuery = useServerQuery(
    () => announcementsApi.list({ limit: 100 }), {}, { key: 'announcements-100' },
  );

  const announcements = Array.isArray(announcementsQuery.data?.data)
    ? announcementsQuery.data.data
    : [];
  const loading = announcementsQuery.loading;
  const error = announcementsQuery.error;
  const load = announcementsQuery.refresh;

  const [audience, setAudience] = useState(ALL_AUDIENCES);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const online = useOnlineStatus();

  /*
   * A half-written announcement survives a crash or a refresh. The key
   * separates a new notice from an edit, so editing one cannot resurrect a
   * draft meant for another.
   */
  const draft = useDraft(
    editing?.announcement_id
      ? `faculty.announcement.${editing.announcement_id}`
      : 'faculty.announcement.new',
    form,
    {
      enabled: formOpen,
      onRestore: setForm,
      isEmpty: (value) => !value?.title?.trim() && !value?.content?.trim(),
    },
  );


  const filtered = useMemo(
    () => (audience === ALL_AUDIENCES
      ? announcements
      : announcements.filter((a) => a.target_role === audience)),
    [announcements, audience],
  );

  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  // The dropdown offers only audiences present in what came back, so it can
  // never filter down to an empty list.
  const audienceOptions = useMemo(
    () => [ALL_AUDIENCES, ...[...new Set(announcements.map((a) => a.target_role).filter(Boolean))].sort()],
    [announcements],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (a) => {
    setEditing(a);
    setForm({
      title: a.title || '',
      content: a.content || '',
      target_role: a.target_role || 'Student',
    });
    setFormOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        target_role: form.target_role,
      };

      if (editing) {
        await announcementsApi.update(editing.announcement_id, payload);
        showToast('Announcement updated');
      } else {
        await announcementsApi.create(payload);
        showToast('Announcement published');
      }

      // The local copy is only dropped once the server has it.
      draft.clear();
      setFormOpen(false);
      // Re-read rather than patching local state, so what is shown is what the
      // database actually stored.
      await load();
      setPage(1);
    } catch (err) {
      showToast(err.message || 'Could not save the announcement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="Announcements">
      <div className="ann-top-row">
        <div className="filters-row" style={{ marginBottom: 0 }}>
          <div className="filter-field">
            <label>Audience</label>
            <select
              value={audience}
              onChange={(e) => { setAudience(e.target.value); setPage(1); }}
            >
              {audienceOptions.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> Create Announcement
        </button>
      </div>

      <div className="ann-table">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Date</th>
              <th>Audience</th>
              <th>Posted By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 0' }}>
                  Loading announcements…
                </td>
              </tr>
            )}

            {!loading && error && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--danger, #d1373f)', padding: '30px 0' }}>
                  Could not load announcements: {error}
                </td>
              </tr>
            )}

            {!loading && !error && pageItems.map((a) => (
              <tr key={a.announcement_id}>
                <td className="ann-title" title={a.content}>{a.title}</td>
                <td>{formatDate(a.created_at)}</td>
                <td>
                  <span className="badge badge-neutral">{a.target_role}</span>
                </td>
                <td>{a.posted_by_name || a.posted_by_role || '—'}</td>
                <td>
                  <button className="ann-edit-btn" onClick={() => openEdit(a)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}

            {!loading && !error && pageItems.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 0' }}>
                  {announcements.length === 0
                    ? 'No announcements have been published yet.'
                    : 'No announcements match this filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          currentPage={page}
          totalItems={filtered.length}
          itemsPerPage={pageSize}
          onPageChange={setPage}
          pageSizes={[10, 25, 50, 100]}
          onPageSizeChange={setPageSize}
        />
      </div>

      {formOpen && (
        <Modal
          title={editing ? 'Edit Announcement' : 'Create Announcement'}
          subtitle={editing ? 'Update this announcement' : 'Publish a new update'}
          onClose={() => setFormOpen(false)}
        >
          <form onSubmit={handleSubmit}>
            <DraftNotice draft={draft} online={online} onDiscard={() => setForm(EMPTY_FORM)} />
            <div className="modal-field">
              <label>Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))}
                placeholder="e.g. Quiz #3 postponed to Monday"
                maxLength={150}
                required
              />
            </div>
            <div className="modal-field">
              <label>Audience</label>
              <select
                value={form.target_role}
                onChange={(e) => setForm((v) => ({ ...v, target_role: e.target.value }))}
              >
                {AUDIENCES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="modal-field">
              <label>Message</label>
              <textarea
                rows={5}
                value={form.content}
                onChange={(e) => setForm((v) => ({ ...v, content: e.target.value }))}
                placeholder="What do you want to tell them?"
                required
              />
            </div>
            <div className="modal-footer" style={{ padding: 0, border: 'none', marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Publish'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
