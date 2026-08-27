import { useMemo, useState } from 'react';
import { useSort, SortHeader } from '../../components/common/SortableHeader';

/*
 * The child's attendance, for the semester they are currently in.
 *
 * This screen used to be built from two hardcoded tables: MONTH_OFFSETS, a
 * twelve-row list of invented per-month percentages and class counts, and
 * SUBJECT_OFFSETS, a list of deltas applied to each enrolled course. Late
 * arrivals were `present * 0.05 + child.id % 5`. None of it came from the
 * database, and the axis ran January to December — which merges two semesters
 * with different course loads into one line, so even the shape was misleading.
 *
 * Everything here now comes from the child's own `attendance` rows
 * (GET /api/parent/attendance), each of which carries a date, a subject and a
 * status. The reporting window is the current semester's own start and end
 * dates, and the course filter narrows to one subject at a time.
 */

const RED = '#991b1b';
const INK = '#0F172A';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';

// Validated against the CVD/contrast checks for this surface: the pair is
// separable under protanopia and tritanopia as well as normal vision, and the
// 75% threshold line repeats the same information without relying on hue.
const MEETS = '#1E5AA8';
const SHORT = '#B91C1C';

const REQUIRED = 75;

// "Present" and "Late" both mean the child attended; "Leave" is an authorised
// absence but still a class not attended. "Holiday" is not a sitting at all and
// is excluded from the denominator rather than counted against the child.
const ATTENDED = new Set(['Present', 'Late']);
const COUNTED = new Set(['Present', 'Late', 'Absent', 'Leave']);

const MONTH_LABEL = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;

const cardStyle = {
  backgroundColor: '#FFFFFF',
  border: `1px solid ${LINE}`,
  borderRadius: '14px',
};

