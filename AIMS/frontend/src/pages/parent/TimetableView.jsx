import { useEffect, useMemo, useRef, useState } from 'react';
import useLiveTimetable, {
  formatTime, formatRange, toMinutes, subjectColor,
} from '../../hooks/useLiveTimetable';
import { IconClock, IconUser, IconMapPin, IconAlertCircle } from '../../components/student/icons';
import '../student/TimeTable.css';
import { SkeletonRegion, SkeletonTimetable } from '../../components/common/Skeleton';

/*
 * The selected child's timetable — the same screen the student sees, driven by
 * the same endpoint.
 *
 * What stood here before was assembled on the client: the rows came from
 * /api/parent/timetable, which returns raw `timetables` records carrying only
 * foreign keys, so the room was printed as "Room 7" from classroom_id and the
 * teacher could not be shown at all. A footer then told the parent the
 * timetable was "generated from enrolled subjects", with each subject repeated
 * "to match the credit load" — describing a fabrication, not the schedule.
 *
 * GET /api/timetables/current already answers this properly, and already
 * accepts a parent: resolveScope's PARENT branch takes ?student_id= and
 * authorises it against the guardian link, so an unrelated id is refused by
 * the server. It resolves the child's section, joins the subject, teacher and
 * classroom names, returns the institute's canonical period grid plus the
 * break, and evaluates the clock in the institute's timezone — so is_current /
 * is_past do not depend on the parent's device clock.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "12 Aug" for the given weekday of the week containing `now`. */
const weekDateLabel = (now, dayIndex) => {
  const mondayOffset = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const date = new Date(now);
  date.setDate(now.getDate() + mondayOffset + dayIndex);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function ParentTimetableView({ wards, selectedChildId }) {
  const [viewMode, setViewMode] = useState('week');
  const [activeDay, setActiveDay] = useState(0);

  const child = wards.find((c) => c.id === selectedChildId) || wards[0];

  const {
    now, week, slots: apiSlots, breakPeriod,
    currentLecture, nextLecture, loading, error, reload,
  } = useLiveTimetable({ studentId: child ? child.studentId ?? child.id : null });

  const todayIndex = now?.day ? DAYS.indexOf(now.day) : -1;

  // Jump to today once the server has told us what day it is, but never fight
  // the parent afterwards if they pick another day.
  const autoDayRef = useRef(null);
  useEffect(() => {
    if (todayIndex === -1) return;
    if (autoDayRef.current === todayIndex) return;
    autoDayRef.current = todayIndex;
    setActiveDay(todayIndex);
  }, [todayIndex]);

  const entriesByDay = useMemo(() => {
    const map = DAYS.map(() => []);
    (week || []).forEach((d) => {
      const i = DAYS.indexOf(d.day);
      if (i >= 0) map[i] = d.entries || [];
    });
    return map;
  }, [week]);

  const allEntries = useMemo(() => entriesByDay.flat(), [entriesByDay]);

  // Columns are the institute's canonical periods, so a period this section
  // has free still gets a column and Slot 3 sits in the same place every week.
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

  // The break is a column rather than a gap, so timings stay continuous.
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

  /* Counted from the real rows. The schema has no lecture/lab flag on a
     timetable row, so a lab is a booking in a room named "Lab-*". */
  const stats = useMemo(() => {
    const labs = allEntries.filter((e) => /lab/i.test(e.room_name || '')).length;
    return {
      total: allEntries.length,
      labs,
      lectures: allEntries.length - labs,
      activeDays: entriesByDay.filter((list) => list.length > 0).length,
      subjects: new Set(allEntries.map((e) => e.subject_id)).size,
    };
  }, [allEntries, entriesByDay]);

  const clockNow = now?.server_time ? new Date(now.server_time) : new Date();

  const legend = useMemo(() => {
    const map = new Map();
    allEntries.forEach((e) => {
      if (e.subject_code && !map.has(e.subject_code)) {
        map.set(e.subject_code, subjectColor(e.subject_code));
      }
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
          <IconMapPin /> <span>{entry.room_name || '—'}</span>
        </span>
        <span className="cell-meta">
          <IconUser /> <span>{entry.teacher_name || '—'}</span>
        </span>
      </td>
    );
  };

  if (!child) return null;

  return (
    <div className="tt-page">
      <div className="tt-page-header">
        <div>
          <h2>Timetable</h2>
          <span>
            {child.name}
            {child.section && child.section !== '—' ? ` · Section ${child.section}` : ''}
            {child.semester ? ` · ${child.semester}` : ''}
          </span>
        </div>

        <div className="tt-header-actions">
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
          {viewMode === 'day' && (
            <select
              className="tt-day-select"
              value={activeDay}
              onChange={(e) => setActiveDay(Number(e.target.value))}
            >
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Switching child refetches, so this branch is hit while the screen is
          already on view. A week grid of empty slots keeps the layout still;
          the sentence it replaced collapsed the whole panel to one line. */}
      {loading ? (
        <SkeletonRegion label={`Loading ${child.name}'s timetable`}>
          <SkeletonTimetable days={6} slots={5} />
        </SkeletonRegion>
      ) : error ? (
        <div className="tt-state">
          <IconAlertCircle />
          <p>Could not load the timetable</p>
          <span>{error}</span>
          <button className="toggle-btn active" onClick={reload}>Try again</button>
        </div>
      ) : allEntries.length === 0 ? (
        <div className="tt-state">
          <IconClock />
          <p>No classes scheduled</p>
          <span>{child.name}’s section has no timetable entries yet.</span>
        </div>
      ) : (
        <>
          {/* Live "now" strip — the clock is the server's, in the institute's
              timezone, so this stays right regardless of the parent's device. */}
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

          {/* Single column: the side cards that occupied the second track
              (Upcoming Classes, Schedule Summary, Today) have been removed, so
              the schedule takes the full width instead of leaving a 280px gap. */}
          <div className="tt-content-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="tt-schedule-card">
              {/* The week-date strip that stood here (Mon 3 Aug, Tue 4 Aug, …)
                  is gone: the table below already carries every day as a row
                  with the same date beside it, so the strip only repeated it. */}
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

              <div className="tt-legend">
                {legend.map(([code, colors]) => (
                  <span className="tt-legend-item" key={code}>
                    <span className="legend-swatch" style={{ background: colors.bg, borderColor: colors.border }} />
                    {code}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
