import { useCallback, useEffect, useRef, useState } from 'react';
import { timetables as timetablesApi } from '../api/endpoints';

/**
 * The signed-in user's real timetable, from GET /api/timetables/current.
 *
 * Both timetable pages used to render a hardcoded constant: the student page
 * had a WEEK_SCHEDULE of invented subjects ("Machine Learning", "Dr. Khan",
 * "LH-305") and the faculty page a SCHEDULE of four fictional CS courses.
 * useCurrentSchedule then highlighted "now" correctly — but over rows that did
 * not correspond to anything in the database.
 *
 * The backend already does the hard part. It resolves the caller's scope from
 * the token, evaluates the clock in the institute's timezone (Asia/Karachi),
 * and marks each entry is_today / is_current / is_past / is_upcoming, so the
 * highlight no longer depends on the browser's clock or timezone being right.
 *
 * Refresh strategy: the response carries `seconds_until_change`, the time until
 * the current/next lecture boundary. Refetching on that boundary keeps the page
 * live without polling every minute all day.
 */

const FALLBACK_REFRESH_MS = 5 * 60 * 1000;
const MIN_REFRESH_MS = 15 * 1000;

/**
 * @param {object} [options]
 * @param {number|string|null} [options.studentId]
 *   Which student to resolve. A student caller is always resolved from their
 *   own token and ignores this; a PARENT caller uses it to pick which of their
 *   children the schedule is for, and the guardian link is what authorises it —
 *   an unrelated id is refused by the server, not filtered here.
 */
export default function useLiveTimetable({ studentId = null } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const timer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      // The browser's zone is sent so the server can answer in the viewer's
      // local time; it validates the name and falls back to the institute's.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const params = {};
      if (timezone) params.timezone = timezone;
      if (studentId !== null && studentId !== undefined) params.student_id = studentId;

      const res = await timetablesApi.current(Object.keys(params).length ? params : undefined);
      if (!mounted.current) return;

      setData(res);

      // Re-arm on the next lecture boundary, clamped so a boundary that is
      // already passing cannot spin the request in a tight loop.
      const seconds = Number(res?.seconds_until_change);
      const delay = Number.isFinite(seconds) && seconds > 0
        ? Math.max(seconds * 1000 + 1000, MIN_REFRESH_MS)
        : FALLBACK_REFRESH_MS;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => load({ silent: true }), delay);

    } catch (err) {
      if (mounted.current) setError(err.message || 'Could not load your timetable');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  return {
    /** { timezone, date, day, time, is_teaching_day } as evaluated by the server. */
    now: data?.now || null,
    /** [{ day, is_today, entries: [...] }] for Monday..Saturday. */
    week: data?.week || [],
    /** Today's entries, already ordered by start time. */
    today: data?.today || [],
    /**
     * The institute's canonical period grid — [{ slot_number, start_time,
     * end_time, is_current }] — and the non-bookable break between slots 3
     * and 4. The timetable table renders a column per slot from this, so a
     * period the section has free still gets a column, and the columns stay
     * in the same place for every section.
     */
    slots: data?.slots || [],
    breakPeriod: data?.break || null,
    currentLecture: data?.current_lecture || null,
    nextLecture: data?.next_lecture || null,
    scope: data?.scope || null,
    loading,
    error,
    reload: load,
  };
}

/** "09:00:00" -> "9:00 AM". Times come from MySQL TIME columns. */
export const formatTime = (value) => {
  if (!value) return '';
  const [h, m] = String(value).split(':').map(Number);
  if (!Number.isFinite(h)) return String(value);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${period}`;
};

/** "09:00:00" – "10:30:00" -> "9:00 AM – 10:30 AM". */
export const formatRange = (start, end) => `${formatTime(start)} – ${formatTime(end)}`;

/** Minutes since midnight, used to place an entry on an hourly grid. */
export const toMinutes = (value) => {
  const [h, m] = String(value || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

/**
 * A stable colour per subject code, so the same subject keeps its colour
 * across renders without a hardcoded palette keyed to invented course codes.
 */
const PALETTE = [
  { accent: '#2a63c9', bg: '#eaf1fd', border: '#93c5fd' },
  { accent: '#1f9d55', bg: '#e7f7ee', border: '#6ee7b7' },
  { accent: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
  { accent: '#7c3aed', bg: '#f1eafd', border: '#c4b5fd' },
  { accent: '#be185d', bg: '#fce7f3', border: '#f9a8d4' },
  { accent: '#0369a1', bg: '#e0f2fe', border: '#7dd3fc' },
  { accent: '#d1373f', bg: '#fdeaea', border: '#fca5a5' },
  { accent: '#0f766e', bg: '#ccfbf1', border: '#5eead4' },
];

export const subjectColor = (code) => {
  const key = String(code || '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
};
