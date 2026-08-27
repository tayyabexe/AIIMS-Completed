import React, { useMemo, useState } from 'react';
import { useServerQuery } from '../../hooks/useAdminPage';
import { Link, useParams } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import { useStudentProfile } from '../../context/StudentProfileContext';
import { exams as examsApi } from '../../api/endpoints';
import { ATTENDANCE_MIN_PCT } from '../../api/studentData';
import './StudentDashboard.css';
import './CourseDetails.css';
import { SkeletonRegion, SkeletonHero, SkeletonStatRow, SkeletonTable } from '../../components/common/Skeleton';
import {
  IconArrowLeft, IconGrid, IconBook, IconCalendarCheck, IconTrending,
  IconCard, IconClock, IconFile, IconUser, IconCheckCircle, IconAward,
  IconAlertCircle, IconMapPin, IconCalendar,
} from '../../components/student/icons';

const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—';

/*
 * One registered course, addressed by its subject code (/my-courses/CS-402).
 *
 * The course was previously looked up in CourseData.jsx, so this page could
 * only ever show one of six invented courses — a real code such as CS-402
 * landed on "We couldn't find that course". It now resolves against the
 * student's own enrollments, and every panel is filled from the database:
 * attendance from their marked sessions, marks exam by exam from `marks`
 * joined to `exams`, and upcoming assessments from `exams` itself.
 */
