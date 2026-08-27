import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Users,
  MapPin,
  Clock,
  ArrowLeft,
  ClipboardCheck,
  FileText,
  Megaphone,
} from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import Avatar from '../../components/faculty/Avatar.jsx';
import DataGate from '../../components/faculty/DataState.jsx';
import { faculty as facultyApi } from '../../api/endpoints';
import { useFacultyClasses } from '../../hooks/useFacultyLookups';
import './MyClasses.css';

// ---------------------------------------------------------------------------
// The teacher's real classes, from GET /api/faculty/classes.
//
// This screen used to render a four-entry CLASSES constant compiled into the
// bundle — CS-301 Data Structures with 45 students, CS-401 Database Systems
// with 38, each with a handful of invented students ("Ali Ahmed, 92%,
// 88/100") — identical for every teacher who signed in. Nothing on the page
// touched the API.
//
// Every field below now comes from the database: the subject and its code from
// `subjects`, the section and programme from `sections`/`batches`/`programs`,
// the days, times and rooms from `timetables` joined to `classrooms`, the
// roster from `students`, and each student's attendance and marks aggregated
// from `attendance` and `marks`.
// ---------------------------------------------------------------------------

// Card accents, cycled by position. Purely presentational — a subject has no
// colour in the database, and inventing one per subject code would be a guess.
const ACCENTS = [
  { accent: '#d1373f', accentBg: '#fdeaea' },
  { accent: '#2a63c9', accentBg: '#eaf1fd' },
  { accent: '#1f9d55', accentBg: '#e7f7ee' },
  { accent: '#7c3aed', accentBg: '#f1eafd' },
  { accent: '#b6791b', accentBg: '#fdf2df' },
];

const DAY_SHORT = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

// "09:00" -> "9:00 AM"
const clock = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

/**
 * The weekly pattern as one line: slots that share a start and end time are
 * collapsed into "Mon / Wed 9:00 AM – 10:30 AM", which is how a timetable is
 * normally read.
 */
const scheduleLine = (slots = []) => {
  if (!slots.length) return 'No timetable slots';

  const groups = new Map();
  slots.forEach((s) => {
    const key = `${s.start_time}-${s.end_time}`;
    if (!groups.has(key)) groups.set(key, { start: s.start_time, end: s.end_time, days: [] });
    groups.get(key).days.push(DAY_SHORT[s.day_of_week] || s.day_of_week);
  });

  return [...groups.values()]
    .map((g) => `${g.days.join(' / ')} ${clock(g.start)} – ${clock(g.end)}`)
    .join(' · ');
};

/** Distinct rooms across the week; a class can move between them. */
const roomLine = (slots = []) => {
  const rooms = [...new Set(
    slots
      .map((s) => (s.room_name ? [s.room_name, s.building].filter(Boolean).join(', ') : null))
      .filter(Boolean),
  )];
  return rooms.length ? rooms.join(' · ') : 'Room not assigned';
};

const semesterLabel = (c) =>
  (c.semester_number ? `Semester ${c.semester_number}` : 'Semester —');

const sectionLabel = (c) => (c.section_name ? `Section ${c.section_name}` : 'Section —');

const pctBadge = (value) => {
  if (value === null || value === undefined) return 'badge-neutral';
  if (value >= 85) return 'badge-success';
  if (value >= 75) return 'badge-warning';
  return 'badge-danger';
};

