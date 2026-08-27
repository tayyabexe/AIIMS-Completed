/**
 * The parent's searchable records, for the top bar's PortalSearch.
 *
 * Every group is built from `myChildren`, the loaded parent bundle and the
 * notification list — all of which the backend already scoped to this parent
 * by their token (/api/parent/* resolves the parent from the JWT). So the
 * search can only ever surface this family's own rows: there is no code path
 * here that can reach another parent's children, a class roster, or any staff
 * record.
 *
 * Lifted out of ParentDashboard.jsx when the portal was split into a route per
 * module. One behavioural change came with the split, and it is the point of
 * it: selecting a result used to call `setParentTab(...)`, a setter that
 * happened to be in scope. It now NAVIGATES, and it carries the child the
 * result belongs to in the address — so searching "Usman attendance" and
 * pressing Enter lands on Usman's attendance, not on whichever child was
 * selected in the sidebar at the time. That was wrong before and nothing in
 * the old single-route design could have made it right.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '../../utils/currency';
import { withChild } from './ParentPortalContext';

export default function useParentSearchRecords({
  myChildren, parentBundle, notifications, markNotificationRead,
}) {
  const navigate = useNavigate();

  return useCallback(
    (q) => {
      if (!myChildren.length && !notifications.length) return [];

      const needle = q.toLowerCase();
      const hit = (...fields) =>
        fields.some((f) => f != null && String(f).toLowerCase().includes(needle));

      // Open a module already scoped to the child the result is about.
      const open = (path, childId) => () => navigate(withChild(path, childId));

      const groups = [];
      const cap = 5;

      // --- children ---
      const children = myChildren
        .filter((c) => hit(c.name, c.regNo, c.program, c.section, c.batch, c.semester, c.status))
        .slice(0, cap)
        .map((c) => ({
          id: `child-${c.id}`,
          title: c.name,
          subtitle: `${c.regNo} · ${c.program}`,
          meta: c.semester,
          onSelect: open('/parent/my-children', c.id),
        }));
      if (children.length) groups.push({ id: 'children', label: 'My Children', items: children });

      // --- attendance ---
      const attendance = myChildren
        .filter((c) => c.attendance != null
          && hit(c.name, c.regNo, c.attendance, 'attendance', c.presentDays, c.absentDays))
        .slice(0, cap)
        .map((c) => ({
          id: `att-${c.id}`,
          title: `${c.name} — ${c.attendance}`,
          subtitle: c.totalClasses != null
            ? `${c.presentDays} of ${c.totalClasses} classes attended`
            : 'Attendance record',
          onSelect: open('/parent/attendance', c.id),
        }));
      if (attendance.length) groups.push({ id: 'attendance', label: 'Attendance', items: attendance });

      // --- results ---
      const results = myChildren
        .filter((c) => c.cgpa != null && hit(c.name, c.regNo, c.cgpa, c.gpa, 'result', 'cgpa', 'gpa'))
        .slice(0, cap)
        .map((c) => ({
          id: `res-${c.id}`,
          title: `${c.name} — CGPA ${c.cgpa}`,
          subtitle: c.gpa != null ? `Latest semester GPA ${c.gpa}` : 'Published result',
          onSelect: open('/parent/results', c.id),
        }));
      if (results.length) groups.push({ id: 'results', label: 'Results', items: results });

      // --- fee status ---
      const fees = myChildren
        .filter((c) => c.feeStatus && hit(c.name, c.regNo, c.feeStatus, c.feeAmount, c.dueDate, 'fee'))
        .slice(0, cap)
        .map((c) => ({
          id: `fee-${c.id}`,
          title: `${c.name} — ${c.feeStatus}`,
          subtitle: c.dueDate ? `Due ${c.dueDate}` : 'Fee status',
          meta: c.feeAmount != null ? formatMoney(c.feeAmount) : null,
          onSelect: open('/parent/fees', c.id),
        }));
      if (fees.length) groups.push({ id: 'fees', label: 'Fee Status', items: fees });

      // --- timetable ---
      const slots = (parentBundle?.timetable || [])
        .filter((t) => hit(t.code, t.title, t.day, t.room, t.section, t.start, t.end))
        .slice(0, cap)
        .map((t) => ({
          id: `slot-${t.id}`,
          title: `${t.code || '—'} · ${t.title}`,
          subtitle: `${t.day} ${t.start}–${t.end} · ${t.room}`,
          // The bundle's timetable rows are not per-child, so this one keeps
          // whatever child is already selected rather than asserting one.
          onSelect: () => navigate('/parent/timetable'),
        }));
      if (slots.length) groups.push({ id: 'timetable', label: 'Timetable', items: slots });

      // --- notices ---
      const notices = notifications
        .filter((n) => hit(n.title, n.message, n.tag))
        .slice(0, cap)
        .map((n) => ({
          id: `notif-${n.id}`,
          title: n.title,
          subtitle: n.message,
          meta: n.time,
          onSelect: () => {
            markNotificationRead?.(n.id);
            navigate('/parent/notifications');
          },
        }));
      if (notices.length) groups.push({ id: 'notices', label: 'Notices', items: notices });

      return groups;
    },
    [myChildren, parentBundle, notifications, markNotificationRead, navigate],
  );
}
