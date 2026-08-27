import { useEffect, useRef, useState } from 'react';
import { search as searchApi } from '../api/endpoints';

/**
 * Role-scoped search through GET /api/search.
 *
 * The admin search bar previously looked through useAdminDirectory, which only
 * ever loaded `users` and `teachers`. That meant an admin could not find a
 * student by registration number, a fee by voucher number, a result, a
 * document, a department, a course, a subject or an attendance row — the search
 * simply had no data for any of them.
 *
 * The backend already answers all of that from one endpoint, and it applies the
 * per-role row scoping and the Super Admin exclusion itself
 * (backend/src/config/searchResources.js). Scoping therefore is not repeated
 * here: whatever this returns is already what the signed-in role may see.
 *
 * Returns { groups, loading, error }. `groups` is in the shape PortalSearch
 * renders: [{ id, label, items: [{ id, title, subtitle, meta, onSelect }] }].
 */

// Enough to feel instant while still collapsing a burst of keystrokes into one
// request. The endpoint fans out over a dozen tables for a global query.
const DEBOUNCE_MS = 250;
const PER_GROUP = 5;

const joinParts = (...parts) => parts.filter((p) => p != null && p !== '' && p !== '—').join(' · ');

// One row of each resource type, turned into a display row. Field names come
// from the `select` list of the matching entry in searchResources.js.
const ROW_MAPPERS = {
  students: (r) => ({
    id: r.student_id,
    title: joinParts(r.first_name, r.last_name).replace(' · ', ' ') || r.registration_number,
    subtitle: joinParts(r.registration_number, r.program_name, r.section_name),
  }),
  faculty: (r) => ({
    id: r.teacher_id ?? r.employee_id,
    title: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.employee_code,
    subtitle: joinParts(r.designation, r.department_name, r.employee_code),
  }),
  parents: (r) => ({
    id: r.parent_id,
    title: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email,
    subtitle: joinParts(r.phone, r.email, r.children_count ? `${r.children_count} ward(s)` : null),
  }),
  departments: (r) => ({
    id: r.department_id,
    title: r.department_name,
    subtitle: joinParts(r.head_name, r.program_count != null ? `${r.program_count} program(s)` : null),
  }),
  courses: (r) => ({
    id: r.program_id,
    title: r.program_name,
    subtitle: joinParts(r.department_name, r.student_count != null ? `${r.student_count} student(s)` : null),
  }),
  subjects: (r) => ({
    id: r.subject_id,
    title: joinParts(r.subject_code, r.subject_name),
    subtitle: joinParts(
      r.credit_hours != null ? `${r.credit_hours} cr` : null,
      r.semester_number != null ? `Semester ${r.semester_number}` : null,
    ),
  }),
  attendance: (r) => ({
    id: r.attendance_id,
    title: joinParts(r.student_name, r.subject_code),
    subtitle: joinParts(r.att_date ? String(r.att_date).slice(0, 10) : null, r.status, r.registration_number),
  }),
  results: (r) => ({
    id: r.result_id,
    title: joinParts(r.student_name, r.registration_number),
    subtitle: joinParts(
      r.semester_number != null ? `Semester ${r.semester_number}` : null,
      r.gpa != null ? `GPA ${r.gpa}` : null,
      r.cgpa != null ? `CGPA ${r.cgpa}` : null,
      r.status,
    ),
  }),
  fees: (r) => ({
    id: r.fee_voucher_id,
    title: joinParts(r.voucher_number, r.student_name),
    subtitle: joinParts(r.fee_category, r.status, r.due_date ? `due ${String(r.due_date).slice(0, 10)}` : null),
    // Amounts deliberately not rendered here: this row is a jump target, and
    // every screen that shows money formats it through utils/currency.
  }),
  documents: (r) => ({
    id: r.doc_id,
    title: joinParts(r.doc_type, r.student_name),
    subtitle: joinParts(r.registration_number, r.verified ? 'Verified' : 'Pending'),
  }),
  timetable: (r) => ({
    id: r.timetable_id,
    title: joinParts(r.subject_code, r.subject_name),
    subtitle: joinParts(r.day_of_week, r.start_time, r.teacher_name, r.room_name),
  }),
  notices: (r) => ({
    id: r.notification_id,
    title: r.message,
    subtitle: joinParts(r.type, r.is_read ? 'Read' : 'Unread'),
  }),
};

export default function useServerSearch(query, { onSelect, enabled = true } = {}) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Guards against a slow early request overwriting a newer, faster one.
  const requestId = useRef(0);

  const trimmed = String(query || '').trim();

  useEffect(() => {
    if (!enabled || trimmed.length < 2) {
      setGroups([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await searchApi.run({ q: trimmed, group_limit: PER_GROUP });
        if (id !== requestId.current) return;

        const mapped = (res.groups || [])
          .filter((g) => Array.isArray(g.data) && g.data.length)
          .map((g) => {
            const mapper = ROW_MAPPERS[g.type];
            if (!mapper) return null;
            return {
              id: g.type,
              // Show the true total so a capped list does not read as complete.
              label: g.total > g.data.length ? `${g.label} (${g.total})` : g.label,
              items: g.data.map((row) => {
                const base = mapper(row);
                return {
                  ...base,
                  id: `${g.type}-${base.id}`,
                  title: base.title || '—',
                  meta: g.label,
                  onSelect: () => onSelect?.(g.type, row),
                };
              }),
            };
          })
          .filter(Boolean);

        setGroups(mapped);
      } catch (err) {
        if (id !== requestId.current) return;
        setGroups([]);
        setError(err.message || 'Search failed');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, enabled, onSelect]);

  return { groups, loading, error };
}