export default function ParentAttendanceView({ wards, selectedChildId }) {
  const [courseFilter, setCourseFilter] = useState('all');
  const [hovered, setHovered] = useState(null);

  const child = wards.find((c) => c.id === selectedChildId) || wards[0];

  // Hooks must run unconditionally, so the missing-child case is handled after
  // the derivation rather than with an early return above it.
  const model = useMemo(() => {
    if (!child) return null;

    const records = child.attendanceRecords || [];
    const start = parseDate(child.semesterStart);
    const end = parseDate(child.semesterEnd);

    // Restrict to the running term. Without a semester window on the record
    // the whole history is used, and the screen says so rather than implying
    // the figures are term-scoped.
    const scoped = records.filter((r) => {
      if (!COUNTED.has(r.status)) return false;
      const d = parseDate(r.date);
      if (!d) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    // Course options come from the sittings actually marked this term, so the
    // filter can never offer a course with nothing behind it.
    const courseMap = new Map();
    for (const r of scoped) {
      if (r.subjectId === null) continue;
      if (!courseMap.has(r.subjectId)) {
        courseMap.set(r.subjectId, {
          id: r.subjectId,
          code: r.subjectCode,
          name: r.subjectName,
        });
      }
    }
    const courses = [...courseMap.values()]
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));

    const visible = courseFilter === 'all'
      ? scoped
      : scoped.filter((r) => r.subjectId === courseFilter);

    const tally = (rows) => {
      let present = 0; let late = 0; let absent = 0; let leave = 0;
      for (const r of rows) {
        if (r.status === 'Present') present += 1;
        else if (r.status === 'Late') late += 1;
        else if (r.status === 'Absent') absent += 1;
        else if (r.status === 'Leave') leave += 1;
      }
      const total = present + late + absent + leave;
      return {
        present, late, absent, leave, total,
        attended: present + late,
        percent: pct(present + late, total),
      };
    };

    const totals = tally(visible);

    // --- monthly buckets, inside the semester window only ------------------
    const byMonth = new Map();
    for (const r of visible) {
      const d = parseDate(r.date);
      if (!d) continue;
      const key = monthKey(d);
      const bucket = byMonth.get(key)
        || { key, year: d.getFullYear(), month: d.getMonth(), rows: [] };
      bucket.rows.push(r);
      byMonth.set(key, bucket);
    }

    const months = [...byMonth.values()]
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .map((b) => {
        const t = tally(b.rows);
        return {
          key: b.key,
          label: MONTH_LABEL[b.month],
          year: b.year,
          ...t,
        };
      });

    // --- per-course roster -------------------------------------------------
    const perCourse = courses.map((c) => {
      const t = tally(scoped.filter((r) => r.subjectId === c.id));
      return { ...c, ...t };
    }).sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));

    return {
      courses, months, totals, perCourse,
      scopedCount: scoped.length,
      hasWindow: Boolean(start && end),
      start, end,
    };
  }, [child, courseFilter]);

  if (!child || !model) return null;

  const { courses, months, totals, perCourse, hasWindow, start, end } = model;

  // The per-course breakdown holds every row. Its default order — worst
  // attendance first — is preserved until a column is chosen.
  const {
    sorted: sortedCourses, sort: courseSort, toggle: toggleCourseSort,
  } = useSort(perCourse);

  const termLabel = hasWindow
    ? `${start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
    : 'All recorded attendance';

  const activeCourse = courseFilter === 'all'
    ? null
    : courses.find((c) => c.id === courseFilter);

  const overall = totals.percent;
  const overallColor = overall === null ? MUTED : overall < REQUIRED ? SHORT : MEETS;

  // A shared ceiling keeps the bars comparable month to month.
  const chartMax = 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ---- heading ---- */}
      <div>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: INK, margin: '0 0 0.25rem', fontFamily: "'Outfit', sans-serif" }}>
          Attendance
        </h2>
        <p style={{ fontSize: '0.85rem', color: MUTED, margin: 0 }}>
          {child.name}
          {child.semester ? ` · ${child.semester}` : ''}
          {' · '}{termLabel}
        </p>
      </div>

      {/* ---- course filter, in one row above the figures it governs ---- */}
      {courses.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: MUTED, fontWeight: 600, marginRight: '2px' }}>
            Course
          </span>
          {[{ id: 'all', code: 'All courses' }, ...courses].map((c) => {
            const active = courseFilter === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCourseFilter(c.id)}
                title={c.id === 'all' ? 'All courses this semester' : c.name || c.code}
                style={{
                  padding: '0.32rem 0.7rem',
                  borderRadius: '7px',
                  fontSize: '0.78rem',
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  border: `1px solid ${active ? INK : LINE}`,
                  backgroundColor: active ? INK : '#FFFFFF',
                  color: active ? '#FFFFFF' : MUTED,
                  transition: 'all 0.15s',
                }}
              >
                {c.code || c.name}
              </button>
            );
          })}
        </div>
      )}

      {totals.total === 0 ? (
        <div style={{ ...cardStyle, padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: INK, margin: '0 0 0.35rem', fontWeight: 600 }}>
            No attendance recorded
          </p>
          <p style={{ fontSize: '0.83rem', color: MUTED, margin: 0 }}>
            {activeCourse
              ? `No sittings have been marked for ${activeCourse.code} this semester.`
              : hasWindow
                ? 'No classes have been marked for this semester yet.'
                : 'No attendance has been marked for this child yet.'}
          </p>
        </div>
      ) : (
        <>
          {/* ---- headline figures ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            {[
              {
                label: 'Attendance',
                value: overall === null ? '—' : `${overall}%`,
                note: overall === null ? 'Not calculable'
                  : overall < REQUIRED ? `Below the ${REQUIRED}% requirement`
                    : `Meets the ${REQUIRED}% requirement`,
                color: overallColor,
              },
              {
                label: 'Attended',
                value: totals.attended,
                note: `of ${totals.total} classes held`,
                color: INK,
              },
              {
                label: 'Absent',
                value: totals.absent + totals.leave,
                note: totals.leave ? `${totals.absent} absent · ${totals.leave} on leave` : 'Unexcused absences',
                color: totals.absent + totals.leave > 0 ? SHORT : INK,
              },
              {
                label: 'Late arrivals',
                value: totals.late,
                note: totals.late ? 'Counted as attended' : 'None recorded',
                color: INK,
              },
            ].map((tile) => (
              <div key={tile.label} style={{ ...cardStyle, padding: '1rem 1.1rem' }}>
                <p style={{ fontSize: '0.78rem', color: MUTED, fontWeight: 600, margin: 0 }}>{tile.label}</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 700, color: tile.color, margin: '4px 0 0', fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>
                  {tile.value}
                </p>
                <p style={{ fontSize: '0.76rem', color: FAINT, margin: '4px 0 0' }}>{tile.note}</p>
              </div>
            ))}
          </div>

          {/* ---- monthly trend, semester window only ---- */}
          <div style={{ ...cardStyle, padding: '1.25rem 1.35rem' }}>
            <div style={{ marginBottom: '1.1rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: INK, margin: '0 0 0.2rem', fontFamily: "'Outfit', sans-serif" }}>
                Monthly attendance
                {activeCourse ? ` — ${activeCourse.code}` : ''}
              </h3>
              <p style={{ fontSize: '0.78rem', color: MUTED, margin: 0 }}>
                Percentage of classes attended each month of {child.semester || 'this semester'}
              </p>
            </div>

            {months.length === 0 ? (
              <p style={{ fontSize: '0.83rem', color: MUTED, margin: 0 }}>
                No months in this semester have attendance yet.
              </p>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                {/* y axis */}
                <div style={{
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  height: '190px', paddingBottom: '22px', fontSize: '0.68rem', color: FAINT,
                }}>
                  <span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0</span>
                </div>

                <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                  {/* gridlines, recessive; the 75% line is the requirement and
                      is drawn solid so it reads as a rule, not a gridline */}
                  <div style={{ position: 'absolute', inset: '0 0 22px 0', pointerEvents: 'none' }}>
                    {[0, 25, 50, 75, 100].map((v) => (
                      <div
                        key={v}
                        style={{
                          position: 'absolute', left: 0, right: 0,
                          bottom: `${v}%`,
                          borderTop: v === REQUIRED ? `1px dashed ${SHORT}` : `1px solid ${LINE}`,
                          opacity: v === REQUIRED ? 0.85 : 0.7,
                        }}
                      />
                    ))}
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: '2px',
                    height: '190px', paddingBottom: '22px', position: 'relative',
                  }}>
                    {months.map((m) => {
                      const value = m.percent ?? 0;
                      const isHovered = hovered === m.key;
                      const short = m.percent !== null && m.percent < REQUIRED;
                      return (
                        <div
                          key={m.key}
                          onMouseEnter={() => setHovered(m.key)}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            flex: 1, minWidth: 0, height: '100%',
                            display: 'flex', flexDirection: 'column',
                            justifyContent: 'flex-end', alignItems: 'center',
                            position: 'relative', cursor: 'default',
                          }}
                        >
                          {isHovered && (
                            <div style={{
                              position: 'absolute', bottom: `calc(${(value / chartMax) * 100}% + 8px)`,
                              backgroundColor: INK, color: '#FFFFFF',
                              padding: '0.45rem 0.65rem', borderRadius: '8px',
                              fontSize: '0.72rem', whiteSpace: 'nowrap', zIndex: 5,
                              boxShadow: '0 4px 14px rgba(0,0,0,0.18)', lineHeight: 1.5,
                            }}>
                              <strong style={{ fontWeight: 600 }}>{m.label} {m.year}</strong><br />
                              {m.percent}% attended<br />
                              <span style={{ color: '#CBD5E1' }}>
                                {m.attended} of {m.total} classes
                              </span>
                            </div>
                          )}
                          <div
                            style={{
                              width: '78%', maxWidth: '48px',
                              height: `${(value / chartMax) * 100}%`,
                              backgroundColor: short ? SHORT : MEETS,
                              opacity: isHovered ? 1 : 0.9,
                              borderRadius: '4px 4px 0 0',
                              transition: 'opacity 0.15s',
                            }}
                          />
                          <span style={{
                            position: 'absolute', bottom: '-20px',
                            fontSize: '0.7rem', color: MUTED, whiteSpace: 'nowrap',
                          }}>
                            {m.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* One series, so no legend box — but the threshold rule is named,
                because a dashed line on its own explains nothing. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '1.4rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: MUTED }}>
                <span style={{ width: '18px', borderTop: `1px dashed ${SHORT}`, display: 'inline-block' }} />
                {REQUIRED}% requirement
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: MUTED }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: SHORT, display: 'inline-block' }} />
                Month below requirement
              </span>
            </div>
          </div>

          {/* ---- per-course roster ---- */}
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '1rem 1.35rem', borderBottom: `1px solid ${LINE}`,
            }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: INK, margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                Attendance by course
              </h3>
              <span style={{ fontSize: '0.76rem', color: MUTED }}>
                {perCourse.length} course{perCourse.length === 1 ? '' : 's'} this semester
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: `1px solid ${LINE}` }}>
                    {[
                      ['code', 'Course', 'left', '0.65rem 1.35rem'],
                      ['held', 'Held', 'center', '0.65rem 1rem'],
                      ['attended', 'Attended', 'center', '0.65rem 1rem'],
                      ['absent', 'Absent', 'center', '0.65rem 1rem'],
                      ['percent', 'Attendance', 'right', '0.65rem 1.35rem'],
                    ].map(([key, label, align, padding]) => (
                      <SortHeader
                        key={key}
                        label={label}
                        sortKey={key}
                        sort={courseSort}
                        onToggle={toggleCourseSort}
                        align={align}
                        style={{ padding, color: MUTED, fontWeight: 600, fontSize: '0.75rem' }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCourses.map((c) => {
                    const short = c.percent !== null && c.percent < REQUIRED;
                    return (
                      <tr key={c.id} style={{ borderBottom: `1px solid #F1F5F9` }}>
                        <td style={{ padding: '0.7rem 1.35rem' }}>
                          <span style={{ color: MUTED, fontWeight: 600 }}>{c.code || '—'}</span>
                          <span style={{ color: INK }}>{c.name ? `  ${c.name}` : ''}</span>
                        </td>
                        <td style={{ padding: '0.7rem 1rem', textAlign: 'center', color: MUTED }}>{c.total}</td>
                        <td style={{ padding: '0.7rem 1rem', textAlign: 'center', color: INK }}>{c.attended}</td>
                        <td style={{ padding: '0.7rem 1rem', textAlign: 'center', color: MUTED }}>{c.absent + c.leave}</td>
                        <td style={{ padding: '0.7rem 1.35rem', textAlign: 'right' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                            <span style={{ width: '64px', height: '5px', backgroundColor: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                              <span style={{
                                display: 'block', height: '100%',
                                width: `${c.percent ?? 0}%`,
                                backgroundColor: short ? SHORT : MEETS,
                              }} />
                            </span>
                            <span style={{ fontWeight: 600, color: short ? SHORT : INK, minWidth: '44px' }}>
                              {c.percent === null ? '—' : `${c.percent}%`}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
