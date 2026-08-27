import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import useLiveTimetable, {
  formatTime, formatRange, toMinutes, subjectColor,
} from '../../hooks/useLiveTimetable';
import './StudentDashboard.css';
import './TimeTable.css';
import { SkeletonRegion, SkeletonTimetable } from '../../components/common/Skeleton';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconMapPin, IconAlertCircle,
} from '../../components/student/icons';

/* ── Icon cap (brand logo) ── */
const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

/*
 * This page used to render a `WEEK_SCHEDULE` constant: six days of invented
 * lectures ("Machine Learning" with "Dr. Khan" in "LH-305"), an `UPCOMING`
 * list with hardcoded dates, a `scheduleStats` block (28 / 22 / 6 / 16) and a
 * summary card asserting "Busiest Day: Monday" and "Free Slots: 26 hrs" — none
 * of which came from the database.
 *
 * Everything below now comes from GET /api/timetables/current, which resolves
 * the student's section from their token and marks the live entry server-side,
 * in the institute's timezone.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* The table's slot columns are derived from the real entries rather than a
   fixed 8am–5pm hourly assumption, so a section scheduled outside that window
   — or on 90-minute periods — still lays out correctly. */

/* Short "Jul 25" label for a weekday in the same Mon..Sat week as `now`. */
const weekDateLabel = (now, dayIndex) => {
  const mondayOffset = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const date = new Date(now);
  date.setDate(now.getDate() + mondayOffset + dayIndex);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* ── Component ────────────────────────────────── */
const TimeTable = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'day'

  const { now, week, today, slots: apiSlots, breakPeriod, currentLecture, nextLecture, loading, error, reload } =
    useLiveTimetable();

  // The server tells us the weekday; DAYS is 0=Monday.
  const todayIndex = now?.day ? DAYS.indexOf(now.day) : -1;
  const selectableDayIndex = todayIndex === -1 ? 0 : todayIndex;

  const [activeDay, setActiveDay] = useState(0);

  // Follow today unless the student has picked a different day themselves.
  const autoDayRef = useRef(null);
  useEffect(() => {
    if (autoDayRef.current !== null && activeDay !== autoDayRef.current) return;
    autoDayRef.current = selectableDayIndex;
    setActiveDay(selectableDayIndex);
  }, [selectableDayIndex, activeDay]);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable', active: true },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  /* Entries by day index, and the hour rows the grid needs. */
  const entriesByDay = useMemo(() => {
    const map = DAYS.map(() => []);
    week.forEach((d) => {
      const i = DAYS.indexOf(d.day);
      if (i >= 0) map[i] = [...(d.entries || [])].sort(
        (a, b) => (toMinutes(a.start_time) || 0) - (toMinutes(b.start_time) || 0),
      );
    });
    return map;
  }, [week]);

  const allEntries = useMemo(() => entriesByDay.flat(), [entriesByDay]);

  /*
   * The table's columns are the institute's canonical periods, served by
   * GET /api/timetables/current rather than inferred from the rows. That way
   * a period this section has free still gets a column, and Slot 3 sits in
   * the same place for every student.
   *
   * The fallback derives columns from the entries themselves, so the page
   * still renders against an older backend that does not send `slots`.
   */
  const slots = useMemo(() => {
    if (apiSlots.length) {
      return apiSlots.map((s) => ({
        key: `${s.start_time}-${s.end_time}`,
        start: s.start_time,
        end: s.end_time,
        number: s.slot_number,
        isCurrent: !!s.is_current,
      }));
    }

    const map = new Map();
    allEntries.forEach((e) => {
      const key = `${e.start_time}-${e.end_time}`;
      if (!map.has(key)) {
        map.set(key, { key, start: e.start_time, end: e.end_time, mins: toMinutes(e.start_time) ?? 0 });
      }
    });
    return [...map.values()]
      .sort((a, b) => a.mins - b.mins)
      .map((s, i) => ({ ...s, number: i + 1, isCurrent: false }));
  }, [apiSlots, allEntries]);

  /* entriesByDay[dayIndex][slotKey] -> the class in that cell. */
  const cellIndex = useMemo(
    () => entriesByDay.map((list) => {
      const byKey = {};
      list.forEach((e) => {
        const key = `${e.start_time}-${e.end_time}`;
        if (!byKey[key]) byKey[key] = e;
      });
      return byKey;
    }),
    [entriesByDay],
  );

  /* The slot column that is running right now, so its header can be marked.
     The server flags the live period on `slots` itself; this covers the
     fallback columns, which carry no flag. */
  const currentSlotKey = currentLecture
    ? `${currentLecture.start_time}-${currentLecture.end_time}`
    : null;

  /*
   * The table's columns: the bookable slots plus the daily break dropped into
   * its place by start time. The break is a column rather than a gap so the
   * timings stay continuous across the header and footer rows.
   */
  const columns = useMemo(() => {
    const slotCols = slots.map((slot) => ({ type: 'slot', key: slot.key, slot }));

    if (!breakPeriod) return slotCols;

    const breakStart = toMinutes(breakPeriod.start_time);
    const at = slotCols.findIndex((c) => (toMinutes(c.slot.start) ?? 0) >= breakStart);
    const breakCol = {
      type: 'break',
      key: `break-${breakPeriod.start_time}`,
      slot: {
        start: breakPeriod.start_time,
        end: breakPeriod.end_time,
        label: breakPeriod.label || 'Break',
        isCurrent: !!breakPeriod.is_current,
      },
    };

    if (at === -1) return [...slotCols, breakCol];
    return [...slotCols.slice(0, at), breakCol, ...slotCols.slice(at)];
  }, [slots, breakPeriod]);

  /*
   * Stats computed from the real rows. "Lectures" and "Labs" are split on the
   * classroom's room name because the schema has no lecture/lab flag on a
   * timetable row — a lab is a booking in a room named "Lab-*".
   */
  const stats = useMemo(() => {
    const labs = allEntries.filter((e) => /lab/i.test(e.room_name || '')).length;
    const activeDays = entriesByDay.filter((list) => list.length > 0).length;
    return {
      total: allEntries.length,
      labs,
      lectures: allEntries.length - labs,
      activeDays,
      subjects: new Set(allEntries.map((e) => e.subject_id)).size,
    };
  }, [allEntries, entriesByDay]);

  /* Busiest / lightest day, over days that actually have classes. */
  const summary = useMemo(() => {
    const counted = entriesByDay
      .map((list, i) => ({ day: DAYS[i], n: list.length }))
      .filter((d) => d.n > 0);
    if (!counted.length) return null;
    const busiest = counted.reduce((a, b) => (b.n > a.n ? b : a));
    const lightest = counted.reduce((a, b) => (b.n < a.n ? b : a));
    return {
      busiest,
      lightest,
      avg: (allEntries.length / counted.length).toFixed(1),
    };
  }, [entriesByDay, allEntries]);

  /* The next four classes from now, in week order starting today. */
  const upcoming = useMemo(() => {
    if (todayIndex === -1) {
      // Sunday: just show the start of the week.
      return entriesByDay.flatMap((list, i) => list.map((e) => ({ ...e, dayIndex: i }))).slice(0, 4);
    }
    const out = [];
    for (let step = 0; step < DAYS.length && out.length < 4; step += 1) {
      const i = (todayIndex + step) % DAYS.length;
      entriesByDay[i].forEach((e) => {
        if (out.length >= 4) return;
        // Skip what has already finished today.
        if (step === 0 && e.is_past) return;
        out.push({ ...e, dayIndex: i });
      });
    }
    return out;
  }, [entriesByDay, todayIndex]);

  const clockNow = now?.server_time ? new Date(now.server_time) : new Date();

  /* One <td>: either the class booked in that day/slot, or a free period. */
  const renderCell = (dayIndex, slot) => {
    const entry = cellIndex[dayIndex]?.[slot.key];

    if (!entry) {
      return (
        <td className="tt-cell tt-cell-free" key={slot.key}>
          <span className="cell-free-mark">—</span>
        </td>
      );
    }

    const colors = subjectColor(entry.subject_code);

    return (
      <td
        className={`tt-cell tt-cell-class ${entry.is_current ? 'cell-now' : ''} ${entry.is_past ? 'cell-past' : ''}`}
        key={slot.key}
        style={{ background: colors.bg, borderLeftColor: colors.accent }}
      >
        <span className="cell-code" style={{ color: colors.accent }}>{entry.subject_code}</span>
        <span className="cell-subject">{entry.subject_name}</span>
        <span className="cell-meta">
          <IconMapPin /> <span>{entry.room_name || '—'}</span>
        </span>
        <span className="cell-meta">
          <IconUser /> <span>{entry.teacher_name || '—'}</span>
        </span>
      </td>
    );
  };

  /* Distinct subjects, for the legend. */
  const legend = useMemo(() => {
    const map = new Map();
    allEntries.forEach((e) => {
      if (e.subject_code && !map.has(e.subject_code)) map.set(e.subject_code, subjectColor(e.subject_code));
    });
    return [...map.entries()];
  }, [allEntries]);

  return (
    <div className="dashboard-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* ── Sidebar ── */}
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

      {/* ── Main wrapper ── */}
      <div className="main-wrapper">
        {/* Top header (shared: chatbot, notifications, profile) */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Timetable</span>
        </div>

        {/* ── Page content ── */}
        <div className="tt-page">
          {/* Header row */}
          <div className="tt-page-header">
            <div>
              <h1 className="tt-title">Timetable</h1>
              {/* No term or effective-date range: the timetable rows carry no
                  term, and the previous "Spring 2024 — Effective Jul 22 – Oct
                  18" was invented. The server's own date is shown instead. */}
              <p className="tt-subtitle">
                {now ? `${now.day}, ${now.date}${now.timezone ? ` · ${now.timezone}` : ''}` : 'Your weekly schedule'}
              </p>
            </div>
            <div className="tt-header-actions">
              {/* Day view needs a day to show; the week strip below the header
                  is a label rather than a picker, so the choice lives here. */}
              {viewMode === 'day' && (
                <select
                  className="tt-day-select"
                  value={activeDay}
                  onChange={(e) => setActiveDay(Number(e.target.value))}
                  aria-label="Day to show"
                >
                  {DAYS.map((day, i) => (
                    <option key={day} value={i}>
                      {day}{todayIndex === i ? ' (Today)' : ''}
                    </option>
                  ))}
                </select>
              )}
              <div className="view-toggle">
                <button
                  className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
                  onClick={() => setViewMode('week')}
                >
                  Week
                </button>
                <button
                  className={`toggle-btn ${viewMode === 'day' ? 'active' : ''}`}
                  onClick={() => setViewMode('day')}
                >
                  Day
                </button>
              </div>
            </div>
          </div>

          {/* The spinner that was here told you a timetable was coming without
              showing you where it would be. A week grid of empty slot blocks
              does both, and the real grid drops into the same footprint. */}
          {loading ? (
            <SkeletonRegion label="Loading your timetable">
              <SkeletonTimetable days={6} slots={5} />
            </SkeletonRegion>
          ) : error ? (
            <div className="tt-state error">
              <IconAlertCircle />
              <p>Could not load your timetable</p>
              <span>{error}</span>
              <button className="toggle-btn active" onClick={reload}>Try again</button>
            </div>
          ) : allEntries.length === 0 ? (
            <div className="tt-state">
              <IconClock />
              <p>No classes scheduled</p>
              <span>Your section has no timetable entries yet.</span>
            </div>
          ) : (
            <>
              {/* Live "now" strip */}
              <div className="tt-now-bar">
                {currentLecture ? (
                  <span className="tt-now-live">
                    <span className="tt-now-dot" />
                    In class now: <strong>{currentLecture.subject_code} {currentLecture.subject_name}</strong>
                    {currentLecture.room_name ? ` · ${currentLecture.room_name}` : ''}
                    {' · '}{formatRange(currentLecture.start_time, currentLecture.end_time)}
                  </span>
                ) : nextLecture ? (
                  <span className="tt-now-next">
                    Next class: <strong>{nextLecture.subject_code} {nextLecture.subject_name}</strong>
                    {' · '}{nextLecture.day_of_week} {formatTime(nextLecture.start_time)}
                    {nextLecture.room_name ? ` · ${nextLecture.room_name}` : ''}
                  </span>
                ) : (
                  <span className="tt-now-next">No upcoming classes scheduled</span>
                )}
              </div>

              {/* Stats row — counted from the real timetable rows */}
              <div className="tt-stats-row">
                <div className="tt-stat-card">
                  <span className="tt-stat-value">{stats.total}</span>
                  <span className="tt-stat-label">Classes / Week</span>
                </div>
                <div className="tt-stat-card">
                  <span className="tt-stat-value">{stats.subjects}</span>
                  <span className="tt-stat-label">Subjects</span>
                </div>
                <div className="tt-stat-card">
                  <span className="tt-stat-value">{stats.lectures}</span>
                  <span className="tt-stat-label">Lectures</span>
                </div>
                <div className="tt-stat-card">
                  <span className="tt-stat-value">{stats.labs}</span>
                  <span className="tt-stat-label">Labs</span>
                </div>
              </div>

              {/* Main content grid */}
              <div className="tt-content-grid">
                {/* ── Weekly schedule ── */}
                <div className="tt-schedule-card">
                  {/* The week's dates — a compact, static strip. The table
                      below already lists every day as a row, so this is a
                      label for the week on show, not a control. */}
                  <div className="tt-week-strip">
                    {DAYS.map((day, i) => (
                      <span
                        className={`tt-week-day ${todayIndex === i ? 'is-today' : ''}`}
                        key={day}
                      >
                        <span className="wd-name">{day.slice(0, 3)}</span>
                        <span className="wd-date">{weekDateLabel(clockNow, i)}</span>
                      </span>
                    ))}
                  </div>

                  {/* ── The timetable proper: one row per day, one column per
                       slot. The period timings head the columns and repeat in
                       the footer so they stay readable on a tall table. ── */}
                  <div className="tt-table-wrap">
                    {viewMode === 'week' ? (
                      <table className="tt-table">
                        <thead>
                          <tr>
                            <th className="tt-corner" scope="col">Day</th>
                            {columns.map((col) => col.type === 'break' ? (
                              <th className={`tt-slot-head is-break ${col.slot.isCurrent ? 'slot-head-now' : ''}`} key={col.key} scope="col">
                                <span className="slot-num">{col.slot.label}</span>
                                <span className="slot-time">{formatRange(col.slot.start, col.slot.end)}</span>
                              </th>
                            ) : (
                              <th
                                className={`tt-slot-head ${col.slot.isCurrent || currentSlotKey === col.key ? 'slot-head-now' : ''}`}
                                key={col.key}
                                scope="col"
                              >
                                <span className="slot-num">Slot {col.slot.number}</span>
                                <span className="slot-time">{formatRange(col.slot.start, col.slot.end)}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          {DAYS.map((day, di) => (
                            <tr
                              className={`${todayIndex === di ? 'tt-row-today' : ''} ${activeDay === di ? 'tt-row-active' : ''}`}
                              key={day}
                            >
                              <th className="tt-day-head-cell" scope="row">
                                <span className="day-name">{day}</span>
                                <span className="day-date">{weekDateLabel(clockNow, di)}</span>
                                {todayIndex === di && <span className="day-today-tag">Today</span>}
                              </th>
                              {columns.map((col) => col.type === 'break' ? (
                                <td className="tt-cell tt-cell-break" key={col.key}>
                                  <span className="cell-break-label">{col.slot.label}</span>
                                </td>
                              ) : renderCell(di, col.slot))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      /* Day view: the same data as one day's row, unrolled so
                         the teacher and full period fit without squeezing. */
                      <table className="tt-table tt-table-day">
                        <thead>
                          <tr>
                            <th scope="col">Slot</th>
                            <th scope="col">Time</th>
                            <th scope="col">Code</th>
                            <th scope="col">Subject</th>
                            <th scope="col">Teacher</th>
                            <th scope="col">Room</th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(entriesByDay[activeDay] || []).length === 0 ? (
                            <tr>
                              <td className="tt-day-empty" colSpan={7}>
                                No classes scheduled on {DAYS[activeDay]}.
                              </td>
                            </tr>
                          ) : (entriesByDay[activeDay] || []).map((entry) => {
                            const slot = slots.find(
                              (s) => s.key === `${entry.start_time}-${entry.end_time}`,
                            );
                            const colors = subjectColor(entry.subject_code);
                            return (
                              <tr
                                className={`${entry.is_current ? 'cell-now' : ''} ${entry.is_past ? 'cell-past' : ''}`}
                                key={entry.timetable_id}
                              >
                                <td className="td-slot">{slot ? slot.number : '—'}</td>
                                <td className="td-time">{formatRange(entry.start_time, entry.end_time)}</td>
                                <td className="td-code" style={{ color: colors.accent }}>{entry.subject_code}</td>
                                <td className="td-subject">{entry.subject_name}</td>
                                <td>{entry.teacher_name || '—'}</td>
                                <td>{entry.room_name || '—'}</td>
                                <td>
                                  {entry.is_current ? (
                                    <span className="td-badge badge-now">Now</span>
                                  ) : entry.is_past ? (
                                    <span className="td-badge badge-done">Done</span>
                                  ) : (
                                    <span className="td-badge badge-next">Upcoming</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Legend — the subjects this student actually has */}
                  <div className="tt-legend">
                    {legend.map(([code, colors]) => (
                      <span className="tt-legend-item" key={code}>
                        <span className="legend-swatch" style={{ background: colors.bg, borderColor: colors.border }}></span>
                        {code}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Right sidebar: Upcoming + summary ── */}
                <div className="tt-sidebar">
                  {/* Upcoming classes */}
                  <div className="tt-upcoming-card">
                    <div className="tt-upcoming-header">
                      <span className="card-title">Upcoming Classes</span>
                      <span className="upcoming-count">{upcoming.length}</span>
                    </div>
                    <div className="tt-upcoming-list">
                      {upcoming.length === 0 ? (
                        <span className="tt-upcoming-empty">Nothing left this week.</span>
                      ) : upcoming.map((cls) => (
                        <div className="tt-upcoming-item" key={`${cls.timetable_id}-${cls.dayIndex}`}>
                          <div className="upcoming-day-block">
                            <span className="upcoming-day">{DAYS[cls.dayIndex].slice(0, 3)}</span>
                            <span className="upcoming-date">{weekDateLabel(clockNow, cls.dayIndex)}</span>
                          </div>
                          <div className="upcoming-info">
                            <span className="upcoming-subject">{cls.subject_name}</span>
                            <span className="upcoming-code">{cls.subject_code}</span>
                            <div className="upcoming-meta">
                              <span><IconClock /> {formatTime(cls.start_time)}</span>
                              <span><IconMapPin /> {cls.room_name || '—'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Summary — every figure counted from the real rows.
                      The old card asserted "Busiest Day: Monday" and "Free
                      Slots This Week: 26 hrs" regardless of the data. */}
                  {summary && (
                    <div className="tt-summary-card">
                      <span className="card-title">Schedule Summary</span>
                      <div className="tt-summary-body">
                        <div className="tt-summary-row">
                          <span className="summary-row-label">Active Days</span>
                          <span className="summary-row-value">{stats.activeDays} / {DAYS.length}</span>
                        </div>
                        <div className="tt-summary-row">
                          <span className="summary-row-label">Daily Avg Classes</span>
                          <span className="summary-row-value">~{summary.avg}</span>
                        </div>
                        <div className="tt-summary-row">
                          <span className="summary-row-label">Busiest Day</span>
                          <span className="summary-row-value">{summary.busiest.day} ({summary.busiest.n})</span>
                        </div>
                        <div className="tt-summary-row">
                          <span className="summary-row-label">Lightest Day</span>
                          <span className="summary-row-value">{summary.lightest.day} ({summary.lightest.n})</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Today's classes, in order. Replaces a hardcoded "Lab coats
                      required for CS607" reminder that had no source. */}
                  <div className="tt-summary-card">
                    <span className="card-title">Today · {now?.day || '—'}</span>
                    <div className="tt-summary-body">
                      {today.length === 0 ? (
                        <span className="tt-upcoming-empty">No classes today.</span>
                      ) : today.map((e) => (
                        <div className={`tt-summary-row ${e.is_current ? 'accent' : ''}`} key={e.timetable_id}>
                          <span className="summary-row-label">
                            {formatTime(e.start_time)} · {e.subject_code}
                          </span>
                          <span className={`summary-row-value ${e.is_current ? 'green' : ''}`}>
                            {e.is_current ? 'Now' : e.is_past ? 'Done' : e.room_name || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimeTable;