const CourseDetails = () => {
  const { courseCode } = useParams();
  const { studentData, loading, error } = useStudentProfile();

  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  /*
   * The exam table, on the SAME key the dashboard uses.
   *
   * `exams` is institute-wide, so both screens were fetching the whole table
   * and narrowing it in the browser. Sharing the key means opening a course
   * from the dashboard costs nothing, and the narrowing below is unchanged —
   * it just runs against the cached response instead of a fresh one.
   */
  const examsQuery = useServerQuery(
    () => examsApi.list().catch(() => null),
    {}, { key: 'student-exams' },
  );

  const course = useMemo(() => {
    const wanted = decodeURIComponent(courseCode || '').toLowerCase();
    return (studentData?.courses || []).find(
      (c) => String(c.code || '').toLowerCase() === wanted,
    ) || null;
  }, [studentData, courseCode]);

  const attendance = course?.attendance || null;
  const result = course?.result || null;

  /* Exams still ahead for this subject. `exams` is a shared table, so it is
     narrowed to this course and to dates that have not passed. */
  /* Exams still ahead for this subject. `exams` is a shared table, so it is
     narrowed to this course and to dates that have not passed. */
  const upcoming = useMemo(() => {
    if (!course?.subjectId) return [];

    const res = examsQuery.data;
    const rows = Array.isArray(res?.data) ? res.data
      : Array.isArray(res?.exams) ? res.exams
      : Array.isArray(res) ? res : [];

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return rows
      .filter((e) => e.subject_id === course.subjectId)
      .filter((e) => e.exam_date && new Date(e.exam_date) >= startOfToday)
      .sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)));
  }, [examsQuery.data, course?.subjectId]);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses', active: true },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

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
          <span className="brand-icon"><IconCap2 /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2024</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* Main wrapper */}
      <div className="main-wrapper">
        {/* Top header (shared: chatbot, notifications, profile) */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">My Courses</span>
        </div>

        {/* Page content */}
        <div className="course-details-page">
          <Link to="/student/my-courses" className="back-link">
            <IconArrowLeft /> Back to Courses
          </Link>

          {loading && !course ? (
            <SkeletonRegion label="Loading this course">
              <SkeletonHero chips={2} style={{ marginBottom: '1.25rem' }} />
              <SkeletonStatRow count={3} style={{ marginBottom: '1.25rem' }} />
              <SkeletonTable rows={6} cols={4} />
            </SkeletonRegion>
          ) : error ? (
            <div className="not-found-box">
              <p>Your courses could not be loaded. {error}</p>
              <Link to="/student/my-courses" className="back-link">Return to My Courses</Link>
            </div>
          ) : !course ? (
            <div className="not-found-box">
              <p>You are not registered for {decodeURIComponent(courseCode || '')}.</p>
              <Link to="/student/my-courses" className="back-link">Return to My Courses</Link>
            </div>
          ) : (
            <>
              {/* Banner */}
              <div className="course-banner">
                <div className="banner-info">
                  <p className="banner-eyebrow">
                    {course.code}
                    {course.semesterLabel ? ` • ${course.semesterLabel}` : ''}
                    {course.status ? ` • ${course.status}` : ''}
                  </p>
                  <h1 className="banner-title">{course.title}</h1>
                  {/* `subjects` holds no description — the catalogue paragraph
                      this page used to print was written into the frontend. The
                      prerequisite is the one descriptive fact it does hold. */}
                  <p className="banner-description">
                    {course.prerequisite
                      ? `Prerequisite: ${course.prerequisite.code} ${course.prerequisite.title || ''}`
                      : 'No prerequisite recorded for this subject.'}
                  </p>
                  <div className="banner-meta">
                    <span><IconUser /> {course.instructor || 'Instructor not assigned'}</span>
                    <span>
                      <IconClock />
                      {course.credits === null ? '—' : `${course.credits} Credit Hours`}
                    </span>
                    <span><IconMapPin /> {course.room}</span>
                    <span><IconCalendar /> {course.schedule || 'No scheduled slot'}</span>
                  </div>
                </div>
                {result?.grade && <span className="banner-grade">{result.grade}</span>}
              </div>

              {/* Summary cards */}
              <div className="summary-grid">
                <div className="summary-card">
                  <div className="summary-header">
                    <span className="summary-icon good"><IconCheckCircle /></span>
                    <span className="summary-title">Attendance Summary</span>
                  </div>
                  <div className={`summary-big-value ${attendance?.isLow ? '' : 'good'}`}>
                    {attendance?.pct === null || attendance?.pct === undefined
                      ? '—'
                      : `${attendance.pct}%`}
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${attendance?.isLow ? '' : 'good'}`}
                      style={{ width: `${attendance?.pct ?? 0}%` }}
                    ></div>
                  </div>
                  <div className="summary-footer-row">
                    {attendance?.hasSessions ? (
                      <>
                        <span>
                          {attendance.attended} of {attendance.counted} attended
                          {' · '}P {attendance.Present} · A {attendance.Absent}
                          {' · '}L {attendance.Late} · Lv {attendance.Leave}
                        </span>
                        <span>Min: <strong>{ATTENDANCE_MIN_PCT}%</strong></span>
                      </>
                    ) : (
                      <span>No session marked for this course yet.</span>
                    )}
                  </div>
                </div>

                <div className="summary-card">
                  <div className="summary-header">
                    <span className="summary-icon"><IconAward /></span>
                    <span className="summary-title">Marks Summary</span>
                  </div>
                  <div className="summary-big-value">
                    {result && result.total > 0 ? Math.round(result.obtained) : '—'}
                    {result && result.total > 0 && (
                      <span className="summary-out-of">/{result.total}</span>
                    )}
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${result?.percent ?? 0}%` }}
                    ></div>
                  </div>
                  <div className="summary-footer-row">
                    <span>Grade: <strong>{result?.grade || '—'}</strong></span>
                    <span>
                      Points: <strong>
                        {result?.gradePoint === null || result?.gradePoint === undefined
                          ? '—'
                          : result.gradePoint}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Marks that have actually been entered, exam by exam */}
              <div className="assessments-card">
                <div className="summary-header">
                  <span className="summary-icon"><IconAward /></span>
                  <span className="summary-title">Assessment Results</span>
                </div>
                <div className="assessments-list">
                  {!result?.components?.length ? (
                    <p className="course-inline-empty">
                      No marks have been entered for this course yet.
                    </p>
                  ) : (
                    result.components
                      .slice()
                      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
                      .map((component) => (
                        <div className="assessment-row" key={component.examId}>
                          <IconCalendar />
                          <span className="assessment-title">
                            {component.name || component.type || 'Assessment'}
                          </span>
                          <span className="assessment-date">
                            {shortDate(component.date)}
                            {' — '}
                            {component.obtained === null || component.total === null
                              ? 'not graded'
                              : `${component.obtained}/${component.total}`}
                            {component.status ? ` (${component.status})` : ''}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Upcoming Assessments — from `exams`, for this subject only */}
              <div className="assessments-card">
                <div className="summary-header">
                  <span className="summary-icon warn"><IconAlertCircle /></span>
                  <span className="summary-title">Upcoming Assessments</span>
                </div>
                <div className="assessments-list">
                  {upcoming.length === 0 ? (
                    <p className="course-inline-empty">
                      No exam is scheduled ahead for this course.
                    </p>
                  ) : (
                    upcoming.map((e) => (
                      <div className="assessment-row" key={e.exam_id}>
                        <IconCalendar />
                        <span className="assessment-title">{e.exam_name || e.exam_type}</span>
                        <span className="assessment-date">
                          {shortDate(e.exam_date)}
                          {e.total_marks != null ? ` — ${e.total_marks} marks` : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CourseDetails;