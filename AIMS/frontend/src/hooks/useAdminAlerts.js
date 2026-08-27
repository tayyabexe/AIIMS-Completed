/*
 * The admin header's alert list.
 *
 * These are not stored notifications — they are conditions recomputed from the
 * institute's current position, so each one says so rather than carrying a
 * timestamp implying an event that happened.
 *
 * They used to be derived in AuthContext from the portal-wide array of every
 * student. With that bulk load removed, deriving them from an empty array would
 * have produced confident falsehoods ("0 active students across 0 programs"), so
 * they now come from GET /api/admin/dashboard — the same few hundred bytes of
 * SQL aggregates the dashboard tiles use, counted over the whole institute
 * rather than over whatever had been downloaded.
 */

import { useQuery } from '@tanstack/react-query';
import { admin as adminApi } from '../api/endpoints';
import { STALE, LIVE } from '../api/queryClient';
import { formatMoneyCompact } from '../utils/currency';

const LIVE_LABEL = 'Live · from current data';

/*
 * IDS ARE STABLE, AND THEY HAVE TO BE.
 *
 * These were `id = 101` incremented in the order the conditions happened to
 * fire, and the admin bell persisted "which ones have I read" as a list of
 * those numbers in localStorage. So the id an alert got depended on how many
 * OTHER alerts were live at the time: clear the low-attendance case and every
 * alert below it shifts up one, inheriting the read flag of the alert that
 * used to hold that number. An administrator who had dismissed "Fee Overdue"
 * would find "Academic Risk" silently marked as read instead.
 *
 * Each alert now carries a stable key naming what it IS. The value is still a
 * live condition rather than a stored event, so a `tag` and `time` say so on
 * every row.
 */
function alertsFrom(summary) {
  if (!summary) return [];

  const { students, fees, attendance, academics } = summary;
  const items = [];

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (attendance.below75 > 0) {
    items.push({
      id: 'alert-attendance-below75',
      tag: 'Attendance',
      title: 'Low attendance',
      message: `${plural(attendance.below75, 'student')} below the 75% attendance requirement.`,
      time: LIVE_LABEL,
      type: 'warning',
      read: false,
      to: '/attendance?risk=low',
    });
  }

  if (fees.studentsOverdue > 0) {
    items.push({
      id: 'alert-fees-overdue',
      tag: 'Fee',
      title: 'Fees overdue',
      message: `${plural(fees.studentsOverdue, 'student')} with an overdue account`
        + `${fees.outstanding > 0 ? ` · ${formatMoneyCompact(fees.outstanding)} outstanding` : ''}.`,
      time: LIVE_LABEL,
      type: 'warning',
      read: false,
      to: '/fee-management?fee_status=Overdue',
    });
  }

  // Students who hold a published result below the pass mark. A student with
  // no result yet is not counted — they have not been assessed, not failed.
  const belowPass = Math.max(0, (academics.withResult || 0) - (academics.passed || 0));
  if (belowPass > 0) {
    items.push({
      id: 'alert-academic-risk',
      tag: 'Result',
      title: 'Academic risk',
      message: `${plural(belowPass, 'student')} below the 2.5 CGPA pass mark.`,
      time: LIVE_LABEL,
      type: 'warning',
      read: false,
      to: '/ai-analytics',
    });
  }

  if (students.pending > 0) {
    items.push({
      id: 'alert-registrations-pending',
      tag: 'Registration',
      title: 'Registrations awaiting verification',
      message: `${plural(students.pending, 'student registration')} pending approval.`,
      time: LIVE_LABEL,
      type: 'info',
      read: false,
      to: '/students?status=Pending+Verification',
    });
  }

  if (students.inactive > 0) {
    items.push({
      id: 'alert-students-inactive',
      tag: 'Registration',
      title: 'Students not active',
      message: `${plural(students.inactive, 'student')} suspended or withdrawn.`,
      time: LIVE_LABEL,
      type: 'info',
      read: false,
      to: '/students',
    });
  }

  items.push({
    id: 'alert-enrollment-summary',
    tag: 'Academic',
    title: 'Enrollment summary',
    // `plural` rather than a bare "programmes": a single-programme institute
    // was being told it had "1 programmes".
    message: `${students.active.toLocaleString()} active students across `
      + `${plural(students.programs, 'programme')} (${students.total.toLocaleString()} enrolled).`,
    time: LIVE_LABEL,
    type: 'success',
    read: false,
    to: '/students',
  });

  if (academics.passRate != null) {
    items.push({
      id: 'alert-exam-performance',
      tag: 'Exam',
      title: 'Exam performance',
      message: `Pass rate ${academics.passRate}% `
        + `(${academics.passed}/${academics.withResult} with a published result) · `
        + `${academics.distinction} at distinction.`,
      time: LIVE_LABEL,
      type: academics.passRate >= 80 ? 'success' : 'warning',
      read: false,
      to: '/examination',
    });
  }

  return items;
}

/*
 * These say "Live · from current data" on every row, so they had better be.
 *
 * This was a fetch-on-mount held in useState: the bell was computed once when
 * the shell mounted and then never again for the rest of the session, so a fee
 * paid or an attendance case cleared at eleven was still being reported at
 * five. It goes through the shared cache now, which gives it the same heartbeat
 * as every other screen — the dashboard summary is one small set of SQL
 * aggregates, and the dashboard itself is usually already asking for it, so
 * sharing the key means the bell costs nothing extra while that screen is open.
 */
export default function useAdminAlerts(enabled = true) {
  const { data: summary } = useQuery({
    queryKey: ['admin-page', 'admin-dashboard', {}],
    queryFn: () => adminApi.dashboard(),
    enabled,
    /*
     * A minute, not the portal's usual thirty seconds. This runs on EVERY
     * admin screen — it is the header, not a page — and a bell that is up to
     * sixty seconds behind on "23 students below 75%" costs nothing, while
     * halving what the header adds to every screen in the portal. The
     * dashboard shares this key and keeps its own faster beat; whichever
     * timer comes round first refreshes both.
     */
    staleTime: STALE.badges,
    refetchInterval: LIVE.badges,
    // A failed fetch leaves the bell empty rather than asserting zeros.
    retry: false,
  });

  return alertsFrom(summary);
}