export default function MyClasses() {
  const navigate = useNavigate();
  // The URL carries subject and section, because a subject code alone does not
  // identify a class — the same subject is taught to several sections.
  const { subjectId: urlSubjectId, sectionId: urlSectionId } = useParams();

  /*
   * The class list comes from the shared lookup rather than from a fetch of
   * this screen's own. Reports, Attendance and Marks ask for exactly the same
   * list, and each used to request it separately.
   */
  const { data: classes, loading, error, refresh: loadClasses } = useFacultyClasses();

  const [semester, setSemester] = useState('All Semesters');
  const [section, setSection] = useState('All Sections');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // The roster is a second request, made only when a class is opened, so the
  // grid does not pull every student of every section up front.
  const loadRoster = useCallback(async (subjectId, sectionId) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await facultyApi.classRoster(subjectId, sectionId);
      setDetail(res?.data || null);
    } catch (err) {
      setDetailError(err.message || 'Could not load this class.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (urlSubjectId && urlSectionId) {
      loadRoster(urlSubjectId, urlSectionId);
    } else {
      setDetail(null);
      setDetailError(null);
    }
  }, [urlSubjectId, urlSectionId, loadRoster]);

  const semesterOptions = useMemo(
    () => [...new Set(classes.map(semesterLabel))].sort(),
    [classes],
  );

  const sectionOptions = useMemo(
    () => [...new Set(classes.map(sectionLabel))].sort(),
    [classes],
  );

  const filtered = useMemo(
    () => classes.filter((c) => (
      (semester === 'All Semesters' || semesterLabel(c) === semester)
      && (section === 'All Sections' || sectionLabel(c) === section)
    )),
    [classes, semester, section],
  );

  // ------------------------------------------------------------ class detail
  if (urlSubjectId && urlSectionId) {
    const back = (
      <div style={{ marginBottom: '1.25rem' }}>
        <button
          onClick={() => navigate('/faculty/my-classes')}
          className="btn btn-outline"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
        >
          <ArrowLeft size={16} /> Back to My Classes
        </button>
      </div>
    );

    if (detailLoading || detailError || !detail) {
      return (
        <Layout title="Class Details">
          {back}
          <DataGate
            loading={detailLoading}
            error={detailError || (!detail ? 'This class could not be found.' : null)}
            onRetry={() => loadRoster(urlSubjectId, urlSectionId)}
            label="Loading class…"
          />
        </Layout>
      );
    }

    return (
      <Layout title={`Class Details — ${detail.subject_code}`}>
        {back}

        {/* Class banner */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          padding: '1.75rem',
          border: '1px solid var(--border)',
          marginBottom: '1.5rem',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span className="badge badge-danger" style={{ fontSize: '0.75rem' }}>{detail.subject_code}</span>
                <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                  {semesterLabel(detail)} · {sectionLabel(detail)}
                </span>
                {detail.credit_hours != null && (
                  <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                    {detail.credit_hours} credit hours
                  </span>
                )}
              </div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
                {detail.subject_name}
              </h1>
              <p style={{ fontSize: '0.88rem', color: '#64748B', marginTop: '4px' }}>
                {detail.program_name || 'Programme —'}
                {detail.batch_name ? ` · ${detail.batch_name}` : ''}
                {' · Room: '}<strong>{roomLine(detail.slots)}</strong>
                {' · Schedule: '}<strong>{scheduleLine(detail.slots)}</strong>
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => navigate(
                  `/faculty/attendance?subject_id=${detail.subject_id}&section_id=${detail.section_id}`,
                )}
              >
                <ClipboardCheck size={16} /> Mark Attendance
              </button>
              <button className="btn btn-outline" onClick={() => navigate('/faculty/marks')}>
                <FileText size={16} /> Enter Marks
              </button>
              <button className="btn btn-outline" onClick={() => navigate('/faculty/announcements')}>
                <Megaphone size={16} /> Announcement
              </button>
            </div>
          </div>
        </div>

        {/* Enrolled students */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'Outfit, sans-serif' }}>
              Enrolled Students Roster ({detail.students.length})
            </h3>
            <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
              Attendance and marks are for {detail.subject_code}
            </span>
          </div>

          <table className="table-custom" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Roll Number</th>
                <th>Student Name</th>
                <th>Attendance Rate</th>
                <th>Current Marks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.students.map((s) => (
                <tr key={s.student_id}>
                  <td style={{ fontWeight: 600, color: '#0F172A' }}>{s.registration_number}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Avatar name={s.full_name} size={30} userId={s.user_id} />
                      <span style={{ fontWeight: 600 }}>{s.full_name}</span>
                    </div>
                  </td>
                  <td>
                    {/* A student with no attendance rows yet is shown as such,
                        rather than as 0% — the two mean different things. */}
                    {s.attendance && s.attendance.percentage !== null ? (
                      <span className={`badge ${pctBadge(s.attendance.percentage)}`}>
                        {s.attendance.percentage}%
                      </span>
                    ) : (
                      <span style={{ color: '#94A3B8' }}>Not marked yet</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {s.marks
                      ? `${s.marks.obtained}/${s.marks.total}`
                      : <span style={{ color: '#94A3B8', fontWeight: 400 }}>No marks entered</span>}
                  </td>
                  <td>
                    <span className="badge badge-neutral">{s.academic_status || '—'}</span>
                  </td>
                </tr>
              ))}
              {detail.students.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)', padding: '18px 0' }}>
                    No students are assigned to this section yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Layout>
    );
  }

  // -------------------------------------------------------------- class grid
  return (
    <Layout title="My Classes">
      <DataGate loading={loading} error={error} onRetry={loadClasses} label="Loading your classes…">
        <div className="classes-sub">
          {classes.length} assigned {classes.length === 1 ? 'class' : 'classes'}
          {' · '}
          {new Set(classes.map((c) => c.subject_id)).size} subjects
          {' · '}
          {classes.reduce((sum, c) => sum + (c.student_count || 0), 0)} students
        </div>

        <div className="filters-row">
          <div className="filter-field">
            <label>Semester</label>
            <select value={semester} onChange={(e) => setSemester(e.target.value)}>
              <option>All Semesters</option>
              {semesterOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label>Section</label>
            <select value={section} onChange={(e) => setSection(e.target.value)}>
              <option>All Sections</option>
              {sectionOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="classes-grid">
          {filtered.map((c, i) => {
            const palette = ACCENTS[i % ACCENTS.length];
            return (
              <div
                className="class-card"
                key={c.key}
                style={{ '--accent': palette.accent, '--accent-bg': palette.accentBg }}
              >
                <div className="class-card-top">
                  <span className="class-code">{c.subject_code}</span>
                  <span className="class-count">
                    <Users size={14} /> {c.student_count}
                  </span>
                </div>

                <div className="class-title">{c.subject_name}</div>
                <div className="class-meta-line">{c.program_name || 'Programme —'}</div>
                <div className="class-meta-line" style={{ marginBottom: 10 }}>
                  {semesterLabel(c)} · {sectionLabel(c)}
                </div>
                <div className="class-meta-row">
                  <MapPin size={14} /> {roomLine(c.slots)}
                </div>
                <div className="class-meta-row" style={{ marginBottom: 10 }}>
                  <Clock size={14} /> {scheduleLine(c.slots)}
                </div>

                {c.attendance && c.attendance.percentage !== null && (
                  <div className="class-meta-line" style={{ marginBottom: 10 }}>
                    Class attendance:{' '}
                    <strong style={{ color: palette.accent }}>{c.attendance.percentage}%</strong>
                    {' '}over {c.attendance.totalSessions} records
                  </div>
                )}

                <button
                  className="class-open-btn"
                  onClick={() => navigate(`/faculty/my-classes/${c.subject_id}/${c.section_id}`)}
                >
                  Open Class <ArrowRight size={16} />
                </button>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div style={{ color: 'var(--text-muted)', padding: '30px 0' }}>
              {classes.length === 0
                ? 'You have no classes on the timetable yet.'
                : 'No classes match these filters.'}
            </div>
          )}
        </div>
      </DataGate>
    </Layout>
  );
}
