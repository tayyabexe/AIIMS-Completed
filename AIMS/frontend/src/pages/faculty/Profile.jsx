import { useState } from 'react';
import { useServerQuery } from '../../hooks/useAdminPage';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import { Hash, Building2, Mail, Phone, Pencil, Lock, ShieldCheck, BriefcaseBusiness, Camera } from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import Avatar from '../../components/faculty/Avatar.jsx';
import AvatarUploader from '../../components/common/AvatarUploader';
import useAvatarActions from '../../hooks/useAvatarActions';
import useAuthedImage from '../../hooks/useAuthedImage';
import Modal from '../../components/faculty/Modal.jsx';
import { useToast } from '../../components/faculty/Toast.jsx';
import DataGate from '../../components/faculty/DataState.jsx';
import { useAuth, ROLE_LABELS } from '../../context/FacultyAuthContext.jsx';
import { faculty as facultyApi, auth as authApi } from '../../api/endpoints';
import { fmtDateShort } from '../../utils/helpers.js';
import './Profile.css';

/*
 * The signed-in teacher's own record, from GET /api/faculty/profile.
 *
 * What changed and why
 * --------------------
 * This screen used to be almost entirely invented. The header block read from
 * FacultyAuthContext, which carries only id/name/email/role, so Department and
 * Phone always rendered as "—". "Assigned Subjects" filtered the subject list
 * by `s.teacherId === user.id`, comparing a teachers.teacher_id against a
 * users.user_id — two different id spaces — so the panel was empty for every
 * teacher regardless of their timetable. And the whole "Academic Information"
 * panel was a literal array: Spring 2026, 2019, "PhD (Computer Science)",
 * "Machine Learning & AI", "CS Block, Room 312", identical for everyone.
 *
 * Editing was the same story: "Save Changes" set React state and raised a
 * toast, and "Change Password" validated the form and then did nothing at all.
 * Both now go to the API.
 *
 * Qualification is gone rather than rewired: there is no column for it
 * anywhere in the schema, so nothing could fill it honestly.
 */

const dash = (value) => (value === null || value === undefined || value === '' ? '—' : value);

