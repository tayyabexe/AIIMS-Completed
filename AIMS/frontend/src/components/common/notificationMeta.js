/*
 * How a notification category is drawn, in one place for all four portals.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bell drew EVERY row with the same generic bell glyph in a coloured
 * circle. Fourteen categories — a fee challan, a result, a password change, a
 * timetable move — were visually identical, so a dropdown of ten rows was ten
 * identical shapes and the reader had to fall back on reading every title.
 * The icon was carrying no information at all.
 *
 * The faculty Notifications PAGE already had a proper per-category map
 * (TAG_META in pages/faculty/Notifications.jsx). The bell did not, and the
 * student, parent and admin pages each had their own partial version. Four
 * maps for one set of categories is four chances for the same event to be
 * drawn differently on two screens of the same product, and it had already
 * happened.
 *
 * The keys are `notifications.type` values as the server writes them.
 * Anything unlisted falls back to DEFAULT_META rather than being hidden, so a
 * category added to the backend later still renders — it just renders plainly.
 */

import {
  Bell, Wallet, GraduationCap, ClipboardCheck, KeyRound, FileText,
  Megaphone, UserMinus, BookOpen, CalendarRange, UserPlus, Award,
  Users, FileCheck,
} from 'lucide-react';

/*
 * Four tones, and they are the only four.
 *
 * `danger` was previously defined by the bell's own style map but not by three
 * of the four portals, so the most urgent rows fell back to the flattest
 * looking one. Every tone is defined here and every surface reads this, so
 * that cannot recur.
 */
export const TONES = ['info', 'success', 'warning', 'danger'];

export const DEFAULT_META = { icon: Bell, tone: 'info' };

export const TAG_META = {
  Fee: { icon: Wallet, tone: 'warning' },
  Result: { icon: FileText, tone: 'success' },
  Exam: { icon: GraduationCap, tone: 'info' },
  Attendance: { icon: ClipboardCheck, tone: 'warning' },
  Account: { icon: KeyRound, tone: 'info' },
  Registration: { icon: UserPlus, tone: 'info' },
  Academic: { icon: Megaphone, tone: 'info' },
  Leave: { icon: UserMinus, tone: 'warning' },
  HR: { icon: Users, tone: 'info' },
  Payroll: { icon: Wallet, tone: 'success' },
  Library: { icon: BookOpen, tone: 'info' },
  Document: { icon: FileCheck, tone: 'info' },
  Meeting: { icon: CalendarRange, tone: 'info' },
  Scholarship: { icon: Award, tone: 'success' },
  Timetable: { icon: CalendarRange, tone: 'info' },
};

/**
 * The icon and tone for one feed item.
 *
 * The item's own `type` (already resolved from the server's `priority`, then
 * the category — see api/notificationsData.js) wins on TONE, because only the
 * emitter knows whether attendance merely changed or fell below 75%. The
 * category decides the ICON, because that is what the category is for.
 */
export const metaFor = (item) => {
  const base = TAG_META[item?.tag] || DEFAULT_META;
  const tone = TONES.includes(item?.type) ? item.type : base.tone;
  return { icon: base.icon, tone };
};

/*
 * Day bucket for a feed row, so the dropdown can put a heading between
 * "half an hour ago" and "last March" instead of running them together.
 *
 * Buckets rather than exact dates: a notification list is read as "what has
 * happened lately", and three headings answer that better than fourteen dated
 * ones. Anything without a usable timestamp goes to 'earlier' rather than
 * being dropped.
 */
export const dayBucket = (createdAt) => {
  if (!createdAt) return 'earlier';

  const then = new Date(createdAt);
  if (Number.isNaN(then.getTime())) return 'earlier';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const day = startOfDay(then);

  if (day >= today) return 'today';
  if (day >= today - 86400000) return 'yesterday';
  if (day >= today - 7 * 86400000) return 'week';
  return 'earlier';
};

export const BUCKET_LABEL = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Earlier this week',
  earlier: 'Older',
};

export const BUCKET_ORDER = ['today', 'yesterday', 'week', 'earlier'];

/**
 * Groups feed items into day buckets, preserving the order they arrived in
 * (the server sorts newest first) and dropping buckets that are empty.
 */
export const groupByDay = (items) => BUCKET_ORDER
  .map((id) => ({ id, label: BUCKET_LABEL[id], items: items.filter((n) => dayBucket(n.createdAt) === id) }))
  .filter((g) => g.items.length > 0);
