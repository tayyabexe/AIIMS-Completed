import { useState, useEffect } from 'react';
import { teachers as teachersApi, admin as adminApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import useScrollLock from '../../hooks/useScrollLock';
import Pagination from '../common/Pagination';
import FilterField from '../common/FilterField';
import RouteLoader from '../common/RouteLoader';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../common/DraftNotice';
import CredentialsDialog from './CredentialsDialog';
import { GraduationCap, BookOpen, Users, Mail, Award, ChevronDown, ChevronRight, X, BookMarked, Layers, Pencil, Save, Plus, Trash2, AlertTriangle, Clock, CalendarDays } from 'lucide-react';

const departmentColors = {
  'Computer Science': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Electronics': { bg: '#F3E8FF', text: '#9333EA', border: '#D8B4FE' },
  'Mechanical': { bg: '#FFF7ED', text: '#EA580C', border: '#FDBA74' },
  'Biotechnology': { bg: '#ECFDF5', text: '#059669', border: '#6EE7B7' },
  'Mathematics': { bg: '#FEF3C7', text: '#D97706', border: '#FCD34D' },
  'Civil Engineering': { bg: '#F0FDF4', text: '#16A34A', border: '#86EFAC' },
  'Chemistry': { bg: '#FDF2F8', text: '#DB2777', border: '#F9A8D4' },
  'Physics': { bg: '#F8FAFC', text: '#475569', border: '#CBD5E1' },
};

export default function FacultyView() {
  const [teachersList, setTeachersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editFormData, setEditFormData] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [deleteConfirmTeacher, setDeleteConfirmTeacher] = useState(null);

  // Departments come from the database so the dropdown offers real values and
  // the form can send the department_id the API expects.
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);

  const departmentIdFor = (name) =>
    departments.find((d) => d.department_name === name)?.department_id ?? null;

  /*
   * The onboarding form.
   *
   * `password` is deliberately gone. The admin used to type one, which meant
   * the person creating the account permanently knew the teacher's credential.
   * The server generates it now, shows it once, and forces the teacher to
   * replace it at first sign-in.
   *
   * `email` is optional: left blank, the server allocates one in the
   * institute's own firstname.lastname@aims.edu.pk format.
   */
  const EMPTY_TEACHER = {
    name: '',
    department: '',
    designation: 'Assistant Professor',
    specialization: '',
    email: '',
    phone: '',
    basic_salary: '',
    status: 'Active',
  };

  const [newTeacher, setNewTeacher] = useState(EMPTY_TEACHER);

  // Classes to hand this teacher on day one. Each row becomes a
  // teacher_assignments row and a teacher_subjects row.
  const [assignments, setAssignments] = useState([]);

  // The one-time credentials popup.
  const [credentials, setCredentials] = useState(null);
  const online = useOnlineStatus();

  /*
   * Freeze the directory while any of the three dialogs is open.
   *
   * This screen is where the problem was reported: the edit dialog is a fixed
   * overlay over a still-scrollable page, so turning the wheel moved the
   * teacher list behind the form, and closing the dialog left the reader
   * somewhere they had not chosen to be. CredentialsDialog locks itself, so it
   * is not in this list.
   */
  useScrollLock(!!editFormData || isAddModalOpen || !!deleteConfirmTeacher);

  /*
   * The teacher directory, from GET /api/admin/teachers.
   *
   * This replaces three separate requests — /api/teachers, the teacher-workload
   * summary and /api/departments — that were fetched in parallel and then
   * joined by hand in the browser, building a Map of workload rows keyed by
   * teacher id just to attach a session count to each teacher. That join is one
   * SQL statement now, and it also brings back the subjects each teacher
   * actually teaches, which the old three-way join could not supply: the
   * workload view only counts them.
   */
  const [page, setPage] = useState(1);

  /*
   * The search runs on the SERVER.
   *
   * It used to filter `teachersList` in the browser, and `teachersList` is one
   * page — fifty teachers. So searching for anyone who happened to sort onto
   * page 2 returned nothing and the screen said "No teachers found", which is a
   * different statement from "not on this page" and the reason the box was
   * reported as broken.
   *
   * `q` on GET /api/admin/teachers matches name, department, designation,
   * specialization, email, employee code and course — everything the
   * placeholder promises — across the whole directory, and the pagination below
   * then describes the matches rather than the directory.
   *
   * Debounced because `q` is typed: without it every keystroke is a request.
   * The page resets to 1 whenever the query changes, or narrowing a search
   * while on page 3 lands on an empty page that looks like no matches.
   */
  const { data, loading: pageLoading, error: pageError, refresh } = useAdminPage(
    (p) => adminApi.teachers(p),
    { page, limit: 50, q: searchQuery.trim() || undefined }, { key: 'teachers', debounceMs: 300 });

  useEffect(() => { setPage(1); }, [searchQuery]);

  useEffect(() => {
    if (!data) return;

    setDepartments(data.departments || []);
    setNewTeacher((prev) => (prev.department
      ? prev
      : { ...prev, department: data.departments?.[0]?.department_name || '' }));

    /*
     * Everything GET /api/admin/teachers actually returns.
     *
     * Three fields on this mapping were not data at all:
     *   - `students: null` was rendered as the headline figure beside every
     *     teacher, so each card read "Students / null" and, inside, "null
     *     students". The endpoint has never returned a mentee count;
     *   - `sections: []` was a literal empty array, so every teacher showed
     *     "0 sections" and an "Assigned Sections" card containing an empty
     *     string, while `sectionCount` — 3 for the first teacher — sat unused
     *     one line below;
     *   - `qualification: '—'` was a hardcoded dash filling an info card,
     *     because `employees` has no qualification column.
     *
     * And four real fields were dropped: profilePicture, employeeCode,
     * hireDate and weeklyContactHours. A teacher's photograph is the single
     * most useful thing on a directory card and it was being discarded.
     */
    setTeachersList((data.rows || []).map((t) => ({
      id: t.teacherId,
      userId: t.userId,
      employeeCode: t.employeeCode || null,
      name: t.name || 'Unnamed',
      email: t.email || null,
      photo: t.profilePicture || null,
      department: t.department || null,
      designation: t.designation || null,
      specialization: t.specialization || null,
      hireDate: t.hireDate || null,
      // Real subject records, kept whole — the credit hours were being
      // flattened away into a display string.
      courses: (t.subjects || []).map((s) => ({
        id: s.subjectId,
        code: s.code,
        name: s.name,
        creditHours: s.creditHours,
      })),
      subjectsCount: t.subjectCount ?? 0,
      sectionsCount: t.sectionCount ?? 0,
      weeklySessions: t.weeklySessions ?? 0,
      weeklyHours: t.weeklyContactHours ?? 0,
      status: t.employmentStatus || 'Active',
    })));
  }, [data]);

  useEffect(() => { setLoading(pageLoading); }, [pageLoading]);
  useEffect(() => { if (pageError) setLoadError(pageError); }, [pageError]);

  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 50 };

  // The catalogue the class picker offers, from the same request.
  const catalogue = {
    subjects: data?.subjects ?? [],
    batches: data?.batches ?? [],
    sections: data?.sections ?? [],
  };

  /*
   * The onboarding form survives a refresh or a crash. The class rows are kept
   * with it — losing a carefully built assignment list is exactly the kind of
   * re-typing this is here to prevent.
   */
  const teacherDraft = useDraft('admin.teacher.new', { newTeacher, assignments }, {
    enabled: isAddModalOpen,
    onRestore: (value) => {
      if (value?.newTeacher) setNewTeacher(value.newTeacher);
      if (Array.isArray(value?.assignments)) setAssignments(value.assignments);
    },
    isEmpty: (value) => !value?.newTeacher?.name
      && !value?.newTeacher?.email
      && !value?.newTeacher?.specialization
      && !(value?.assignments || []).length,
  });

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleStartEdit = (teacher, e) => {
    e.stopPropagation();
    setEditFormData({ ...teacher });
  };

  // Saves to the database. Name, department, designation and employment status
  // live on the employees table; specialization lives on teachers. The API
  // routes each field to the right table.
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editFormData) return;

    setSaving(true);
    setLoadError(null);

    const [firstName, ...rest] = String(editFormData.name || '').trim().split(/\s+/);
    const departmentId = departmentIdFor(editFormData.department);

    try {
      const res = await teachersApi.update(editFormData.id, {
        first_name: firstName || undefined,
        last_name: rest.join(' ') || undefined,
        designation: editFormData.designation || undefined,
        specialization: editFormData.specialization || undefined,
        employment_status: editFormData.status || undefined,
        ...(departmentId ? { department_id: departmentId } : {}),
      });

      const saved = res.data || {};

      setTeachersList(prev => prev.map(t => (t.id === editFormData.id
        ? {
            ...t,
            name: saved.full_name || editFormData.name,
            designation: saved.designation || '—',
            specialization: saved.specialization || '—',
            department: saved.department_name || t.department,
            status: saved.employment_status || t.status,
          }
        : t)));

      setEditFormData(null);

    } catch (err) {
      setLoadError(`Could not save changes: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  /*
   * Onboards a teacher through POST /api/admin/teachers/onboard.
   *
   * WHAT CHANGED: the admin no longer types a password.
   *
   * The form used to require the admin to invent one and type it into a box,
   * which meant the person who created the account also knew the credential the
   * teacher would keep using. The server now generates it, hashes it, and
   * returns it once so it can be handed over — and the account is flagged to
   * force the teacher to choose their own on first sign-in.
   *
   * Email is optional here: leave it blank and the server allocates one in the
   * institute's own format (firstname.lastname@aims.edu.pk), the same shape the
   * existing staff accounts already use.
   */
  const handleAddTeacher = async (e) => {
    e.preventDefault();

    const name = newTeacher.name.trim();

    if (!name) {
      setLoadError('A name is required.');
      return;
    }

    const departmentId = departmentIdFor(newTeacher.department);
    if (!departmentId) {
      setLoadError('Please choose a department.');
      return;
    }

    setSaving(true);
    setLoadError(null);

    const [firstName, ...rest] = name.split(/\s+/);

    try {
      const result = await adminApi.onboardTeacher({
        first_name: firstName,
        last_name: rest.join(' ') || firstName,
        email: newTeacher.email.trim() || undefined,
        phone: newTeacher.phone || undefined,
        department_id: departmentId,
        designation: newTeacher.designation,
        specialization: newTeacher.specialization || undefined,
        basic_salary: newTeacher.basic_salary ? Number(newTeacher.basic_salary) : undefined,
        // Each row the admin added in the class picker becomes both a
        // teacher_assignments row and a teacher_subjects row.
        assignments: assignments
          .filter((a) => a.subject_id && a.batch_id)
          .map((a) => ({
            subject_id: Number(a.subject_id),
            batch_id: Number(a.batch_id),
            section_id: a.section_id ? Number(a.section_id) : undefined,
          })),
      });

      teacherDraft.clear();
      setIsAddModalOpen(false);
      setAssignments([]);
      setNewTeacher({
        name: '',
        department: departments[0]?.department_name || '',
        designation: 'Assistant Professor',
        specialization: '',
        email: '',
        phone: '',
        basic_salary: '',
        status: 'Active',
      });

      // The one and only time this password is readable.
      setCredentials(result);
      refresh();

    } catch (err) {
      // The draft is left in place so nothing typed is lost. The message has to
      // be passed on — calling setLoadError() with no argument cleared the
      // banner instead of filling it, so a failed onboarding looked like
      // nothing had happened at all.
      setLoadError(`Could not create this teacher: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeacher = (teacher, e) => {
    e.stopPropagation();
    setDeleteConfirmTeacher(teacher);
  };

  // Soft-deletes on the server, then removes the row locally. Previously this
  // only dropped the row from React state and the record stayed in the DB.
  const handleConfirmDelete = async () => {
    if (!deleteConfirmTeacher) return;

    const target = deleteConfirmTeacher;
    setDeleteConfirmTeacher(null);
    setLoadError(null);

    try {
      await teachersApi.remove(target.id);
      setTeachersList(prev => prev.filter(t => t.id !== target.id));
    } catch (err) {
      /*
       * A refused delete is the useful case, not the exceptional one: the
       * server now declines while the teacher still holds timetable slots and
       * says how many in `blockedBy`. Showing only err.message would still be
       * readable here, but the array is what the other structure screens render
       * as a list, so it is surfaced rather than dropped.
       */
      const blockers = err?.data?.blockedBy;
      setLoadError(blockers?.length
        ? `Could not delete ${target.name}: still in use by ${blockers.join(', ')}.`
        : `Could not delete ${target.name}: ${err.message}`);
    }
  };

  const getInitials = (name) => {
    return name.split(' ').filter(w => w.length > 0 && !w.includes('.')).map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  const generateAvatarColor = (name) => {
    const colors = [
      { bg: '#DC2626', grad: 'from-red-500 to-red-700' },
      { bg: '#2563EB', grad: 'from-blue-500 to-blue-700' },
      { bg: '#059669', grad: 'from-emerald-500 to-emerald-700' },
      { bg: '#D97706', grad: 'from-amber-500 to-amber-700' },
      { bg: '#9333EA', grad: 'from-purple-500 to-purple-700' },
      { bg: '#DB2777', grad: 'from-pink-500 to-pink-700' },
      { bg: '#0891B2', grad: 'from-cyan-500 to-cyan-700' },
      { bg: '#EA580C', grad: 'from-orange-500 to-orange-700' },
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  /*
   * The rows on screen ARE the server's answer — see the `q` comment above.
   * There is deliberately no client-side filter left here: a second filter over
   * a filtered page can only ever remove rows the server already decided
   * matched, and that is what made page 2 unsearchable.
   */
  const filtered = teachersList;

  if (loading) {
    return (
      <RouteLoader
        label="Loading teachers…"
        hint="Directory, departments and real weekly teaching load"
      />
    );
  }

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {loadError && (
        <div style={{
          marginBottom: '1rem', padding: '0.85rem 1rem', borderRadius: '10px',
          backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
          fontSize: '0.875rem',
        }}>
          {loadError}
        </div>
      )}
      {/* Page Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 500 }}>Faculty Management</span>
            <span style={{ color: '#CBD5E1' }}>/</span>
            <span style={{ fontSize: '0.75rem', color: '#0F172A', fontWeight: 600, fontFamily: 'Outfit, sans-serif' }}>All Teachers</span>
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            <GraduationCap size={24} style={{ color: '#DC2626', marginRight: '10px', verticalAlign: 'middle' }} />
            Faculty Directory
          </h1>
          {/* `total` is the directory (or, while searching, the matches) —
              teachersList is only this page, and reading the headline count off
              it made a 28-teacher institute report "28 teachers" whether or not
              a search was narrowing it. */}
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '4px' }}>
            {pagination.total} {searchQuery ? 'matching' : ''} teachers
            {' · '}Across {new Set(teachersList.map(f => f.department)).size} departments on this page
            {' · '}{teachersList.reduce((sum, f) => sum + f.courses.length, 0)} courses offered
          </p>
        </div>

        {/* Search & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* The hint names seven searchable fields and cannot fit in 280px.
              FilterField draws it as a scrollable strip instead of letting the
              browser clip it at "Search by name, departme…". */}
          <FilterField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name, department, designation, specialization, email, employee code or course…"
            style={{ minWidth: '280px' }}
          />

          <button
            onClick={() => setIsAddModalOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '0.65rem 1.1rem', borderRadius: '10px',
              backgroundColor: '#DC2626', color: '#FFFFFF',
              border: 'none', fontWeight: 600, fontSize: '0.88rem',
              cursor: 'pointer', boxShadow: '0 4px 12px rgba(220, 38, 38, 0.25)',
              transition: 'all 0.2s',
            }}
          >
            <Plus size={18} />
            Add Teacher
          </button>
        </div>
      </div>

      {/* Faculty List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '3rem 2rem', backgroundColor: 'white',
            borderRadius: '16px', border: '1px solid #E2E8F0',
          }}>
            <GraduationCap size={48} style={{ color: '#CBD5E1', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#64748B', margin: 0 }}>
              {searchQuery ? `No teachers match “${searchQuery}”` : 'No teachers yet'}
            </h3>
            {/* The search covers the whole directory now, so "no matches" means
                exactly that and no longer needs the "try page 2" caveat. */}
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px' }}>
              {searchQuery
                ? 'Searched across every teacher — name, department, designation, specialization, email, employee code and course.'
                : 'Add a teacher to get started.'}
            </p>
          </div>
        ) : (
          filtered.map((teacher, index) => {
            const isExpanded = expandedId === teacher.id;
            const avatarColor = generateAvatarColor(teacher.name);
            const deptColor = departmentColors[teacher.department] || { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };

            return (
              <div
                key={teacher.id}
                className="person-card"
                data-expanded={isExpanded}
                /* Stagger capped at 12 — this list pages 50 at a time, and an
                   uncapped cascade would leave the last card waiting 2.5s. */
                style={{ '--i': Math.min(index, 12) }}
              >
                {/* Main Row */}
                <div
                  onClick={() => toggleExpand(teacher.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '1rem',
                    padding: '1rem 1.25rem', cursor: 'pointer',
                    background: isExpanded ? '#FEF2F2' : 'white',
                    transition: 'background 0.15s',
                  }}
                >
                  {/* Avatar. The API sends a real profile photograph and this
                      card threw it away in favour of initials — on a directory
                      whose whole purpose is recognising a colleague. Initials
                      remain the fallback, and take over if the file 404s. */}
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '12px',
                    background: `linear-gradient(135deg, ${avatarColor.bg}, ${avatarColor.bg}dd)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 800, fontSize: '0.9rem',
                    flexShrink: 0, boxShadow: `0 4px 12px ${avatarColor.bg}44`,
                    overflow: 'hidden', position: 'relative',
                  }}>
                    {teacher.photo ? (
                      <img
                        src={`/${String(teacher.photo).replace(/^\/+/, '')}`}
                        alt=""
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        style={{
                          position: 'absolute', inset: 0,
                          width: '100%', height: '100%', objectFit: 'cover',
                        }}
                      />
                    ) : null}
                    <span>{getInitials(teacher.name)}</span>
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
                        {teacher.name}
                      </h3>
                      {/* Was `badge-success` regardless of value, so a teacher
                          on leave or retired was styled as Active. */}
                      <span
                        className={`badge ${teacher.status === 'Active' ? 'badge-success' : 'badge-neutral'}`}
                        style={{ fontSize: '0.65rem' }}
                      >
                        {teacher.status}
                      </span>
                      {teacher.employeeCode && (
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 700, color: '#64748B',
                          backgroundColor: '#F1F5F9', padding: '2px 7px', borderRadius: '5px',
                          letterSpacing: '0.02em',
                        }}>
                          {teacher.employeeCode}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: deptColor.text, fontWeight: 500 }}>
                        {teacher.designation || 'No designation'}
                      </span>
                      <span style={{
                        fontSize: '0.75rem', padding: '2px 8px', borderRadius: '6px',
                        backgroundColor: deptColor.bg, color: deptColor.text, fontWeight: 500,
                        border: `1px solid ${deptColor.border}`,
                      }}>
                        {teacher.department || 'No department'}
                      </span>
                      {/* Counted by the server over the teacher's whole
                          timetable, not by measuring an array that was
                          hardcoded empty. */}
                      <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <BookMarked size={13} />
                        {teacher.subjectsCount} {teacher.subjectsCount === 1 ? 'subject' : 'subjects'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Layers size={13} />
                        {teacher.sectionsCount} {teacher.sectionsCount === 1 ? 'section' : 'sections'}
                      </span>
                    </div>
                  </div>

                  {/* Teaching load — the real weekly figure, replacing the
                      "Students / null" tile that stood here. */}
                  <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '86px' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Weekly load
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: teacher.weeklyHours > 0 ? '#DC2626' : '#CBD5E1', lineHeight: 1.2 }}>
                      {teacher.weeklyHours > 0 ? `${teacher.weeklyHours} h` : 'None'}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 500 }}>
                      {teacher.weeklySessions} {teacher.weeklySessions === 1 ? 'session' : 'sessions'}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="person-card__actions" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      onClick={(e) => handleStartEdit(teacher, e)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #CBD5E1',
                        backgroundColor: '#F8FAFC', color: '#0F172A', fontSize: '0.8rem',
                        fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#E2E8F0'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#F8FAFC'}
                    >
                      <Pencil size={14} color="#991b1b" />
                      Edit
                    </button>

                    <button
                      onClick={(e) => handleDeleteTeacher(teacher, e)}
                      title="Delete Teacher"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '0.4rem 0.65rem', borderRadius: '8px', border: '1px solid #FCA5A5',
                        backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: '0.8rem',
                        fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#FEE2E2'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#FEF2F2'}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>

                  {/* Expand Toggle. One chevron that rotates — the rotation
                      carries the state, so nothing swaps under the pointer. */}
                  <div style={{ color: isExpanded ? '#DC2626' : '#94A3B8', transition: 'color 0.2s', display: 'flex' }}>
                    <ChevronRight className="person-chevron" size={20} />
                  </div>
                </div>

                {/* Expanded Details - Courses & Sections */}
                {isExpanded && (
                  <div className="person-card__panel"><div style={{
                    padding: '0 1.25rem 1.25rem 1.25rem',
                    borderTop: '1px solid #F1F5F9',
                  }}>
                    {/* Courses List */}
                    <div style={{ paddingTop: '1rem', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.6rem' }}>
                        <BookOpen size={15} style={{ color: '#059669' }} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0F172A' }}>Courses / Subjects Taught</span>
                        <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>({teacher.courses.length} total)</span>
                      </div>
                      {teacher.courses.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: 0 }}>
                          No subjects assigned — this teacher has nothing on the timetable.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {/* Credit hours come down on every subject and were
                              being dropped when the record was flattened into
                              a "CODE — Name" string. */}
                          {teacher.courses.map((course, i) => (
                            <span
                              key={course.id ?? i}
                              className="person-subrow"
                              style={{
                                padding: '5px 12px', borderRadius: '8px',
                                backgroundColor: '#F0FDF4', color: '#059669',
                                border: '1px solid #BBF7D0',
                                fontSize: '0.78rem', fontWeight: 500,
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                '--i': Math.min(i, 10),
                              }}
                            >
                              <BookOpen size={12} />
                              <strong style={{ fontWeight: 700 }}>{course.code}</strong>
                              {course.name}
                              {course.creditHours != null && (
                                <span style={{
                                  fontSize: '0.68rem', fontWeight: 700, color: '#047857',
                                  backgroundColor: '#DCFCE7', padding: '1px 6px', borderRadius: '5px',
                                }}>
                                  {course.creditHours} cr
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Info Cards */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '0.75rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#F8FAFC', borderRadius: '10px' }}>
                        <Layers size={16} style={{ color: '#D97706', flexShrink: 0 }} />
                        <div>
                          {/* `sections` was a hardcoded [], so this card
                              printed an empty string. `sectionCount` is the
                              server's own count over the timetable. */}
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>Sections Assigned</div>
                          <div style={{ fontSize: '0.85rem', color: '#0F172A', fontWeight: 600 }}>
                            {teacher.sectionsCount === 0
                              ? 'None assigned'
                              : `${teacher.sectionsCount} ${teacher.sectionsCount === 1 ? 'section' : 'sections'}`}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#F8FAFC', borderRadius: '10px' }}>
                        <Clock size={16} style={{ color: '#9333EA', flexShrink: 0 }} />
                        <div>
                          {/* Replaces "Students Mentored: null students". The
                              endpoint returns a contact-hours figure and a
                              session count; it has never returned a mentee
                              count. */}
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>Weekly Teaching Load</div>
                          <div style={{ fontSize: '0.85rem', color: '#0F172A', fontWeight: 600 }}>
                            {teacher.weeklyHours} contact {teacher.weeklyHours === 1 ? 'hour' : 'hours'}
                            {' · '}{teacher.weeklySessions} {teacher.weeklySessions === 1 ? 'session' : 'sessions'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#F8FAFC', borderRadius: '10px' }}>
                        <Award size={16} style={{ color: '#2563EB', flexShrink: 0 }} />
                        <div>
                          {/* Was "Qualification", filled with a hardcoded dash
                              because `employees` has no such column.
                              Specialization is the real field and it is what
                              the search box already matches on. */}
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>Specialization</div>
                          <div style={{ fontSize: '0.85rem', color: teacher.specialization ? '#0F172A' : '#CBD5E1', fontWeight: 600 }}>
                            {teacher.specialization || 'Not recorded'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#F8FAFC', borderRadius: '10px' }}>
                        <CalendarDays size={16} style={{ color: '#0891B2', flexShrink: 0 }} />
                        <div>
                          {/* hire_date is on every row and was never shown. */}
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>Joined</div>
                          <div style={{ fontSize: '0.85rem', color: teacher.hireDate ? '#0F172A' : '#CBD5E1', fontWeight: 600 }}>
                            {teacher.hireDate
                              ? new Date(teacher.hireDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                              : 'Not recorded'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#F8FAFC', borderRadius: '10px' }}>
                        <Mail size={16} style={{ color: '#DB2777', flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>Email</div>
                          <div style={{ fontSize: '0.85rem', color: teacher.email ? '#2563EB' : '#CBD5E1', fontWeight: 500, wordBreak: 'break-all' }}>
                            {teacher.email || 'No email on record'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div></div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* The search is the server's now, so `total` is the number of teachers
          MATCHING it rather than the size of the directory, and `count` is what
          this page actually rendered — which is what stops the summary claiming
          fifty rows on a page showing eight. */}
      <div style={{ marginTop: '1rem' }}>
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          limit={pagination.limit}
          count={filtered.length}
          onChange={setPage}
          noun="teacher"
          loading={pageLoading}
        />
      </div>

      {/* Edit Teacher Modal */}
      {editFormData && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            backgroundColor: '#FFFFFF', borderRadius: '16px',
            width: '100%', maxWidth: '580px', maxHeight: '90vh',
            overflowY: 'auto', border: '1px solid #E2E8F0',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            padding: '1.75rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Pencil size={20} color="#DC2626" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
                  Edit Teacher Details
                </h3>
              </div>
              <button
                onClick={() => setEditFormData(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Department
                  </label>
                  <select
                    value={editFormData.department}
                    onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none', backgroundColor: 'white' }}
                  >
                    {departments.map((d) => (
                      <option key={d.department_id} value={d.department_name}>{d.department_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Designation
                  </label>
                  <input
                    type="text"
                    value={editFormData.designation}
                    onChange={(e) => setEditFormData({ ...editFormData, designation: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Email
                  </label>
                  {/* The login email belongs to the user account and is not
                      editable from this screen. */}
                  <input
                    type="email"
                    value={editFormData.email}
                    readOnly
                    title="Login email is managed on the user account"
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.88rem', outline: 'none', backgroundColor: '#F8FAFC', color: '#64748B' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Specialization
                  </label>
                  <input
                    type="text"
                    value={editFormData.specialization === '—' ? '' : (editFormData.specialization || '')}
                    onChange={(e) => setEditFormData({ ...editFormData, specialization: e.target.value })}
                    placeholder="e.g. Machine Learning"
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Status
                  </label>
                  <select
                    value={editFormData.status}
                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none', backgroundColor: 'white' }}
                  >
                    {/* Values match the employment_status enum in the database. */}
                    <option value="Active">Active</option>
                    <option value="On Leave">On Leave</option>
                    <option value="Terminated">Terminated</option>
                    <option value="Retired">Retired</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Teaching load
                  </label>
                  <div style={{ padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', fontSize: '0.85rem', color: '#64748B' }}>
                    {editFormData.subjectsCount ?? '—'} subjects · {editFormData.sectionsCount ?? '—'} sections
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
                Course and section assignments are managed through timetables and
                teacher assignments, not from this form.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setEditFormData(null)}
                  style={{ padding: '0.6rem 1.2rem', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '0.6rem 1.4rem', borderRadius: '8px', border: 'none', backgroundColor: '#DC2626', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Save size={16} /> Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Teacher Modal */}
      {isAddModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            backgroundColor: '#FFFFFF', borderRadius: '16px',
            width: '100%', maxWidth: '580px', maxHeight: '90vh',
            overflowY: 'auto', border: '1px solid #E2E8F0',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            padding: '1.75rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={20} color="#DC2626" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
                  Add New Teacher
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddTeacher} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <DraftNotice draft={teacherDraft} online={online} onDiscard={() => { setNewTeacher(EMPTY_TEACHER); setAssignments([]); }} />

              {/* Same promise the admission form makes: the login is created
                  for you and the password is shown once, immediately after. */}
              <div style={{
                padding: '0.6rem 0.85rem', borderRadius: '8px',
                backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE',
                color: '#5B21B6', fontSize: '0.78rem',
              }}>
                The teacher's login is created automatically. You will be shown
                the password once, straight after saving.
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dr. Ahmed Hassan"
                  value={newTeacher.name}
                  onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Department
                  </label>
                  <select
                    value={newTeacher.department}
                    onChange={(e) => setNewTeacher({ ...newTeacher, department: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none', backgroundColor: 'white' }}
                  >
                    {departments.map((d) => (
                      <option key={d.department_id} value={d.department_name}>
                        {d.department_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Designation
                  </label>
                  <input
                    type="text"
                    value={newTeacher.designation}
                    onChange={(e) => setNewTeacher({ ...newTeacher, designation: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="Leave blank to generate one"
                    value={newTeacher.email}
                    onChange={(e) => setNewTeacher({ ...newTeacher, email: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                  />
                </div>
                {/* The password box that used to sit here is gone on purpose.
                    An admin typing the teacher's password means the admin knows
                    it forever. The server generates one, shows it once, and the
                    teacher must replace it at first sign-in. */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Phone
                  </label>
                  <input
                    type="text"
                    value={newTeacher.phone}
                    onChange={(e) => setNewTeacher({ ...newTeacher, phone: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                  />
                </div>
              </div>

              {/* ---- Classes -------------------------------------------------
                  Assigning subjects at onboarding rather than on a separate
                  screen afterwards: a teacher with no assignment has an empty
                  faculty portal and shows zero workload everywhere. */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                paddingTop: '0.5rem', borderTop: '1px solid #E2E8F0',
              }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                  Assign classes
                </span>
                <button
                  type="button"
                  onClick={() => setAssignments((prev) => [...prev, { subject_id: '', batch_id: '', section_id: '' }])}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    background: 'white', border: '1px solid #CBD5E1', borderRadius: '8px',
                    padding: '0.3rem 0.7rem', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                  }}
                >
                  <Plus size={13} /> Add class
                </button>
              </div>

              {assignments.length === 0 && (
                <p style={{ fontSize: '0.76rem', color: '#94A3B8', margin: 0 }}>
                  Optional — classes can also be assigned later from the teacher's row.
                </p>
              )}

              {assignments.map((row, index) => {
                // Only sections belonging to the chosen batch are offerable.
                const sectionsForBatch = catalogue.sections.filter(
                  (s) => !row.batch_id || String(s.batch_id) === String(row.batch_id),
                );

                const update = (field, value) => setAssignments((prev) => prev.map(
                  (a, i) => (i === index
                    ? { ...a, [field]: value, ...(field === 'batch_id' ? { section_id: '' } : {}) }
                    : a),
                ));

                const selectStyle = {
                  padding: '0.5rem', borderRadius: '8px', border: '1px solid #CBD5E1',
                  fontSize: '0.8rem', outline: 'none', backgroundColor: 'white', minWidth: 0,
                };

                return (
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                    <select value={row.subject_id} onChange={(e) => update('subject_id', e.target.value)} style={selectStyle}>
                      <option value="">Subject…</option>
                      {catalogue.subjects.map((s) => (
                        <option key={s.subject_id} value={s.subject_id}>
                          {s.subject_code} — {s.subject_name}
                        </option>
                      ))}
                    </select>

                    <select value={row.batch_id} onChange={(e) => update('batch_id', e.target.value)} style={selectStyle}>
                      <option value="">Batch…</option>
                      {catalogue.batches.map((b) => (
                        <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>
                      ))}
                    </select>

                    <select value={row.section_id} onChange={(e) => update('section_id', e.target.value)} style={selectStyle}>
                      <option value="">Section…</option>
                      {sectionsForBatch.map((s) => (
                        <option key={s.section_id} value={s.section_id}>{s.section_name}</option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setAssignments((prev) => prev.filter((_, i) => i !== index))}
                      title="Remove this class"
                      style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', padding: '4px' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Status
                  </label>
                  <select
                    value={newTeacher.status}
                    onChange={(e) => setNewTeacher({ ...newTeacher, status: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none', backgroundColor: 'white' }}
                  >
                    <option value="Active">Active</option>
                    <option value="On Leave">On Leave</option>
                    <option value="Terminated">Terminated</option>
                    <option value="Retired">Retired</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Specialization
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Machine Learning"
                    value={newTeacher.specialization}
                    onChange={(e) => setNewTeacher({ ...newTeacher, specialization: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.88rem', outline: 'none' }}
                  />
                </div>
              </div>

              <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
                This creates a real login account, an employee record and a
                teacher record. Courses and sections are assigned afterwards
                through timetables and teacher assignments.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{ padding: '0.6rem 1.2rem', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '0.6rem 1.4rem', borderRadius: '8px', border: 'none', backgroundColor: '#DC2626', color: '#FFFFFF', fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={16} /> {saving ? 'Creating account…' : 'Create Teacher & Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTeacher && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            backgroundColor: '#FFFFFF', borderRadius: '16px',
            width: '100%', maxWidth: '440px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            padding: '1.75rem',
            textAlign: 'center',
          }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%',
              backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#DC2626', marginBottom: '1rem',
            }}>
              <AlertTriangle size={26} />
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
              Confirm Delete Teacher?
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#64748B', marginTop: '8px', lineHeight: 1.5 }}>
              Are you sure you want to delete <strong>{deleteConfirmTeacher.name}</strong> ({deleteConfirmTeacher.department})? This action cannot be undone.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.85rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirmTeacher(null)}
                style={{ padding: '0.65rem 1.3rem', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                style={{ padding: '0.65rem 1.4rem', borderRadius: '8px', border: 'none', backgroundColor: '#DC2626', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Trash2 size={16} /> Yes, Delete Teacher
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-time credentials popup — see CredentialsDialog. */}
      <CredentialsDialog result={credentials} onClose={() => setCredentials(null)} />
    </div>
  );
}
