import { useMemo, useState } from 'react';
import {
  Building2, GraduationCap, Layers, Users2, CalendarRange,
  ChevronRight, X, BookOpen, UserRound,
} from 'lucide-react';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import Pagination from '../common/Pagination';
import FilterField from '../common/FilterField';
import { useSort, SortHeader } from '../common/SortableHeader';
import ApiErrorNotice from '../common/ApiErrorNotice';
import RouteLoader from '../common/RouteLoader';
import { studentProfilePath } from '../../pages/admin/adminNav';
import { useNavigate } from 'react-router-dom';

/*
 * The enrolment explorer: how many students sit at every level of the
 * structure, and who they are.
 *
 * WHY ONE REQUEST FOR THE COUNTS
 * ------------------------------
 * GET /api/admin/enrollment returns department, programme, batch, section AND
 * semester counts in a single response. That is not an optimisation, it is a
 * correctness requirement: five separate endpoints answering five questions from
 * five moments can add up to different totals, and a screen whose levels
 * disagree with each other cannot be used to reconcile anything.
 *
 * STUDENTS AND COURSE ENROLMENTS ARE NOT THE SAME NUMBER
 * -----------------------------------------------------
 * This is the mistake this screen is built to prevent. `students` counts people:
 * 2,003 of them. `courseEnrolments` counts registrations — one row per student
 * per subject — and there are 9,650, because each student carries roughly five.
 * Putting one under the other's label overstates the institute fivefold, so the
 * two are drawn in visibly different places, each labelled with the thing it
 * counts, and never summed together.
 *
 * DRILLING DOWN
 * -------------
 * Clicking any figure opens the roster behind it: GET /api/admin/students with
 * the SAME filter, so the list and the number cannot disagree. The count is not
 * recomputed from the roster page — the roster is paged, the count is not.
 *
 * EMPTY LEVELS ARE SHOWN, NOT HIDDEN
 * ----------------------------------
 * The counts are grouped over `students`, so until now a programme, section or
 * semester nobody was enrolled in produced no row and vanished. That is how this
 * screen came to report 5 programmes while the Dashboard reported 6, and why a
 * section an admin had just created stayed invisible until somebody was placed
 * in it. The API now pads each level from its own table and flags the padded
 * rows `empty`; they are drawn muted, with the count still readable as 0. The
 * toggle collapses them for the levels where they are numerous (24 of the 30
 * semesters hold nobody) — but it defaults to showing them, because an explorer
 * that hides empty containers cannot be used to find one.
 */

const ACCENT = '#991b1b';

