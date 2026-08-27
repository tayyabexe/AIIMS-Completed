import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import { useStudentProfile } from '../../context/StudentProfileContext';
import { summarizeAttendance } from '../../api/studentData';
import './StudentDashboard.css';
import './Attendance.css';
import { SkeletonRegion, SkeletonStatRow, SkeletonChart, SkeletonTable } from '../../components/common/Skeleton';
import {
  MIN_REQUIRED_PCT, WEEKDAY_HEADS,
  buildMonthGrid, isoDate, monthLabel, statusClass, formatDate,
} from '../../utils/attendanceData';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconAlertTriangle,
} from '../../components/student/icons';

const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const CIRCLE_R = 50;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;

/*
 * The signed-in student's attendance.
 *
 * Every number on this page is derived from GET /api/attendance/student/:id —
 * one row per timetable slot per day, joined to GET /api/subjects for the code
 * and title. Nothing is hardcoded: the course filter lists the subjects this
 * student actually has sessions recorded against, the summary counts are those
 * rows tallied by status, the trend has a point for each month with sessions,
 * and the calendar is built for whichever month is being viewed.
 *
 * Picking a course narrows the whole page, not just the table, so the ring, the
 * summary, the trend and the calendar always describe the same scope.
 */
const Attendance = () => {
  const { profile, studentData, loading, error } = useStudentProfile();

  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const [activeFilter, setActiveFilter] = useState('All');
  const [monthKey, setMonthKey] = useState(null);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance', active: true },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  /* The whole semester, used for the filter pills so a course does not vanish
     from the list once it is selected. */
  const all = studentData?.attendance || null;
  const rows = all?.rows || [];

  const courses = all?.bySubject || [];

  /* The selected scope. Recomputed from the same rows by the same function, so
     "All" and a single course cannot disagree about how a figure is counted. */
  const view = useMemo(() => {
    if (activeFilter === 'All') return all;
    return summarizeAttendance(
      rows.filter((r) => r.code === activeFilter),
      (all?.enrolled || []).filter((s) => s.subject_code === activeFilter),
    );
  }, [all, rows, activeFilter]);

  /* Months that actually have sessions in the current scope. The calendar opens
     on the most recent of them rather than a fixed month. */
  const months = view?.months || [];
  const activeMonth =
    months.find((m) => m.key === monthKey) || months[months.length - 1] || null;
  const monthIndex = activeMonth ? months.findIndex((m) => m.key === activeMonth.key) : -1;

  const monthGrid = useMemo(
    () => (activeMonth ? buildMonthGrid(activeMonth.year, activeMonth.month) : []),
    [activeMonth],
  );

  const trend = view?.monthly || [];
  const subjectRows = view?.bySubject || [];

  /* The course furthest below the rule, so the banner names the one that needs
     attention rather than whichever happens to sort first. */
  const lowCourse = useMemo(() => {
    const low = subjectRows.filter((s) => s.isLow);
    if (!low.length) return null;
    return low.reduce((worst, s) => (s.pct < worst.pct ? s : worst));
  }, [subjectRows]);

  const overallPct = view?.percent ?? null;

  // Trend line geometry — a single month is a point, not a line.
  const trendPoints = useMemo(() => {
    const usable = trend.filter((m) => m.pct !== null);
    if (usable.length < 2) return [];

    const values = usable.map((m) => m.pct);
    const min = Math.max(Math.min(...values) - 5, 0);
    const max = Math.min(Math.max(...values) + 5, 100);
    const span = max - min || 1;

    return usable.map((m, i) => {
      const x = (i / (usable.length - 1)) * 100;
      const y = 100 - ((m.pct - min) / span) * 100;
      return { key: m.key, label: m.label, point: `${x},${y}`, x, y };
    });
  }, [trend]);

  const rangeLabel = all?.firstDate
    ? `${formatDate(all.firstDate)} – ${formatDate(all.lastDate)}`
    : null;

  const subtitle = loading
    ? 'Loading your attendance…'
    : [
        profile.program !== '—' ? profile.program : null,
        profile.section !== '—' ? `Section ${profile.section}` : null,
        rangeLabel,
      ].filter(Boolean).join(' • ') || 'Attendance record';

  const hasData = Boolean(all?.hasData);

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
        {/* Top header (shared: chatbot, notifications, profile) */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Attendance</span>
        </div>

        {/* Page content */}
        <div className="attendance-page">
          <div className="attendance-page-header">
            <div>
              <h1 className="attendance-title">Attendance</h1>
              <p className="attendance-subtitle">{subtitle}</p>
            </div>

            {/* One pill per course this student has sessions recorded against */}
            {courses.length > 0 && (
              <div className="filter-pills">
                {['All', ...courses.map((c) => c.code).filter(Boolean)].map((f) => (
                  <button
                    key={f}
                    className={`filter-pill ${activeFilter === f ? 'active' : ''}`}
                    onClick={() => setActiveFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="warning-banner">
              <IconAlertTriangle />
              <span className="warning-text">
                <strong>Your attendance could not be loaded.</strong> {error}
              </span>
            </div>
          )}

          {/* Was the sentence "Loading your attendance record…" on an empty
              page. The placeholders below are the shape of what actually
              arrives — the four totals, the monthly chart, the session table —
              so the page does not jump when the numbers land. */}
          {loading && !hasData && (
            <SkeletonRegion label="Loading your attendance record">
              <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
              <SkeletonChart height={200} bars={12} style={{ marginBottom: '1.25rem' }} />
              <SkeletonTable rows={7} cols={5} />
            </SkeletonRegion>
          )}

          {!loading && !error && !hasData && (
            <div className="attendance-state">
              No attendance has been marked for you yet. Sessions appear here once
              a teacher records them.
            </div>
          )}

          {hasData && (
            <>
              {lowCourse && (
                <div className="warning-banner">
                  <IconAlertTriangle />
                  <span className="warning-text">
                    <strong>
                      Low Attendance Warning — {lowCourse.code} {lowCourse.title}
                    </strong>
                    {'  '}Current: {lowCourse.pct}% | Minimum Required: {MIN_REQUIRED_PCT}% |{' '}
                    {lowCourse.needed} more {lowCourse.needed === 1 ? 'class' : 'classes'} needed
                  </span>
                </div>
              )}

              {/* Overview row */}
              <div className="overview-grid">
                <div className="overview-card ring-card">
                  <span className="card-title">
                    Overall Attendance
                    {activeFilter !== 'All' ? ` — ${activeFilter}` : ''}
                  </span>
                  <div className="ring-wrap">
                    <svg viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r={CIRCLE_R} stroke="#eceef2" strokeWidth="10" fill="none" />
                      <circle
                        cx="60" cy="60" r={CIRCLE_R}
                        stroke={overallPct !== null && overallPct < MIN_REQUIRED_PCT ? '#dc2626' : '#16a34a'}
                        strokeWidth="10" fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${((overallPct ?? 0) / 100) * CIRCLE_CIRCUMFERENCE} ${CIRCLE_CIRCUMFERENCE}`}
                        transform="rotate(-90 60 60)"
                      />
                    </svg>
                    <div className="ring-center">
                      <span className="ring-pct">{overallPct === null ? '—' : `${overallPct}%`}</span>
                      <span className="ring-label">Attendance</span>
                    </div>
                  </div>
                  <span className="min-required">Min. Required: {MIN_REQUIRED_PCT}%</span>
                  <span className="ring-note">
                    {view.counted === 0
                      ? 'No sessions marked yet'
                      : `${view.attended} of ${view.counted} sessions attended${
                          view.late > 0 ? ' (late arrivals counted as attended)' : ''}`}
                  </span>
                </div>

                <div className="overview-card summary-card-wide">
                  <span className="card-title">Summary</span>
                  <div className="summary-stats-row">
                    <div className="summary-stat-box green">
                      <span className="summary-stat-value">{view.present}</span>
                      <span className="summary-stat-label">Present</span>
                    </div>
                    <div className="summary-stat-box red">
                      <span className="summary-stat-value">{view.absent}</span>
                      <span className="summary-stat-label">Absent</span>
                    </div>
                    <div className="summary-stat-box orange">
                      <span className="summary-stat-value">{view.late}</span>
                      <span className="summary-stat-label">Late</span>
                    </div>
                    <div className="summary-stat-box purple">
                      <span className="summary-stat-value">{view.leave}</span>
                      <span className="summary-stat-label">Leave</span>
                    </div>
                  </div>

                  <span className="card-title trend-title">Monthly Trend</span>
                  {trendPoints.length ? (
                    <div className="trend-chart">
                      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                        <polyline
                          points={trendPoints.map((p) => p.point).join(' ')}
                          fill="none"
                          stroke="#b91c2c"
                          strokeWidth="1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                        {trendPoints.map((p) => (
                          <circle key={p.key} cx={p.x} cy={p.y} r="1.6" fill="#b91c2c" />
                        ))}
                      </svg>
                      <div className="trend-labels">
                        {trendPoints.map((p) => (
                          <span key={p.key}>{p.label}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="attendance-inline-empty">
                      A trend needs at least two months of marked sessions.
                    </p>
                  )}
                </div>
              </div>

              {/* Subject-wise table */}
              <div className="table-card">
                <span className="card-title">Subject-wise Attendance</span>
                <div className="attendance-table">
                  <div className="table-row table-head">
                    <span>Code</span>
                    <span>Subject</span>
                    <span>Total Classes</span>
                    <span>Present</span>
                    <span>Absent</span>
                    <span>Late</span>
                    <span>Leave</span>
                    <span>Percentage</span>
                    <span>Status</span>
                  </div>
                  {subjectRows.map((r) => (
                    <div className="table-row" key={r.key}>
                      <span className="cell-code">{r.code || '—'}</span>
                      <span className="cell-subject">{r.title || '—'}</span>
                      <span>{r.counted}</span>
                      <span className="cell-present">{r.Present}</span>
                      <span className="cell-absent">{r.Absent}</span>
                      <span className="cell-late">{r.Late}</span>
                      <span className="cell-leave">{r.Leave}</span>
                      <span className="cell-pct">
                        <span className="mini-progress-track">
                          <span
                            className={`mini-progress-fill ${r.isLow ? 'low' : 'good'}`}
                            style={{ width: `${r.pct ?? 0}%` }}
                          ></span>
                        </span>
                        {r.pct === null ? '—' : `${r.pct}%`}
                      </span>
                      <span>
                        {/* A course whose first session has not been marked is
                            neither Good nor Low — saying either would invent a
                            standing it does not have yet. */}
                        {!r.hasSessions ? (
                          <span className="status-pill none">Not marked</span>
                        ) : (
                          <span className={`status-pill ${r.isLow ? 'low' : 'good'}`}>
                            {r.isLow ? '⚠ Low' : '✓ Good'}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom row: bar chart + calendar */}
              <div className="bottom-grid">
                <div className="chart-card">
                  <span className="card-title">Attendance Chart</span>
                  <div className="bar-chart">
                    <div className="bar-chart-axis">
                      {[100, 75, 50, 25, 0].map((v) => (
                        <span key={v}>{v}%</span>
                      ))}
                    </div>
                    <div className="bar-chart-bars">
                      {subjectRows.map((r) => (
                        <div className="bar-col" key={r.key}>
                          <span className="bar-value">{r.pct === null ? '—' : r.pct}</span>
                          <div className="bar" style={{ height: `${r.pct ?? 0}%` }}></div>
                          <span className="bar-label">{r.code || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="calendar-card">
                  <div className="calendar-header-row">
                    <span className="card-title">Attendance Calendar</span>
                    {/* Every month with marked sessions is reachable; the old
                        calendar was a fixed July 2024 grid. */}
                    <div className="calendar-nav">
                      <button
                        type="button"
                        className="calendar-nav-btn"
                        onClick={() => setMonthKey(months[monthIndex - 1].key)}
                        disabled={monthIndex <= 0}
                        aria-label="Previous month"
                      >
                        ‹
                      </button>
                      <span className="calendar-month">
                        {activeMonth ? monthLabel(activeMonth.year, activeMonth.month) : '—'}
                      </span>
                      <button
                        type="button"
                        className="calendar-nav-btn"
                        onClick={() => setMonthKey(months[monthIndex + 1].key)}
                        disabled={monthIndex < 0 || monthIndex >= months.length - 1}
                        aria-label="Next month"
                      >
                        ›
                      </button>
                    </div>
                  </div>

                  <div className="calendar-legend">
                    <span><i className="dot present"></i>Present</span>
                    <span><i className="dot absent"></i>Absent</span>
                    <span><i className="dot late"></i>Late</span>
                    <span><i className="dot leave"></i>Leave</span>
                    {view.holiday > 0 && <span><i className="dot holiday"></i>Holiday</span>}
                  </div>

                  {activeMonth ? (
                    <div className="calendar-grid">
                      {WEEKDAY_HEADS.map((d) => (
                        <span className="calendar-day-head" key={d}>{d}</span>
                      ))}
                      {monthGrid.map((day, i) => {
                        if (!day) {
                          // eslint-disable-next-line react/no-array-index-key
                          return <span key={`blank-${i}`} className="calendar-cell blank"></span>;
                        }

                        const date = isoDate(activeMonth.year, activeMonth.month, day);
                        const entry = view.byDate.get(date);

                        return (
                          <span
                            key={date}
                            className={`calendar-cell ${statusClass(entry?.status) || 'no-class'}`}
                            title={
                              entry
                                ? entry.sessions
                                    /*
                                     * The PERIOD, not just the course.
                                     *
                                     * This was `code: status`, so a day with
                                     * two lectures of the same course —
                                     * CS-101 meets at 08:30 AND 10:00 on
                                     * Mondays — gave two identical lines and
                                     * no way to tell which lecture was
                                     * missed. The slot's time is what makes
                                     * the entry specific.
                                     */
                                    .map((s) => [
                                      s.startTime
                                        ? `${s.startTime}–${s.endTime || ''}`
                                        : null,
                                      s.code || 'Class',
                                      s.status,
                                    ].filter(Boolean).join(' · '))
                                    .join('\n')
                                : 'No class marked'
                            }
                          >
                            {day}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="attendance-inline-empty">
                      No sessions marked for this course yet.
                    </p>
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

export default Attendance;
