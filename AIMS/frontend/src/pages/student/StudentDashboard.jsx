import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudentProfile } from '../../context/StudentProfileContext';
import { useServerQuery } from '../../hooks/useAdminPage';
import StudentTopBar from '../../components/student/StudentTopBar';
import useLiveTimetable, { formatTime } from '../../hooks/useLiveTimetable';
import {
  announcements as announcementsApi,
  exams as examsApi,
  ai as aiApi,
} from '../../api/endpoints';
import { formatMoneyCompact } from '../../utils/currency';
import './StudentDashboard.css';
import { Skeleton, SkeletonList } from '../../components/common/Skeleton';

/* ---------- Icons (inline SVG, stroke-based) ---------- */
const IconSparkle = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.8L18 9l-4.4 1.7L12 15l-1.6-4.3L6 9l4.4-1.2L12 3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
);
const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" /></svg>
);
const IconBook = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5A2.5 2.5 0 016.5 3H12v18H6.5A2.5 2.5 0 014 18.5v-13z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M20 5.5A2.5 2.5 0 0017.5 3H12v18h5.5a2.5 2.5 0 002.5-2.5v-13z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
);
const IconCalendarCheck = () => (
  <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M8.5 15l2 2 4.5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconTrending = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M3 17l6-6 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 6h6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconCard = () => (
  <svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5" width="19" height="14" rx="2.2" stroke="currentColor" strokeWidth="1.6" /><path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.6" /></svg>
);
const IconClock = () => (
  <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M6 2.5h8l4 4V21a1 1 0 01-1 1H6a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 2.5V7h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" /><path d="M4.5 20c1.6-4 5-6 7.5-6s5.9 2 7.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const IconAward = () => (
  <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="5" stroke="currentColor" strokeWidth="1.6" /><path d="M9 12.5L7.5 21l4.5-2.5L16.5 21 15 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
);
const IconUsers = () => (
  <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" /><circle cx="17" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.6" /><path d="M3.5 19c0.8-3 3-4.8 5.5-4.8s4.7 1.8 5.5 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M14.5 14.6c2 .2 3.7 1.8 4.3 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const IconIdCard = () => (
  <svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="4.5" width="19" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" /><circle cx="8.5" cy="11" r="2" stroke="currentColor" strokeWidth="1.6" /><path d="M6 16c.7-1.5 1.8-2.2 2.5-2.2s1.8.7 2.5 2.2M14 9h5M14 12.5h5M14 16h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const IconCap = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
);
const IconBuilding = () => (
  <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="1" stroke="currentColor" strokeWidth="1.6" /><path d="M8 7h2M8 11h2M8 15h2M14 7h2M14 11h2M14 15h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const IconAlertTriangle = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5L2 20.5h20L12 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 9.5v4.5M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);
const IconStar = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.6L12 17.5 6.2 20.6l1.1-6.6L2.5 9.4l6.6-.9L12 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);
const IconActivity = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2-7 4 14 2-7h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconArrowRight = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/*
 * The signed-in student's dashboard.
 *
 * Everything on this page used to be a constant declared just above it: a
 * "BSCS-F21-001 / BS Computer Science / 6th Semester — A / Regular" identity
 * strip, a 3.58 GPA rising by an invented "+0.12", 87% attendance, "Rs. 25K
 * due Aug 31", six made-up courses with made-up percentages, three dated
 * announcements and two exams. None of it belonged to whoever was signed in.
 *
 * Sources now:
 *   profile / studentData  -> api/studentData.js (own record, marks, fees)
 *   today's classes        -> GET /api/timetables/current (server-evaluated clock)
 *   announcements          -> GET /api/announcements (role-scoped by the server)
 *   upcoming exams         -> GET /api/exams, narrowed to this student's own
 *                             subjects and semester
 *   AI insight             -> GET /api/ai/predict/:studentId
 *
 * Where a figure does not exist it renders as an em dash, and no trend arrow is
 * drawn unless there are two real data points to compare.
 */
/* How many announcements the dashboard card holds. The panel scrolls, so the
   cap is about what stays relevant rather than what fits on screen. */
const ANNOUNCEMENT_LIMIT = 10;

const StudentDashboard = () => {
  const { profile, studentData, loading } = useStudentProfile();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const { today: todaysClasses, now, loading: scheduleLoading } = useLiveTimetable();

  /*
   * Three reads, each on its own cache key.
   *
   * All three were fetch-on-mount effects storing into local state, so every
   * return to the dashboard paid for them again. The filtering that used to
   * live inside the `.then()` is now derived below from the cached response —
   * the same logic, but it runs against data that may not have been fetched
   * this time round.
   *
   * All three keep their old failure behaviour: a failed read leaves an empty
   * panel rather than an error, because none of them is the reason the
   * dashboard exists.
   */
  const announcementsQuery = useServerQuery(
    () => announcementsApi.list({ limit: ANNOUNCEMENT_LIMIT }).catch(() => null),
    {}, { key: 'student-announcements' },
  );

  const examsQuery = useServerQuery(
    () => examsApi.list().catch(() => null),
    {}, { key: 'student-exams', enabled: !!studentData },
  );

  const insightQuery = useServerQuery(
    () => aiApi.predictForStudent(profile.studentId).catch(() => null),
    { studentId: profile.studentId ?? null },
    { key: 'student-ai-insight', enabled: !!profile.studentId },
  );

  const insight = insightQuery.data || null;

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard', active: true },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  /* ── Announcements addressed to this student ──
     The ten most recent, which the panel scrolls through. The API orders by
     created_at DESC, so an eleventh announcement pushes the oldest one off the
     card rather than growing the list without limit. */
  const announcements = useMemo(() => {
    const res = announcementsQuery.data;
    const rows = Array.isArray(res?.data) ? res.data
      : Array.isArray(res?.announcements) ? res.announcements : [];
    // The cap is enforced here as well as in the query, so the card cannot
    // grow past ten if the endpoint ever stops honouring `limit`.
    return rows.slice(0, ANNOUNCEMENT_LIMIT);
  }, [announcementsQuery.data]);

  /* Subjects this student holds marks for — used to keep another cohort's
     exams off their dashboard. */
  const ownSubjectIds = useMemo(() => {
    const ids = new Set();
    for (const m of studentData?.marks || []) if (m.subjectId) ids.add(m.subjectId);
    return ids;
  }, [studentData]);

  /* ── Exams still ahead, in subjects this student actually takes ── */
  const exams = useMemo(() => {
    const res = examsQuery.data;
    const rows = Array.isArray(res?.data) ? res.data
      : Array.isArray(res?.exams) ? res.exams
      : Array.isArray(res) ? res : [];

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const mine = rows.filter((e) => {
      const inSemester = profile.semesterId != null
        && Number(e.semester_id) === Number(profile.semesterId);
      const inSubject = ownSubjectIds.has(e.subject_id);
      if (!inSemester && !inSubject) return false;
      if (!e.exam_date) return false;
      return new Date(e.exam_date) >= startOfToday;
    });

    mine.sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)));
    return mine.slice(0, 5);
  }, [examsQuery.data, profile.semesterId, ownSubjectIds]);

  /* ── AI performance prediction. The model is a separate service, so a
        failure leaves the panel out rather than filling it in. ── */

  /* ── Current-semester subjects with their real running score ── */
  const semesters = useMemo(() => studentData?.semesters || [], [studentData]);

  const currentSemester = useMemo(() => {
    if (!semesters.length) return null;
    return semesters.find((s) => s.semesterId === profile.semesterId)
      || semesters[semesters.length - 1];
  }, [semesters, profile.semesterId]);

  const courses = currentSemester?.subjects || [];

  /* ── GPA movement, only when two semesters are actually on record ── */
  const gpaDelta = useMemo(() => {
    const withGpa = semesters.filter((s) => s.gpa !== null);
    if (withGpa.length < 2) return null;
    const diff = withGpa[withGpa.length - 1].gpa - withGpa[withGpa.length - 2].gpa;
    return Math.round(diff * 100) / 100;
  }, [semesters]);

  const fees = studentData?.fees || null;
  const nextDue = fees?.outstanding?.[0] || null;

  const totalCredits = courses.reduce((t, c) => t + (Number(c.credits) || 0), 0);

  const trend = (delta) => {
    if (delta === null || delta === 0) return <span className="stat-trend flat">—</span>;
    return (
      <span className={`stat-trend ${delta > 0 ? 'up' : 'down'}`}>
        {delta > 0 ? '↗' : '↘'} {delta > 0 ? '+' : ''}{delta.toFixed(2)}
      </span>
    );
  };

  const show = (value, suffix = '') =>
    value === null || value === undefined ? '—' : `${value}${suffix}`;

  const shortDate = (value) =>
    new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="dashboard-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* Sidebar */}
      <aside className={`sidebar ${isMenuOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand" onClick={() => window.history.back()}>
          <span className="brand-icon"><IconCap /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`nav-item ${item.active ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2026</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* Main wrapper */}
      <div className="main-wrapper">
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Dashboard</span>
        </div>

        {/* Body */}
        <div className="dashboard-body">
          <div className="dashboard-main">
            {/* Welcome banner — the identity strip is this student's own record */}
            <div className="welcome-banner">
              <div className="welcome-text-block">
                {/* The date comes from the server's clock in the institute's
                    timezone, not from a fixed "Friday, July 24". */}
                <p className="welcome-date">
                  {now?.day && now?.date
                    ? `Welcome back — ${now.day}, ${new Date(now.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
                    : 'Welcome back'}
                </p>
                <h1 className="welcome-heading">
                  Hello, {profile.firstName || '—'}! 👋
                </h1>
                <div className="welcome-meta">
                  <span><IconIdCard /> {profile.rollNo || '—'}</span>
                  <span><IconCap /> {profile.program}</span>
                  <span>
                    <IconCalendarCheck /> {profile.semester}
                    {profile.section && profile.section !== '—' ? ` — ${profile.section}` : ''}
                  </span>
                  {/* The owning department, not a second copy of the programme
                      name — which is why "Computer Science" appeared twice. */}
                  {profile.department && profile.department !== '—' && (
                    <span><IconBuilding /> {profile.department}</span>
                  )}
                </div>
              </div>
              <div className="welcome-profile">
                {profile.photoUrl ? (
                  <img
                    src={profile.photoUrl}
                    alt="Profile"
                    className="welcome-avatar"
                    style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div className="welcome-avatar">{profile.initials}</div>
                )}
                {/* students.academic_status, rather than a fixed "Regular". */}
                {profile.status && profile.status !== '—' && (
                  <span className="regular-badge">{profile.status}</span>
                )}
              </div>
            </div>

            {/* Stats cards */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-pink"><IconAward /></span>
                  {/* Only drawn when two semesters of GPA exist to compare. */}
                  {trend(gpaDelta)}
                </div>
                <div className="stat-value">
                  {currentSemester?.gpa != null ? currentSemester.gpa.toFixed(2) : '—'}
                </div>
                <div className="stat-label">Semester GPA</div>
                <div className="stat-sublabel">{currentSemester?.label || profile.semester}</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-purple"><IconTrending /></span>
                  <span className="stat-trend flat">—</span>
                </div>
                <div className="stat-value">
                  {profile.cgpa != null ? Number(profile.cgpa).toFixed(2) : '—'}
                </div>
                <div className="stat-label">CGPA</div>
                <div className="stat-sublabel">Overall</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-green"><IconUsers /></span>
                  <span className="stat-trend flat">—</span>
                </div>
                <div className="stat-value">{show(profile.attendancePct, '%')}</div>
                <div className="stat-label">Attendance</div>
                <div className="stat-sublabel">
                  {studentData?.attendance?.counted
                    ? `${studentData.attendance.attended} of ${studentData.attendance.counted} sessions`
                    : 'No sessions recorded'}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-orange"><IconCard /></span>
                  <span className="stat-trend flat">—</span>
                </div>
                <div className="stat-value">
                  {fees ? formatMoneyCompact(fees.totalDue) : '—'}
                </div>
                <div className="stat-label">Outstanding Fee</div>
                <div className="stat-sublabel">
                  {nextDue?.dueDate ? `Due ${shortDate(nextDue.dueDate)}` : 'Nothing outstanding'}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-blue"><IconBook /></span>
                </div>
                <div className="stat-value">{show(profile.enrolledCourses)}</div>
                <div className="stat-label">Enrolled Courses</div>
                <div className="stat-sublabel">
                  {totalCredits ? `${totalCredits} Credit Hours` : 'From your timetable'}
                </div>
              </div>
            </div>

            {/* Today's Schedule — from the server-evaluated timetable */}
            <section className="panel">
              <div className="panel-header">
                <div className="panel-title-group">
                  <span className="panel-icon"><IconClock /></span>
                  <h2 className="panel-title">Today's Schedule</h2>
                  {now?.day && <span className="day-pill">{now.day}</span>}
                </div>
                <Link to="/student/time-table" className="view-all-link">
                  View All <IconArrowRight />
                </Link>
              </div>

              <div className="schedule-list">
                {/* Inline, and sized to a schedule row rather than to a
                    paragraph of text, so the panel keeps its height while the
                    day loads. */}
                {scheduleLoading ? (
                  <div className="aims-stagger" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.7rem 0' }}>
                        <Skeleton variant="card" w={44} h={44} radius="12px" />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                          <Skeleton variant="title" w={`${58 + i * 9}%`} />
                          <Skeleton variant="text" w="38%" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : todaysClasses.length === 0 ? (
                  <p className="dash-inline-empty">No classes scheduled for today.</p>
                ) : (
                  todaysClasses.map((item) => (
                    <div
                      className={`schedule-row ${item.is_current ? 'is-current' : ''}`}
                      key={item.timetable_id}
                    >
                      <div className="schedule-time-block">
                        <span className="time-start">{formatTime(item.start_time)}</span>
                        <span className="time-end">{formatTime(item.end_time)}</span>
                      </div>
                      <div className="schedule-info">
                        <span className="schedule-subject">
                          {item.subject_code ? `${item.subject_code} — ` : ''}{item.subject_name}
                        </span>
                        <span className="schedule-meta">
                          {[item.teacher_name, item.room_name].filter(Boolean).join(' • ') || '—'}
                        </span>
                      </div>
                      {/* "now" / "upcoming" is a state the server reports; the
                          old Lecture/Lab tag existed nowhere in the data. */}
                      {item.is_current ? (
                        <span className="tag-badge tag-lab">Now</span>
                      ) : item.is_upcoming ? (
                        <span className="tag-badge tag-lecture">Upcoming</span>
                      ) : (
                        <span className="tag-badge">Done</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Enrolled Courses — real running score per subject */}
            <section className="panel">
              <div className="panel-header">
                <div className="panel-title-group">
                  <span className="panel-icon"><IconBook /></span>
                  <h2 className="panel-title">
                    {currentSemester ? `${currentSemester.label} Subjects` : 'Subjects'}
                  </h2>
                </div>
                <Link to="/student/my-courses" className="view-all-link">
                  View All <IconArrowRight />
                </Link>
              </div>

              <div className="course-list">
                {loading ? (
                  <div className="aims-stagger" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.7rem 0' }}>
                        <Skeleton variant="card" w={38} h={38} radius="10px" />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                          <Skeleton variant="title" w={`${52 + i * 11}%`} />
                          <Skeleton variant="text" w="30%" />
                        </div>
                        <Skeleton variant="chip" w={54} />
                      </div>
                    ))}
                  </div>
                ) : courses.length === 0 ? (
                  <p className="dash-inline-empty">
                    No marks recorded yet for this semester.
                  </p>
                ) : (
                  courses.map((c) => (
                    <div className="course-row" key={c.key}>
                      <div className="course-name-block">
                        <span className="course-code">{c.code || '—'}</span>
                        <span className="course-name">{c.title}</span>
                      </div>
                      <div className="course-progress-block">
                        <div className="progress-track">
                          <div
                            className={`progress-fill ${c.percent !== null && c.percent < 80 ? 'low' : 'good'}`}
                            style={{ width: `${c.percent ?? 0}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="course-score-block">
                        <span className={`course-pct ${c.percent !== null && c.percent < 80 ? 'low' : 'good'}`}>
                          {c.percent === null ? '—' : `${c.percent}%`}
                        </span>
                        <span className="course-grade">{c.grade || '—'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="dashboard-side">
            {/* Profile Card */}
            <div className="dash-profile-card">
              <div className="dash-profile-bg">
                <div className="dash-prof-blob dash-prof-blob-1"></div>
                <div className="dash-prof-blob dash-prof-blob-2"></div>
              </div>
              <div className="dash-profile-content">
                <div className="dash-profile-avatar-wrap">
                  <div className="dash-profile-avatar">
                    {profile.photoUrl ? (
                      <img
                        src={profile.photoUrl}
                        alt="Profile"
                        style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span className="dash-profile-initials">{profile.initials}</span>
                    )}
                  </div>
                  <Link to="/student/profile" className="dash-profile-camera" aria-label="Change photo">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </Link>
                </div>
                <h3 className="dash-profile-name">{profile.fullName || '—'}</h3>
                <span className="dash-profile-roll">{profile.rollNo || '—'}</span>
                <div className="dash-profile-tags">
                  {profile.semester !== '—' && (
                    <span className="dash-profile-tag">{profile.semester}</span>
                  )}
                  {profile.section !== '—' && (
                    <span className="dash-profile-tag">Section {profile.section}</span>
                  )}
                </div>
                <div className="dash-profile-mini-stats">
                  <div className="dash-prof-mini-stat">
                    <span className="dash-prof-mini-value">
                      {currentSemester?.gpa != null ? currentSemester.gpa.toFixed(2) : '—'}
                    </span>
                    <span className="dash-prof-mini-label">GPA</span>
                  </div>
                  <div className="dash-prof-mini-divider"></div>
                  <div className="dash-prof-mini-stat">
                    <span className="dash-prof-mini-value">{show(profile.attendancePct, '%')}</span>
                    <span className="dash-prof-mini-label">Attend</span>
                  </div>
                  <div className="dash-prof-mini-divider"></div>
                  <div className="dash-prof-mini-stat">
                    <span className="dash-prof-mini-value">{show(profile.enrolledCourses)}</span>
                    <span className="dash-prof-mini-label">Courses</span>
                  </div>
                </div>
                <Link to="/student/profile" className="dash-profile-link">
                  View Full Profile
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* AI Academic Insight — only when the model actually answered */}
            {insight?.prediction && (
              <section className="ai-panel">
                <div className="ai-panel-header">
                  <span className="ai-panel-title"><IconSparkle /> AI Academic Insight</span>
                  {insight.prediction.confidence != null && (
                    <span className="confidence-badge">
                      {Math.round(Number(insight.prediction.confidence) * 100)}% confidence
                    </span>
                  )}
                </div>

                {insight.prediction.predicted_score != null && (
                  <div className="ai-row">
                    <div className="ai-row-label"><IconTrending /> Performance Prediction</div>
                    <div className="ai-row-value green">
                      {Math.round(Number(insight.prediction.predicted_score))}%
                    </div>
                    <div className="ai-row-sub">Projected end-of-semester score</div>
                  </div>
                )}

                {insight.prediction.risk_level && (
                  <div className="ai-row">
                    <div className="ai-row-label"><IconAlertTriangle /> Academic Risk Level</div>
                    <span className="risk-badge">
                      {String(insight.prediction.risk_level).toUpperCase()}
                    </span>
                  </div>
                )}

                {insight.prediction.recommendation && (
                  <div className="recommendation-box">
                    <div className="recommendation-title"><IconStar /> Recommendation</div>
                    <p className="recommendation-text">{insight.prediction.recommendation}</p>
                  </div>
                )}
              </section>
            )}

            {/* Announcements */}
            <section className="side-panel">
              <div className="side-panel-header">
                <span className="side-panel-title"><IconActivity /> Announcements</span>
              </div>
              <div className="announcement-list">
                {announcements.length === 0 ? (
                  <p className="dash-inline-empty">No announcements right now.</p>
                ) : (
                  announcements.map((a) => (
                    <div className="announcement-item" key={a.announcement_id}>
                      <div className="announcement-top">
                        <span className="announcement-title">{a.title}</span>
                        {a.target_role && <span className="tag-chip">{a.target_role}</span>}
                      </div>
                      <p className="announcement-text">{a.content}</p>
                      <span className="announcement-date">
                        {a.created_at
                          ? new Date(a.created_at).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })
                          : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Upcoming Exams */}
            <section className="side-panel">
              <div className="side-panel-header">
                <span className="side-panel-title"><IconAlertTriangle /> Upcoming Exams</span>
              </div>
              <div className="exam-list">
                {exams.length === 0 ? (
                  <p className="dash-inline-empty">No exams scheduled.</p>
                ) : (
                  exams.map((e) => (
                    <div className="exam-item" key={e.exam_id}>
                      <span className="exam-icon"><IconFile /></span>
                      <div className="exam-info">
                        <span className="exam-title">{e.exam_name || e.exam_type}</span>
                        <span className="exam-meta">
                          {[
                            e.exam_date ? shortDate(e.exam_date) : null,
                            e.exam_type,
                            e.total_marks != null ? `${e.total_marks} marks` : null,
                          ].filter(Boolean).join(' • ')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