const card = {
  backgroundColor: '#FFFFFF', borderRadius: '14px', border: '1px solid #E2E8F0',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const th = {
  textAlign: 'left', fontSize: '0.7rem', fontWeight: 800, color: '#64748B',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  padding: '0.55rem 0.8rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
};

const td = {
  fontSize: '0.85rem', color: '#0F172A', padding: '0.6rem 0.8rem',
  borderBottom: '1px solid #F1F5F9',
};

/*
 * The five levels, in the order the tree nests.
 *
 * `filter` is the query parameter GET /api/admin/students takes for that level —
 * which is what makes "the roster behind this number" a matter of passing the
 * same key rather than of re-deriving anything.
 */
const LEVELS = [
  { key: 'departments', label: 'Departments', singular: 'Department', icon: Building2, filter: 'department_id' },
  { key: 'programs', label: 'Programmes', singular: 'Programme', icon: GraduationCap, filter: 'program_id' },
  { key: 'batches', label: 'Batches', singular: 'Batch', icon: Layers, filter: 'batch_id' },
  { key: 'sections', label: 'Sections', singular: 'Section', icon: Users2, filter: 'section_id' },
  { key: 'semesters', label: 'Semesters', singular: 'Semester', icon: CalendarRange, filter: 'semester_id' },
];

const STATUS_COLOURS = {
  active: '#059669',
  suspended: '#D97706',
  graduated: '#2563EB',
  withdrawn: '#DC2626',
};

export default function EnrollmentExplorer() {
  const navigate = useNavigate();
  const [level, setLevel] = useState('departments');
  const [search, setSearch] = useState('');

  // Empty rows are shown by default; this only collapses them.
  const [showEmpty, setShowEmpty] = useState(true);

  /*
   * The row whose roster is open. Holds the filter key and value as well as the
   * label, so the roster request is built from the same pair the count was.
   */
  const [drill, setDrill] = useState(null);

  const { data, loading, error } = useAdminPage(() => adminApi.enrollment(), {}, { key: 'enrollment' });

  const totals = data?.totals ?? {};
  const active = LEVELS.find((l) => l.key === level);

  /*
   * Names for the parent of each row, resolved from the same snapshot.
   *
   * "Semester 2" appears once per programme in this database — it is numbered
   * within a programme, not institute-wide — so a semester row without its
   * programme beside it is genuinely ambiguous, and there are five of them.
   */
  const parentName = useMemo(() => {
    const byId = (list) => new Map((data?.[list] ?? []).map((r) => [r.id, r.name]));
    const departments = byId('departments');
    const programs = byId('programs');
    const batches = byId('batches');

    return (row) => {
      if (level === 'programs') return departments.get(row.departmentId);
      if (level === 'batches') return programs.get(row.programId);
      if (level === 'sections') return batches.get(row.batchId);
      if (level === 'semesters') return programs.get(row.programId);
      return null;
    };
  }, [data, level]);

  const rows = useMemo(() => {
    let all = data?.[level] ?? [];
    if (!showEmpty) all = all.filter((r) => !r.empty);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.name} ${parentName(r) || ''}`.toLowerCase().includes(q));
  }, [data, level, search, parentName, showEmpty]);

  // How many rows at THIS level hold nobody, counted before the toggle hides
  // them so the toggle can say what it is hiding.
  const emptyCount = data?.empties?.[level] ?? 0;

  /*
   * Sorted in the browser, because this level holds ALL its rows — there is no
   * paging here, so there is nothing for a server sort to reach that the client
   * cannot. "Within" sorts by the resolved parent name rather than the raw id,
   * which is the thing actually printed in the column.
   */
  const { sorted, sort, toggle } = useSort(
    rows,
    { parent: (r) => parentName(r) || '' },
    { key: 'students', dir: 'desc' },
  );

  // The largest row at this level, so the bars are comparable within a level
  // without pretending a 405-student batch and an 803-student department are the
  // same size.
  const peak = Math.max(1, ...rows.map((r) => Number(r.students || 0)));

  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading enrolment…"
        hint="Counts at every level: department, programme, batch, section and semester"
      />
    );
  }

  if (error && !data) return <ApiErrorNotice error={error} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h2 style={{
          fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0,
          letterSpacing: '-0.02em', fontFamily: "'Outfit', sans-serif",
        }}>
          Enrolment
        </h2>
        <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '4px 0 0' }}>
          Every level counted in one request, so the levels always agree. Click any
          figure to see the students behind it.
        </p>
      </div>

      {/*
        THE TWO KINDS OF NUMBER, KEPT APART.

        Left group counts people. Right group counts course registrations. They
        are separated by a rule and labelled with their unit because 2,003 and
        9,650 describe the same institute and conflating them is a fivefold
        error.
      */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <div style={{ ...card, padding: '1.15rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '0.75rem' }}>
            <UserRound size={16} color={ACCENT} />
            <p style={{
              fontSize: '0.72rem', fontWeight: 800, color: '#334155', margin: 0,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              People — students on the roll
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}>
            {[
              ['Students', totals.students],
              ['Active', totals.active],
              // "No section" read as a count of sections when it sits above a
              // level chip saying "Sections 8". It counts PEOPLE who have not
              // been placed in one — a different unit entirely.
              ['Unplaced students', totals.unsectioned, totals.unsectioned > 0],
            ].map(([t, v, warn]) => (
              <div key={t}>
                <p style={{
                  fontSize: '1.5rem', fontWeight: 800, margin: 0,
                  color: warn ? '#DC2626' : '#0F172A', fontFamily: "'Outfit', sans-serif",
                }}>
                  {Number(v ?? 0).toLocaleString()}
                </p>
                <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>{t}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...card, padding: '1.15rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '0.75rem' }}>
            <BookOpen size={16} color="#2563EB" />
            <p style={{
              fontSize: '0.72rem', fontWeight: 800, color: '#334155', margin: 0,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Registrations — one row per student per subject
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}>
            {[
              ['Active enrolments', totals.courseEnrolments, '#0F172A'],
              ['Dropped', totals.droppedEnrolments, '#D97706'],
              ['Students with courses', totals.studentsWithCourses, '#0F172A'],
              ['Subjects taught', totals.distinctSubjects, '#0F172A'],
            ].map(([t, v, colour]) => (
              <div key={t}>
                <p style={{
                  fontSize: '1.5rem', fontWeight: 800, margin: 0, color: colour,
                  fontFamily: "'Outfit', sans-serif",
                }}>
                  {Number(v ?? 0).toLocaleString()}
                </p>
                <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>{t}</p>
              </div>
            ))}
          </div>
          {/*
            The headline figure counts ACTIVE registrations only, and used to
            say so nowhere — so 9,650 read as the whole of a table holding
            10,000. Both halves are now on the card, and the line below states
            the scope rather than leaving it to be inferred.
          */}
          <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '0.6rem 0 0', lineHeight: 1.45 }}>
            {Number(totals.courseEnrolments ?? 0).toLocaleString()} active registrations across{' '}
            {Number(totals.studentsWithCourses ?? 0).toLocaleString()} students — about{' '}
            {totals.studentsWithCourses
              ? (totals.courseEnrolments / totals.studentsWithCourses).toFixed(1)
              : '—'}{' '}
            subjects each. This is not a headcount.
            {totals.droppedEnrolments > 0 && (
              <>
                {' '}A further {Number(totals.droppedEnrolments).toLocaleString()} dropped
                registrations are excluded from that figure
                ({Number(totals.allEnrolments ?? 0).toLocaleString()} rows in total).
              </>
            )}
            {totals.subjectsInCatalogue > 0 && (
              <>
                {' '}Teaching currently covers {Number(totals.distinctSubjects ?? 0).toLocaleString()}{' '}
                of the {Number(totals.subjectsInCatalogue).toLocaleString()} subjects in the catalogue.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Level picker + table */}
      <div style={{ ...card, padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', borderBottom: '1px solid #E2E8F0', paddingBottom: '0.85rem' }}>
          {LEVELS.map((l) => {
            const Icon = l.icon;
            const on = l.key === level;
            return (
              <button
                key={l.key}
                onClick={() => { setLevel(l.key); setSearch(''); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '0.45rem 0.85rem', borderRadius: '9px', cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 700,
                  border: `1px solid ${on ? ACCENT : '#E2E8F0'}`,
                  backgroundColor: on ? '#FEF2F2' : '#FFFFFF',
                  color: on ? ACCENT : '#475569',
                }}
              >
                <Icon size={15} />
                {l.label}
                <span style={{ fontWeight: 600, opacity: 0.65 }}>{(data?.[l.key] ?? []).length}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
          <FilterField
            value={search}
            onChange={setSearch}
            placeholder={`Filter ${active.label.toLowerCase()} by name, or by the programme or batch they belong to…`}
            style={{ flex: '1 1 320px', maxWidth: '460px' }}
          />

          {/* Only offered when this level actually has empty rows, so the
              control never appears with nothing to do. */}
          {emptyCount > 0 && (
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              fontSize: '0.78rem', fontWeight: 600, color: '#475569',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.target.checked)}
                style={{ width: '15px', height: '15px', accentColor: ACCENT, cursor: 'pointer' }}
              />
              Show the {emptyCount} {active.label.toLowerCase().replace(/s$/, '')}
              {emptyCount === 1 ? '' : 's'} with no students
            </label>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortHeader label={active.singular} sortKey="name" sort={sort} onToggle={toggle} style={th} />
                <SortHeader label="Within" sortKey="parent" sort={sort} onToggle={toggle} style={th} />
                <SortHeader label="Students" sortKey="students" sort={sort} onToggle={toggle} align="right" style={th} />
                <SortHeader label="By academic status" sortKey="active" sort={sort} onToggle={toggle} style={th} title="Sort by active students" />
                {/* The Capacity column is gone. Every section in this database
                    is far past its stated seat count — SE-2A holds 398 against
                    a capacity of 40 — because placement here is not seat-limited,
                    so "398 / 40 — 358 over" was flagging a rule that does not
                    apply as though it were a fault. Section capacity is still
                    editable under Academic Structure, where it belongs. */}
                <th style={{ ...th, textAlign: 'right' }}>Roster</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: '2.5rem' }}>
                    No {active.label.toLowerCase()} match “{search}”.
                  </td>
                </tr>
              ) : sorted.map((row) => (
                <tr key={`${level}-${row.id}`} style={row.empty ? { backgroundColor: '#FCFCFD' } : undefined}>
                  <td style={{ ...td, fontWeight: 700, color: row.empty ? '#64748B' : '#0F172A' }}>
                    {row.name}
                  </td>
                  <td style={{ ...td, color: '#64748B' }}>
                    {parentName(row) || <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={{
                    ...td, textAlign: 'right', fontWeight: 800,
                    color: row.empty ? '#CBD5E1' : '#0F172A',
                  }}>
                    {Number(row.students).toLocaleString()}
                  </td>
                  <td style={{ ...td, minWidth: '260px' }}>
                    {/*
                      A row nobody is enrolled in has no shape to draw, so it
                      says so in words rather than rendering a zero-width bar
                      above four grey "0 active / 0 suspended" labels — which
                      reads as a rendering failure, not as an empty container.
                    */}
                    {row.empty ? (
                      <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontStyle: 'italic' }}>
                        No students enrolled yet
                      </span>
                    ) : (
                      <>
                        {/* A stacked bar rather than four numbers: the question this
                            column answers is "what is the shape of this cohort", and
                            13 suspended out of 803 is a proportion, not a figure. */}
                        <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#F1F5F9', width: `${Math.max(12, (row.students / peak) * 100)}%` }}>
                          {['active', 'suspended', 'graduated', 'withdrawn'].map((k) => {
                            const n = Number(row[k] || 0);
                            if (!n) return null;
                            return (
                              <div
                                key={k}
                                title={`${n} ${k}`}
                                style={{ width: `${(n / Math.max(1, row.students)) * 100}%`, backgroundColor: STATUS_COLOURS[k] }}
                              />
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '0.7rem', marginTop: '5px', flexWrap: 'wrap' }}>
                          {['active', 'suspended', 'graduated', 'withdrawn'].map((k) => (
                            <span key={k} style={{ fontSize: '0.7rem', color: Number(row[k]) ? STATUS_COLOURS[k] : '#CBD5E1', fontWeight: 600 }}>
                              {row[k] ?? 0} {k}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setDrill({
                        filter: active.filter,
                        value: row.id,
                        label: `${active.singular}: ${row.name}`,
                        expected: Number(row.students),
                      })}
                      disabled={!row.students}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '0.35rem 0.7rem', borderRadius: '8px',
                        border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC',
                        color: row.students ? '#0F172A' : '#CBD5E1',
                        fontSize: '0.78rem', fontWeight: 700,
                        cursor: row.students ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Open <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drill && (
        <Roster
          drill={drill}
          onClose={() => setDrill(null)}
          onOpenStudent={(id) => navigate(studentProfilePath(id))}
        />
      )}
    </div>
  );
}

/*
 * The students behind one figure.
 *
 * Paged, and the page total is compared against the count the tile claimed. They
 * should be identical — both come from the same filters on the same tables — and
 * saying so on screen is what makes the comparison checkable rather than assumed.
 */
function Roster({ drill, onClose, onOpenStudent }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');

  const { data, loading, error } = useAdminPage(
    (p) => adminApi.students(p),
    { [drill.filter]: drill.value, page, limit: 25, q: q.trim() || undefined }, { key: 'students', debounceMs: 300 });

  const rows = data?.rows ?? [];
  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 25 };

  // Only meaningful with no search applied: a filtered roster is expected to be
  // smaller than the level's count.
  const mismatch = !q.trim() && !loading && pagination.total !== drill.expected;

  return (
    <div style={{ ...card, padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
            {drill.label}
          </h3>
          <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '2px 0 0' }}>
            {pagination.total.toLocaleString()} students
            {q.trim() ? ` matching “${q.trim()}”` : ''}
            {' · the roster behind the count above'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid #CBD5E1',
            backgroundColor: '#FFFFFF', color: '#475569', fontSize: '0.8rem',
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          <X size={14} /> Close
        </button>
      </div>

      {mismatch && (
        <div style={{
          padding: '0.6rem 0.85rem', borderRadius: '8px', backgroundColor: '#FFFBEB',
          border: '1px solid #FDE68A', color: '#92400E', fontSize: '0.78rem',
        }}>
          The level reported {drill.expected.toLocaleString()} students and this roster
          returns {pagination.total.toLocaleString()}. Both read the same filters, so a
          difference here is worth reporting rather than ignoring.
        </div>
      )}

      <ApiErrorNotice error={error} />

      <FilterField
        value={q}
        onChange={(v) => { setQ(v); setPage(1); }}
        placeholder="Narrow this roster by student name, registration number, email or phone…"
        style={{ maxWidth: '420px' }}
      />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Registration no.', 'Name', 'Programme', 'Batch', 'Section', 'Semester', 'Status'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: '2rem' }}>
                  {loading ? 'Loading…' : 'No students here.'}
                </td>
              </tr>
            ) : rows.map((s) => (
              <tr
                key={s.id}
                onClick={() => onOpenStudent(s.id)}
                style={{ cursor: 'pointer' }}
              >
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{s.regNo}</td>
                <td style={{ ...td, fontWeight: 700 }}>{s.name}</td>
                <td style={td}>{s.program || '—'}</td>
                <td style={td}>{s.batch || '—'}</td>
                <td style={td}>{s.section || <span style={{ color: '#DC2626', fontWeight: 700 }}>Unplaced</span>}</td>
                <td style={td}>{s.semester || '—'}</td>
                <td style={td}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={pagination.page}
        pages={pagination.pages}
        total={pagination.total}
        limit={pagination.limit}
        count={rows.length}
        onChange={setPage}
        noun="student"
        loading={loading}
      />
    </div>
  );
}
