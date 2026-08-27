import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, MapPin, Users, AlertCircle } from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import useLiveTimetable, {
  formatTime, formatRange, toMinutes, subjectColor,
} from '../../hooks/useLiveTimetable';
// The student portal's timetable layout, reused verbatim so both portals read
// the same way. The faculty page previously had its own hour-grid table in
// TeeacherTimetable.css, which is no longer imported here.
import '../student/TimeTable.css';

/*
 * The teacher's real timetable, from GET /api/timetables/current — the same
 * endpoint the student page uses, which resolves teacher_id from the token and
 * marks the live entry server-side in the institute's timezone.
 *
 * The one difference from the student view: a cell names the *section* rather
 * than the teacher, because the teacher is the same on every row here.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const weekDateLabel = (now, dayIndex) => {
  const mondayOffset = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const date = new Date(now);
  date.setDate(now.getDate() + mondayOffset + dayIndex);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function TeacherTimetable() {
  const [viewMode, setViewMode] = useState('week');

  const {
    now, week, today, slots: apiSlots, breakPeriod,
    currentLecture, nextLecture, loading, error, reload,
  } = useLiveTimetable();

  const todayIndex = now?.day ? DAYS.indexOf(now.day) : -1;
  const selectableDayIndex = todayIndex === -1 ? 0 : todayIndex;

  const [activeDay, setActiveDay] = useState(0);

  const autoDayRef = useRef(null);
  useEffect(() => {
    if (autoDayRef.current !== null && activeDay !== autoDayRef.current) return;
    autoDayRef.current = selectableDayIndex;
    setActiveDay(selectableDayIndex);
  }, [selectableDayIndex, activeDay]);

  const entriesByDay = useMemo(() => {
    const map = DAYS.map(() => []);
    week.forEach((d) => {
      const i = DAYS.indexOf(d.day);
      if (i >= 0) {
        map[i] = [...(d.entries || [])].sort(
          (a, b) => (toMinutes(a.start_time) || 0) - (toMinutes(b.start_time) || 0),
        );
      }
    });
    return map;
  }, [week]);

  const allEntries = useMemo(() => entriesByDay.flat(), [entriesByDay]);

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

  /*
   * A teacher can be timetabled against two different sections in the same
   * period on different days, so a cell is keyed by slot and may hold more
   * than one entry on a given day only if the data is inconsistent — the
   * first is shown, as on the student page.
   */
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

  const currentSlotKey = currentLecture
    ? `${currentLecture.start_time}-${currentLecture.end_time}`
    : null;

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

  const stats = useMemo(() => {
    const labs = allEntries.filter((e) => /lab/i.test(e.room_name || '')).length;
    const activeDays = entriesByDay.filter((list) => list.length > 0).length;
    return {
      total: allEntries.length,
      labs,
      lectures: allEntries.length - labs,
      activeDays,
      subjects: new Set(allEntries.map((e) => e.subject_id)).size,
      sections: new Set(allEntries.map((e) => e.section_id)).size,
    };
  }, [allEntries, entriesByDay]);

  const summary = useMemo(() => {
    const counted = entriesByDay
      .map((list, i) => ({ day: DAYS[i], n: list.length }))
      .filter((d) => d.n > 0);
    if (!counted.length) return null;
    return {
      busiest: counted.reduce((a, b) => (b.n > a.n ? b : a)),
      lightest: counted.reduce((a, b) => (b.n < a.n ? b : a)),
      avg: (allEntries.length / counted.length).toFixed(1),
    };
  }, [entriesByDay, allEntries]);

  const upcoming = useMemo(() => {
    if (todayIndex === -1) {
      return entriesByDay
        .flatMap((list, i) => list.map((e) => ({ ...e, dayIndex: i })))
        .slice(0, 4);
    }
    const out = [];
    for (let step = 0; step < DAYS.length && out.length < 4; step += 1) {
      const i = (todayIndex + step) % DAYS.length;
      entriesByDay[i].forEach((e) => {
        if (out.length >= 4) return;
        if (step === 0 && e.is_past) return;
        out.push({ ...e, dayIndex: i });
      });
    }
    return out;
  }, [entriesByDay, todayIndex]);

  const clockNow = now?.server_time ? new Date(now.server_time) : new Date();

  const legend = useMemo(() => {
    const map = new Map();
    allEntries.forEach((e) => {
      if (e.subject_code && !map.has(e.subject_code)) map.set(e.subject_code, subjectColor(e.subject_code));
    });
    return [...map.entries()];
  }, [allEntries]);

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
          <MapPin size={11} /> <span>{entry.room_name || '—'}</span>
        </span>
        <span className="cell-meta">
          {/* The teacher is the same on every row of their own timetable, so
              the section is the useful identifier here. */}
          <Users size={11} /> <span>{entry.section_name ? `Sec ${entry.section_name}` : '—'}</span>
        </span>
      </td>
    );
  };

  return (
    <Layout title="Timetable">
      <div className="tt-page">
        <div className="tt-page-header">
          <div>
            <h1 className="tt-title">Timetable</h1>
            <p className="tt-subtitle">
              {now
                ? `${now.day}, ${now.date}${now.timezone ? ` · ${now.timezone}` : ''}`
                : 'Your weekly teaching schedule'}
            </p>
          </div>
          <div className="tt-header-actions">
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

        {loading ? (
          <div className="tt-state">
            <span className="tt-spinner" />
            <p>Loading your timetable…</p>
          </div>
        ) : error ? (
          <div className="tt-state error">
            <AlertCircle size={22} />
            <p>Could not load your timetable</p>
            <span>{error}</span>
            <button className="toggle-btn active" onClick={reload}>Try again</button>
          </div>
        ) : allEntries.length === 0 ? (
          <div className="tt-state">
            <Clock size={22} />
            <p>No classes scheduled</p>
            <span>You have no timetable entries assigned yet.</span>
          </div>
        ) : (
          <>
            <div className="tt-now-bar">
              {currentLecture ? (
                <span className="tt-now-live">
                  <span className="tt-now-dot" />
                  In class now: <strong>{currentLecture.subject_code} {currentLecture.subject_name}</strong>
                  {currentLecture.section_name ? ` · Sec ${currentLecture.section_name}` : ''}
                  {currentLecture.room_name ? ` · ${currentLecture.room_name}` : ''}
                  {' · '}{formatRange(currentLecture.start_time, currentLecture.end_time)}
                </span>
              ) : nextLecture ? (
                <span className="tt-now-next">
                  Next class: <strong>{nextLecture.subject_code} {nextLecture.subject_name}</strong>
                  {nextLecture.section_name ? ` · Sec ${nextLecture.section_name}` : ''}
                  {' · '}{nextLecture.day_of_week} {formatTime(nextLecture.start_time)}
                  {nextLecture.room_name ? ` · ${nextLecture.room_name}` : ''}
                </span>
              ) : (
                <span className="tt-now-next">No upcoming classes scheduled</span>
              )}
            </div>

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
                <span className="tt-stat-value">{stats.sections}</span>
                <span className="tt-stat-label">Sections</span>
              </div>
              <div className="tt-stat-card">
                <span className="tt-stat-value">{stats.labs}</span>
                <span className="tt-stat-label">Labs</span>
              </div>
            </div>

            <div className="tt-content-grid">
              <div className="tt-schedule-card">
                <div className="tt-week-strip">
                  {DAYS.map((day, i) => (
                    <span className={`tt-week-day ${todayIndex === i ? 'is-today' : ''}`} key={day}>
                      <span className="wd-name">{day.slice(0, 3)}</span>
                      <span className="wd-date">{weekDateLabel(clockNow, i)}</span>
                    </span>
                  ))}
                </div>

                <div className="tt-table-wrap">
                  {viewMode === 'week' ? (
                    <table className="tt-table">
                      <thead>
                        <tr>
                          <th className="tt-corner" scope="col">Day</th>
                          {columns.map((col) => (col.type === 'break' ? (
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
                          )))}
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
                            {columns.map((col) => (col.type === 'break' ? (
                              <td className="tt-cell tt-cell-break" key={col.key}>
                                <span className="cell-break-label">{col.slot.label}</span>
                              </td>
                            ) : renderCell(di, col.slot)))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="tt-table tt-table-day">
                      <thead>
                        <tr>
                          <th scope="col">Slot</th>
                          <th scope="col">Time</th>
                          <th scope="col">Code</th>
                          <th scope="col">Subject</th>
                          <th scope="col">Section</th>
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
                              <td>{entry.section_name ? `Sec ${entry.section_name}` : '—'}</td>
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

                <div className="tt-legend">
                  {legend.map(([code, colors]) => (
                    <span className="tt-legend-item" key={code}>
                      <span className="legend-swatch" style={{ background: colors.bg, borderColor: colors.border }} />
                      {code}
                    </span>
                  ))}
                </div>
              </div>

              <div className="tt-sidebar">
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
                          <span className="upcoming-code">
                            {cls.subject_code}
                            {cls.section_name ? ` · Sec ${cls.section_name}` : ''}
                          </span>
                          <div className="upcoming-meta">
                            <span><Clock size={11} /> {formatTime(cls.start_time)}</span>
                            <span><MapPin size={11} /> {cls.room_name || '—'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {summary && (
                  <div className="tt-summary-card">
                    <span className="card-title">Schedule Summary</span>
                    <div className="tt-summary-body">
                      <div className="tt-summary-row">
                        <span className="summary-row-label">Teaching Days</span>
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

                <div className="tt-summary-card">
                  <span className="card-title">Today · {now?.day || '—'}</span>
                  <div className="tt-summary-body">
                    {today.length === 0 ? (
                      <span className="tt-upcoming-empty">No classes today.</span>
                    ) : today.map((e) => (
                      <div className={`tt-summary-row ${e.is_current ? 'accent' : ''}`} key={e.timetable_id}>
                        <span className="summary-row-label">
                          {formatTime(e.start_time)} · {e.subject_code}
                          {e.section_name ? ` (${e.section_name})` : ''}
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
    </Layout>
  );
}