export default function Profile() {
  const showToast = useToast();
  const { user } = useAuth();

  /*
   * The teacher's own record, cached under one key.
   *
   * The `mounted` ref that guarded every setState here is gone with the fetch
   * it guarded. It had to be RAISED on mount as well as lowered on unmount,
   * because StrictMode's double-invoke otherwise left it false for good and
   * the screen sat on its spinner with the response already in hand. There is
   * no flag to strand now — an unmounted observer is simply dropped.
   */
  const profileQuery = useServerQuery(
    () => facultyApi.profile(), {}, { key: 'faculty-profile' },
  );

  const profile = profileQuery.data?.data || null;
  const loading = profileQuery.loading;
  const error = profileQuery.error;
  const load = profileQuery.refresh;

  // --- edit -----------------------------------------------------------------
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ email: '', phone: '', specialization: '' });
  const online = useOnlineStatus();

  /*
   * The contact-detail edit survives a crash or a refresh.
   *
   * Note what is NOT drafted: the password form below. A password written to
   * localStorage sits in plaintext on disk and outlives the form, which is
   * never an acceptable trade for saving someone a retype.
   */
  const profileDraft = useDraft('faculty.profile.edit', editForm, {
    enabled: editOpen,
    onRestore: setEditForm,
    isEmpty: (value) => !value?.email && !value?.phone && !value?.specialization,
  });
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  const openEdit = () => {
    setEditForm({
      email: profile?.email || '',
      phone: profile?.phone || '',
      specialization: profile?.specialization || '',
    });
    setEditError('');
    setEditOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setEditError('');

    try {
      const res = await facultyApi.updateProfile(editForm);
      if (res?.data) setProfile(res.data);
      profileDraft.clear();
      setEditOpen(false);
      showToast('Profile updated successfully');
    } catch (err) {
      setEditError(err.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  // --- password -------------------------------------------------------------
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();

    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      setPwError('Please fill in all fields.');
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError('New password and confirmation do not match.');
      return;
    }

    setChangingPw(true);
    setPwError('');

    try {
      // PUT /api/auth/change-password. The form used to validate itself and
      // then close, so the password was never actually changed.
      await authApi.changePassword(pwForm.current, pwForm.next);
      setPwOpen(false);
      setPwForm({ current: '', next: '', confirm: '' });
      showToast('Password changed successfully');
    } catch (err) {
      setPwError(err.message);
    } finally {
      if (mounted.current) setChangingPw(false);
    }
  };

  /*
   * The picture controls. `useAvatarActions` owns the two API calls and the
   * cache eviction, so a teacher's new portrait replaces the old one on the
   * class rosters and the top bar too, not only on this card.
   *
   * `reload` is passed as onDone so the page re-reads its own profile; the
   * avatar itself is re-fetched because its cache entry has just been dropped.
   */
  const avatarUrl = useAuthedImage(
    profile?.user_id ? `/api/users/${profile.user_id}/avatar` : null,
  ).url;

  const { upload, remove } = useAvatarActions(profile?.user_id, { onDone: load });

  const [pickerOpen, setPickerOpen] = useState(false);

  if (loading || error || !profile) {
    return (
      <Layout title="Profile">
        <DataGate
          loading={loading}
          error={error || (!profile ? 'No teacher record is linked to this account.' : null)}
          onRetry={load}
          label="Loading your profile…"
        />
      </Layout>
    );
  }

  const semester = profile.current_semester;

  // Only facts this schema can answer. A field with nothing behind it is left
  // out of the panel rather than filled with a plausible-looking value.
  const academic = [
    {
      label: 'Current Semester',
      value: semester
        ? `Semester ${semester.semester_number}${semester.program_name ? ` · ${semester.program_name}` : ''}`
        : 'No semester is running today',
    },
    { label: 'Total Students', value: String(profile.total_students) },
    { label: 'Classes Taught', value: `${profile.class_count} (${profile.subject_count} subjects)` },
    {
      label: 'Joined',
      value: profile.joined_on
        ? `${fmtDateShort(profile.joined_on)}${profile.experience_years !== null ? ` · ${profile.experience_years} yr` : ''}`
        : '—',
    },
    { label: 'Specialization', value: dash(profile.specialization) },
    { label: 'Rooms', value: profile.rooms.length ? profile.rooms.join(' · ') : '—' },
  ];

  return (
    <Layout title="Profile">
      <div className="profile-grid">
        <div className="profile-card">
          {/*
            The faculty portal had NO way to set a profile picture. Not a
            broken one — none at all: this was a plain <Avatar>, so a teacher
            could see everyone else's photograph and never their own, and the
            only accounts with a picture were the ones an admin had seeded.

            The button is an overlay on the portrait rather than a row beneath
            it, because the picture is what it acts on.
          */}
          <div className="profile-avatar-wrap avu-editable">
            <Avatar name={profile.full_name} size={96} className="profile-avatar" userId={profile.user_id} />
            {profile.employment_status === 'Active' && <span className="profile-status-dot" />}
            <button
              type="button"
              className="avu-edit-badge"
              onClick={() => setPickerOpen(true)}
              aria-label="Change your profile picture"
              title="Change picture"
            >
              <Camera size={14} />
            </button>
          </div>
          <div className="profile-name">{dash(profile.full_name)}</div>
          <div className="profile-role">{dash(profile.designation)}</div>
          <div style={{ marginTop: 8 }}>
            <span className="badge badge-info">
              <ShieldCheck size={13} style={{ verticalAlign: -2 }} /> {ROLE_LABELS[user?.role] || user?.role}
            </span>
          </div>

          <div className="profile-info-row">
            <div className="profile-info-icon"><Hash size={16} /></div>
            <div>
              <div className="profile-info-label">Employee ID</div>
              {/* employees.employee_code — the id the institute actually uses.
                  This used to print the users.user_id. */}
              <div className="profile-info-value">{dash(profile.employee_code)}</div>
            </div>
          </div>
          <div className="profile-info-row">
            <div className="profile-info-icon"><Building2 size={16} /></div>
            <div>
              <div className="profile-info-label">Department</div>
              <div className="profile-info-value">{dash(profile.department_name)}</div>
            </div>
          </div>
          <div className="profile-info-row">
            <div className="profile-info-icon"><BriefcaseBusiness size={16} /></div>
            <div>
              <div className="profile-info-label">Employment Status</div>
              <div className="profile-info-value">{dash(profile.employment_status)}</div>
            </div>
          </div>
          <div className="profile-info-row">
            <div className="profile-info-icon"><Mail size={16} /></div>
            <div>
              <div className="profile-info-label">Email</div>
              <div className="profile-info-value">{dash(profile.email)}</div>
            </div>
          </div>
          <div className="profile-info-row">
            <div className="profile-info-icon"><Phone size={16} /></div>
            <div>
              <div className="profile-info-label">Phone</div>
              <div className="profile-info-value">{dash(profile.phone)}</div>
            </div>
          </div>

          <div className="profile-actions">
            <button className="btn btn-primary" onClick={openEdit}>
              <Pencil size={15} /> Edit Profile
            </button>
            <button className="btn btn-outline" onClick={() => setPwOpen(true)}>
              <Lock size={15} /> Change Password
            </button>
          </div>
          <p className="profile-note">
            Name, designation and department are HR records assigned by the Admin.
          </p>
        </div>

        <div className="profile-right">
          <div className="panel profile-panel">
            <h3>Assigned Subjects</h3>
            {profile.subjects.length === 0 ? (
              <p className="profile-note">No subjects assigned yet. Admin assigns subjects to teachers.</p>
            ) : (
              <div className="subjects-grid">
                {profile.subjects.map((s) => (
                  <div className="subject-mini-card" key={`${s.subject_id}-${s.section_id}`}>
                    <span
                      className="subject-mini-code"
                      style={{ background: 'var(--info-bg)', color: 'var(--info-text)' }}
                    >
                      {s.subject_code}
                    </span>
                    <div className="subject-mini-title">{s.subject_name}</div>
                    <div className="subject-mini-meta">
                      Section {s.section_name} · {s.student_count} students
                      {s.credit_hours ? ` · ${s.credit_hours} CH` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel profile-panel">
            <h3>Academic Information</h3>
            <div className="academic-grid">
              {academic.map((a) => (
                <div className="academic-mini-card" key={a.label}>
                  <div className="academic-mini-label">{a.label}</div>
                  <div className="academic-mini-value">{a.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editOpen && (
        <Modal
          title="Edit Profile"
          subtitle="Your contact details and specialization"
          onClose={() => setEditOpen(false)}
        >
          <form onSubmit={handleEditSubmit}>
            <DraftNotice draft={profileDraft} online={online} />
            {/* Read-only, because they are: these live on the employees table
                and only an Admin may change them. The form used to accept
                edits to all three and drop them on save. */}
            <div className="modal-field">
              <label>Full Name</label>
              <input type="text" value={profile.full_name || ''} disabled />
            </div>
            <div className="modal-row-2">
              <div className="modal-field">
                <label>Designation</label>
                <input type="text" value={profile.designation || ''} disabled />
              </div>
              <div className="modal-field">
                <label>Department</label>
                <input type="text" value={profile.department_name || ''} disabled />
              </div>
            </div>
            <div className="modal-field">
              <label>Email</label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((v) => ({ ...v, email: e.target.value }))}
                required
              />
            </div>
            <div className="modal-row-2">
              <div className="modal-field">
                <label>Phone</label>
                <input
                  type="text"
                  maxLength={20}
                  value={editForm.phone}
                  onChange={(e) => setEditForm((v) => ({ ...v, phone: e.target.value }))}
                />
              </div>
              <div className="modal-field">
                <label>Specialization</label>
                <input
                  type="text"
                  maxLength={150}
                  value={editForm.specialization}
                  onChange={(e) => setEditForm((v) => ({ ...v, specialization: e.target.value }))}
                  placeholder="e.g. Machine Learning"
                />
              </div>
            </div>
            {editError && (
              <div style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 13, fontWeight: 600, padding: '10px 12px', borderRadius: 8, marginBottom: 14 }}>
                {editError}
              </div>
            )}
            <div className="modal-footer" style={{ padding: 0, border: 'none', marginTop: 4 }}>
              <button type="button" className="btn btn-outline" onClick={() => setEditOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pwOpen && (
        <Modal
          title="Change Password"
          subtitle="Choose a new password for your account"
          onClose={() => { setPwOpen(false); setPwError(''); }}
        >
          <form onSubmit={handlePasswordSubmit}>
            <div className="modal-field">
              <label>Current Password</label>
              <input type="password" value={pwForm.current} onChange={(e) => setPwForm((v) => ({ ...v, current: e.target.value }))} required />
            </div>
            <div className="modal-field">
              <label>New Password</label>
              <input type="password" value={pwForm.next} onChange={(e) => setPwForm((v) => ({ ...v, next: e.target.value }))} required />
            </div>
            <div className="modal-field">
              <label>Confirm New Password</label>
              <input type="password" value={pwForm.confirm} onChange={(e) => setPwForm((v) => ({ ...v, confirm: e.target.value }))} required />
            </div>
            {pwError && (
              <div style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 13, fontWeight: 600, padding: '10px 12px', borderRadius: 8, marginBottom: 14 }}>
                {pwError}
              </div>
            )}
            <div className="modal-footer" style={{ padding: 0, border: 'none', marginTop: 4 }}>
              <button type="button" className="btn btn-outline" onClick={() => { setPwOpen(false); setPwError(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={changingPw}>
                {changingPw ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      <AvatarUploader
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentUrl={avatarUrl}
        name={profile?.full_name}
        onUpload={upload}
        onRemove={avatarUrl ? remove : undefined}
      />
    </Layout>
  );
}
