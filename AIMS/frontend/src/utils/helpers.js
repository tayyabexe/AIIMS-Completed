// Shared formatting + grading helpers used across AIMS pages.

import { formatMoney } from './currency';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function gradeFor(marks, total) {
  const pct = total > 0 ? (marks / total) * 100 : 0;
  if (pct >= 90) return { label: 'A+', tone: 'success', pct };
  if (pct >= 80) return { label: 'A', tone: 'success', pct };
  if (pct >= 70) return { label: 'B+', tone: 'info', pct };
  if (pct >= 60) return { label: 'B', tone: 'info', pct };
  if (pct >= 50) return { label: 'C', tone: 'warning', pct };
  return { label: 'F', tone: 'danger', pct };
}

export function pctOf(marks, total) {
  return total > 0 ? Math.round((marks / total) * 1000) / 10 : 0;
}

/**
 * Letter grade for a GPA/CGPA on the 4.0 scale.
 *
 * The admin screens and PDF reports used to grade students from an
 * `examScore` percentage, but no such figure exists in aims_db and the loader
 * never populated it — every student came out as 0% and grade F. What the
 * database does hold is `results.gpa` and `results.cgpa`, so grading is done
 * from those.
 *
 * Returns null when there is no published result, so "not graded yet" stays
 * distinguishable from "graded badly".
 */
export function gradeFromGpa(gpa) {
  if (gpa === null || gpa === undefined || Number.isNaN(Number(gpa))) return null;

  const g = Number(gpa);
  if (g >= 3.7) return 'A';
  if (g >= 3.3) return 'A-';
  if (g >= 3.0) return 'B+';
  if (g >= 2.7) return 'B';
  if (g >= 2.3) return 'B-';
  if (g >= 2.0) return 'C';
  if (g >= 1.0) return 'D';
  return 'F';
}

/** The 2.0 CGPA pass requirement used across the portals. */
export const PASS_GPA = 2.0;

// '2026-07-28' -> '28 Jul 2026'
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// '2026-07-28' -> 'Jul 28, 2026'
export function fmtDateShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

// minutes since midnight -> '9:05 AM'
export function fmtTime(min) {
  if (min === null || min === undefined || min === '') return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// minutes -> '7h 25m'
export function fmtDuration(min) {
  if (min === null || min === undefined || min === '') return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// Kept as the name the faculty pages already import; the symbol itself now
// comes from utils/currency so there is a single place it is defined.
export function fmtMoney(n) {
  return formatMoney(n ?? 0);
}

// 'HH:MM' (24h) -> minutes since midnight
// '9:05 AM'/'9:05 PM' (12h) -> minutes since midnight
export function timeToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  const is12h = /(am|pm)/i.test(s);
  const [hm, suffix] = s.split(/\s+/);
  let [h, m] = hm.split(':').map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (is12h) {
    const pm = /pm/i.test(suffix || '');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return h * 60 + m;
}
