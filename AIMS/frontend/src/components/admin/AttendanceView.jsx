import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Minus, Plus, RotateCcw, MoveHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage, useListParams } from '../../hooks/useAdminPage';
import { useRemoteSort, SortHeader } from '../common/SortableHeader';
import Pagination from '../common/Pagination';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import UserAvatar from '../common/UserAvatar';
import './AttendanceView.css';

/*
 * The Attendance screen.
 *
 * Served by GET /api/admin/attendance: one page of students with their real
 * figures, the institute-wide cohorts, and the month-by-month trend. Every
 * number on this screen is counted in SQL over the whole register — nothing is
 * derived from the rows currently visible, and nothing is hardcoded.
 *
 * WHAT THE PERSON OPENING THIS IS DOING
 * -------------------------------------
 * Deciding who sits the exams. The rule is 75%, the consequence is somebody's
 * semester, and the question is never "what is the average" — it is "who is
 * short, and is this list actually complete".
 *
 * THE LAYOUT
 * ----------
 * Four bands, in the order the question is asked:
 *
 *   1. What am I looking at, and over what period.
 *   2. The cohorts — four counts, each of which IS the filter that opens it.
 *   3. The two analyses, side by side on a wide screen: how the roll stands
 *      against the rule right now, and how the rate has moved month by month.
 *      These used to be two full-width cards stacked, which gave a 10px-tall
 *      proportion bar 1,300px of horizontal space and pushed the table — the
 *      thing being looked for — below the fold.
 *   4. The roster.
 *
 * THE SIGNATURE: THE COHORT TILES ARE THE FILTER
 * ----------------------------------------------
 * Each tile counts a cohort AND selects it. Click "Below 75%" and the table
 * beneath becomes exactly those students — the same query that produced the
 * figure, not a second one that agrees with it by luck.
 *
 * FOUR STATUSES, NOT TWO
 * ----------------------
 * `attendance.status` is Present, Late, Absent, Leave or Holiday. This table
 * used to show two columns — "Present Days" carrying Present + Late combined,
 * and "Absent Days" — so Late marks were silently reported as Present and
 * Leave marks appeared nowhere; Sessions did not reconcile with the columns
 * beside it. Each status has its own column now and the row adds up. Holidays
 * are excluded throughout — a holiday is not a session anyone could attend, so
 * counting it would drag every rate down.
 *
 * The 75% rule is still computed from Present + Late, which is correct: a
 * student who arrived late was there.
 *
 * A SESSION IS A TIMETABLE SLOT
 * -----------------------------
 * Every figure here counts rows in `attendance`, and one row is one student at
 * one timetable SLOT on one day — not one student on one day. A class meeting
 * twice on a Monday contributes two sessions. That was not true until the slot
 * work: the service resolved a register as "the first period on this weekday",
 * so second periods were never marked and never entered these denominators.
 *
 * SORTING REACHES THE DATABASE
 * ----------------------------
 * The table is paged in SQL, so sorting the ten visible rows in the browser
 * would reorder the page rather than the register — "lowest attendance first"
 * would silently mean "lowest of these ten". The column headers send `sort`
 * and `dir` to the API instead.
 *
 * STYLING LIVES IN AttendanceView.css
 * -----------------------------------
 * It was 855 lines of inline style objects, which cannot express a media
 * query, a hidden scrollbar, `:hover` or `:focus-visible`. Hover was emulated
 * with a `useState` per tile and per table row — a re-render on every pointer
 * move — and there was no focus ring at all.
 */

const AVATAR_INK = ['#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#4F46E5'];
const initialsOf = (name) =>
  String(name || 'S').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase();
const avatarInkOf = (id) => AVATAR_INK[(Number(id) || 0) % AVATAR_INK.length];

const pct1 = (v) => (v == null ? '—' : Number(v).toFixed(1));

/* Colours needed in JS — a bar's fill, a figure's tone. Everything static is
   in the stylesheet; these are the ones chosen per datum. */
const OK = '#059669';
const WARN = '#D97706';
const BAD = '#DC2626';
const INK = '#0F172A';
const INK_4 = '#94A3B8';

/* ------------------------------------------------------------------------ */

export const AttendanceView = () => {
  const { viewStudentProfile } = useAuth();
  const [searchParams] = useSearchParams();

  const { params, filters, setFilter, setPage } = useListParams({
    q: '',
    program_id: '',
    batch_id: '',
    // The dashboard's attendance tile links here as ?risk=low, so it opens the
    // cohort it counted rather than the unfiltered register.
    risk: searchParams.get('risk') || '',
    period: '',
    limit: 10,
  });

  // Re-ordering must return to page one: page 7 of a newly-sorted table shows
  // rows nobody asked for.
  const { sort, toggle, params: sortParams } = useRemoteSort(null, () => setPage(1));

  const request = useMemo(() => ({ ...params, ...sortParams }), [params, sortParams]);

  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.attendance(p),
    request, { key: 'admin-attendance', debounceMs: 300 });

  const rows = data?.rows ?? [];
  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 10 };
  const summary = data?.summary
    ?? { roll: 0, tracked: 0, untracked: 0, excellent: 0, satisfactory: 0, atRisk: 0, average: null };
  const months = data?.monthlyTrend ?? [];
  const options = data?.options ?? { programs: [], batches: [], sections: [] };

  const regular = summary.tracked - summary.atRisk;

  /*
   * The first load owns the whole screen. `summary` defaults to zeros, so while
   * the request was in flight this page used to draw tiles reporting 0 tracked
   * and a rate of 0.0%. A screen that does not know its numbers must not print
   * numbers. Refetches keep the current rows and dim the pagination instead.
   */
  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading attendance…"
        hint="Cohorts, the monthly trend and the students below the 75% requirement"
      />
    );
  }

  const periodLabel = months.find((m) => m.key === filters.period)?.label;

  return (
    <div className="att">
      <Header
        period={filters.period}
        periodLabel={periodLabel}
        months={months}
        onPeriod={(v) => setFilter('period', v)}
        roll={summary.roll}
      />

      {error && <LoadError error={error} onRetry={refresh} />}

      <Cohorts
        summary={summary}
        regular={regular}
        risk={filters.risk}
        onRisk={(v) => setFilter('risk', filters.risk === v ? '' : v)}
      />

      <div className="att-analysis">
        <RollMeter summary={summary} regular={regular} />

        <MonthlyTrend
          months={months}
          selected={filters.period}
          onSelect={(key) => setFilter('period', filters.period === key ? '' : key)}
        />
      </div>

      <Roster
        rows={rows}
        pagination={pagination}
        loading={loading}
        options={options}
        filters={filters}
        setFilter={setFilter}
        setPage={setPage}
        onOpen={viewStudentProfile}
        periodLabel={periodLabel}
        sort={sort}
        onSort={toggle}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ header */

function Header({ period, periodLabel, months, onPeriod, roll }) {
  return (
    <header className="att-header">
      <div>
        <h2 className="att-title">Attendance</h2>
        <p className="att-body att-intro">
          {periodLabel
            ? <>Showing <strong>{periodLabel}</strong> only. Holidays are excluded; the 75% rule counts present and late marks.</>
            : <>All {roll.toLocaleString()} students on the roll. Holidays are excluded; the 75% rule counts present and late marks.</>}
        </p>
      </div>

      {/* A native select: a real control with real keyboard behaviour, and
          nothing here needs a custom listbox. */}
      <label className="att-field">
        <span className="att-label">Period</span>
        <select
          value={period}
          onChange={(e) => onPeriod(e.target.value)}
          className={`att-control att-period-select${period ? ' on' : ''}`}
        >
          <option value="">All months on record</option>
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} — {m.totalSessions.toLocaleString()} sessions
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

function LoadError({ error, onRetry }) {
  return (
    <div role="alert" className="att-card att-error">
      <p className="att-heading">Could not load attendance</p>
      <p className="att-body" style={{ margin: '4px 0 12px', textWrap: 'pretty' }}>{error}</p>
      <button type="button" onClick={onRetry} className="att-control" style={{ fontWeight: 600 }}>
        Try again
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- cohorts */

/*
 * One cohort: a figure, what it means, and — for the three that are cohorts of
 * students rather than a rate — the filter that opens it. A tile only takes
 * colour when it is asking for something.
 */
function CohortTile({ label, value, unit, note, tone, selected, onSelect }) {
  const interactive = Boolean(onSelect);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!interactive}
      aria-pressed={interactive ? selected : undefined}
      className={`att-card att-tile${interactive ? ' interactive' : ''}${selected ? ' on' : ''}`}
    >
      <span className="att-label">{label}</span>

      <span className="att-tile-value">
        <span className="att-figure" style={tone ? { color: tone } : undefined}>{value}</span>
        {unit && <span className="att-meta" style={{ fontWeight: 500 }}>{unit}</span>}
      </span>

      <span className="att-micro att-tile-note">
        {selected ? 'Filtering by this cohort — click to clear' : note}
      </span>
    </button>
  );
}

function Cohorts({ summary, regular, risk, onRisk }) {
  return (
    <section aria-label="Attendance cohorts" className="att-cohorts">
      <CohortTile
        label="Present rate"
        value={pct1(summary.average)}
        unit="%"
        note={`Mean across the ${summary.tracked.toLocaleString()} students who have a record`}
      />
      <CohortTile
        label="Meeting the requirement"
        value={regular.toLocaleString()}
        note="At or above 75% — eligible to sit the examinations"
        selected={risk === 'good'}
        onSelect={() => onRisk('good')}
      />
      <CohortTile
        label="Below 75%"
        value={summary.atRisk.toLocaleString()}
        note="Short of the requirement — eligibility at risk"
        tone={summary.atRisk > 0 ? BAD : INK}
        selected={risk === 'low'}
        onSelect={() => onRisk('low')}
      />
      {/* Amber rather than red: these students are not failing the requirement,
          nobody has measured them against it — a different problem, owed a
          different colour and its own list. */}
      <CohortTile
        label="Not tracked"
        value={summary.untracked.toLocaleString()}
        note={summary.untracked > 0
          ? 'No register entry at all — cannot be assessed against the rule'
          : 'Every student on the roll has a register entry'}
        tone={summary.untracked > 0 ? WARN : INK}
        selected={risk === 'untracked'}
        onSelect={() => onRisk('untracked')}
      />
    </section>
  );
}

/* --------------------------------------------------------------- the meter */

/*
 * The same figures as shares of one roll. The tiles state counts; this states
 * the relationship between them, and makes the denominator visible — the bar
 * sums to every student, so "not tracked" is a visible slice of the institute
 * rather than a number quietly missing from it.
 *
 * The legend is a four-column grid rather than a wrapping row of inline spans.
 * Wrapped, the counts landed wherever the text before them happened to end and
 * could not be read down; aligned, they can.
 */
function RollMeter({ summary, regular }) {
  const roll = Math.max(1, summary.roll);
  const segments = [
    { label: 'At or above 90%', value: summary.excellent, colour: OK },
    { label: '75–90%', value: summary.satisfactory, colour: '#34D399' },
    { label: 'Below 75%', value: summary.atRisk, colour: BAD },
    { label: 'Not tracked', value: summary.untracked, colour: '#CBD5E1' },
  ].filter((s) => s.value > 0);

  return (
    <section className="att-card att-meter">
      <div className="att-meter-head">
        <h3 className="att-heading">Standing against the 75% requirement</h3>
        <p className="att-meta">
          <strong className="att-num">{regular.toLocaleString()}</strong>
          {' '}of {summary.roll.toLocaleString()} eligible
        </p>
      </div>

      <div
        role="img"
        aria-label={segments.map((s) => `${s.value} ${s.label}`).join(', ')}
        className="att-meter-bar"
      >
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.value.toLocaleString()} — ${s.label}`}
            style={{ width: `${(s.value / roll) * 100}%`, backgroundColor: s.colour }}
          />
        ))}
      </div>

      <div className="att-meter-legend">
        {segments.map((s) => (
          <span key={s.label} className="att-legend-row">
            <span className="att-swatch" style={{ backgroundColor: s.colour }} />
            <span className="att-meta">{s.label}</span>
            <span className="att-meta att-num att-legend-count">{s.value.toLocaleString()}</span>
            <span className="att-micro att-num">{((s.value / roll) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- monthly trend */

/*
 * The month-by-month rate.
 *
 * Bars are grouped under their real year. The chart previously carried a
 * hardcoded "(2026)" heading over data from 2024 and labelled its bars by month
 * name alone, so a break in the record read as the next month along.
 *
 * A month carrying a handful of sessions is not evidence about an institute of
 * two thousand, so those bars are drawn hollow and say so — the figure is not
 * wrong, it just is not something to steer by.
 */
const LOW_CONFIDENCE_SHARE = 0.05;

/* Zoom stops, not a continuous range: five predictable sizes a keyboard and a
   wheel can both walk, rather than a slider that never lands anywhere twice. */
const ZOOM_STEPS = [0.7, 0.85, 1, 1.3, 1.7];
const DEFAULT_ZOOM = 2; // index of 1×

function MonthlyTrend({ months, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM);
  const [overflowing, setOverflowing] = useState(false);
  const scrollRef = useRef(null);

  const zoom = ZOOM_STEPS[zoomIndex];

  const zoomBy = useCallback((delta) => {
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta)));
  }, []);

  /*
   * Ctrl/⌘ + wheel zooms, a plain wheel scrolls.
   *
   * Bound with `addEventListener(..., { passive: false })` rather than as an
   * onWheel prop: React attaches wheel listeners as passive, and a passive
   * listener cannot call preventDefault — so without this the browser's own
   * page zoom would fire at the same time and the chart would zoom inside a
   * page that was also zooming.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  /*
   * Whether the chart is actually wider than its column, so the "drag to
   * scroll" hint is shown only when there is something to scroll to. Re-checked
   * on zoom and on resize, because both change the answer.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();

    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, months]);

  if (months.length === 0) {
    return (
      <section className="att-card att-chart">
        <h3 className="att-heading">Monthly rate</h3>
        <p className="att-body att-chart-empty">
          No attendance has been marked yet, so there is no trend to draw.
        </p>
      </section>
    );
  }

  const busiest = Math.max(...months.map((m) => m.totalSessions), 1);
  const thin = (m) => m.totalSessions < busiest * LOW_CONFIDENCE_SHARE;
  const thinCount = months.filter(thin).length;
  const years = [...new Set(months.map((m) => m.year))];

  return (
    <section
      className="att-card att-chart"
      style={{ '--att-zoom': zoom }}
    >
      <div className="att-chart-head">
        <div>
          <h3 className="att-heading">Monthly rate</h3>
          <p className="att-meta" style={{ marginTop: '4px', textWrap: 'pretty' }}>
            Present and late as a share of sessions marked.
            {thinCount > 0 && ' Hollow bars carry too few sessions to read as a rate.'}
            {' '}Select a month to filter this screen.
          </p>
        </div>

        <div className="att-chart-keys">
          <Key colour={OK} label="Present" />
          <Key colour="#F1F5F9" label="Absent" outlined />

          <div className="att-zoom" role="group" aria-label="Chart zoom">
            <button
              type="button"
              className="att-zoom-btn"
              onClick={() => zoomBy(-1)}
              disabled={zoomIndex === 0}
              aria-label="Zoom out"
              title="Zoom out (Ctrl + scroll down)"
            >
              <Minus size={14} />
            </button>
            <span className="att-zoom-level" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="att-zoom-btn"
              onClick={() => zoomBy(1)}
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              aria-label="Zoom in"
              title="Zoom in (Ctrl + scroll up)"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="att-zoom-btn"
              onClick={() => setZoomIndex(DEFAULT_ZOOM)}
              disabled={zoomIndex === DEFAULT_ZOOM}
              aria-label="Reset zoom to 100%"
              title="Reset zoom"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="att-chart-body">
        {/*
          * The y-axis, exactly as tall as the plot.
          *
          * It used to be a column of the same height pushed up by a hardcoded
          * `marginBottom: 46px` — a guess at how tall the labels under the
          * bars were, which had to be re-guessed whenever the label text
          * changed. The labels are no longer inside the plot, so there is
          * nothing to clear.
          */}
        <div className="att-chart-axis" aria-hidden="true">
          {[100, 75, 50, 25, 0].map((v) => (
            // 75 is the requirement, not a gradation. It is coloured to match
            // the dashed rule drawn across the plot at the same height.
            <span key={v} className={v === 75 ? 'rule' : undefined}>{v}%</span>
          ))}
        </div>

        <div className="att-chart-scroll" ref={scrollRef}>
          <div className="att-chart-years">
            {years.map((year) => (
              <div className="att-chart-year" key={year}>
                <div className="att-chart-cols">
                  {/* The 75% rule, drawn once across the plot. Every bar's top
                      edge is at the same y, so one overlay at a fixed offset
                      from the top is correct — it used to be positioned from a
                      bottom edge that was not where it appeared to be. */}
                  <div className="att-chart-rule" />

                  {months.filter((m) => m.year === year).map((m) => {
                    const isThin = thin(m);
                    const on = m.key === selected;
                    const isHover = hovered === m.key;

                    return (
                      <button
                        key={m.key}
                        type="button"
                        className={`att-bar${on ? ' on' : ''}`}
                        onClick={() => onSelect(m.key)}
                        onMouseEnter={() => setHovered(m.key)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(m.key)}
                        onBlur={() => setHovered(null)}
                        aria-pressed={on}
                        aria-label={`${m.label}: ${pct1(m.presentPct)}% present across `
                          + `${m.totalSessions.toLocaleString()} sessions`
                          + `${isThin ? ' — too few sessions to read as a rate' : ''}`}
                      >
                        {(isHover || on) && (
                          <span className="att-bar-tip" role="presentation">
                            <span className="att-bar-tip-title">{m.label}</span>
                            <span className="att-bar-tip-note">
                              {pct1(m.presentPct)}% present · {m.totalSessions.toLocaleString()} sessions
                            </span>
                            {isThin && (
                              <span className="att-bar-tip-warn">
                                Too few sessions to read as a rate
                              </span>
                            )}
                          </span>
                        )}

                        <span className={`att-bar-track${isThin ? ' thin' : ''}`}>
                          <span
                            className="att-bar-fill"
                            style={{ height: `${m.presentPct ?? 0}%` }}
                          />
                        </span>

                        <span className="att-bar-month">{m.month}</span>
                        <span className="att-bar-pct">{pct1(m.presentPct)}%</span>
                      </button>
                    );
                  })}
                </div>

                <p className="att-label att-chart-yearlabel">{year}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Shown only while the chart genuinely overflows. A hint about scrolling
          on a chart that fits is noise. */}
      {overflowing && (
        <p className="att-chart-hint">
          <MoveHorizontal size={13} aria-hidden="true" />
          Scroll sideways to see the rest · Ctrl + scroll to zoom
        </p>
      )}
    </section>
  );
}

function Key({ colour, label, outlined }) {
  return (
    <span className="att-key">
      <span
        className={`att-key-swatch${outlined ? ' outlined' : ''}`}
        style={{ backgroundColor: colour }}
      />
      <span className="att-meta">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------- the table */

const RISK_LABEL = {
  low: 'below 75%',
  good: 'at or above 90%',
  untracked: 'with no register entry',
};

/* Every column is sortable except Standing, which is derived from Attendance
   and would sort identically to it. */
const COLUMNS = [
  { key: 'regNo', label: 'Reg. no.' },
  { key: 'name', label: 'Student' },
  { key: 'program', label: 'Programme' },
  { key: 'sessions', label: 'Sessions', align: 'right', title: 'Sessions marked, excluding holidays. One session is one timetable period.' },
  { key: 'present', label: 'Present', align: 'right' },
  { key: 'late', label: 'Late', align: 'right' },
  { key: 'absent', label: 'Absent', align: 'right' },
  { key: 'leave', label: 'Leave', align: 'right' },
  { key: 'attendance', label: 'Attendance', title: 'Present and late, over sessions marked' },
];

function Roster({
  rows, pagination, loading, options, filters, setFilter, setPage, onOpen,
  periodLabel, sort, onSort,
}) {
  return (
    <section className="att-card att-roster">
      <div className="att-roster-head">
        <div>
          <h3 className="att-heading">Students</h3>
          <p className="att-meta" style={{ marginTop: '4px' }}>
            {pagination.total.toLocaleString()} student{pagination.total === 1 ? '' : 's'}
            {filters.risk ? ` ${RISK_LABEL[filters.risk] ?? ''}` : ''}
            {periodLabel ? ` · ${periodLabel}` : ''}
          </p>
        </div>

        <div className="att-roster-filters">
          <select
            value={filters.batch_id}
            onChange={(e) => setFilter('batch_id', e.target.value)}
            className={`att-control${filters.batch_id ? ' on' : ''}`}
          >
            <option value="">All batches</option>
            {options.batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>
            ))}
          </select>

          <select
            value={filters.program_id}
            onChange={(e) => setFilter('program_id', e.target.value)}
            className={`att-control${filters.program_id ? ' on' : ''}`}
          >
            <option value="">All programmes</option>
            {options.programs.map((p) => (
              <option key={p.program_id} value={p.program_id}>{p.program_name}</option>
            ))}
          </select>

          <FilterField
            value={filters.q}
            onChange={(v) => setFilter('q', v)}
            placeholder="Search by student name or registration number…"
            className="att-roster-search"
          />
        </div>
      </div>

      <div className="att-table-wrap">
        <table className="att-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <SortHeader
                  key={c.key}
                  label={c.label}
                  sortKey={c.key}
                  sort={sort}
                  onToggle={onSort}
                  align={c.align || 'left'}
                  title={c.title}
                />
              ))}
              <th scope="col">Standing</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="att-empty-cell">
                  {loading ? 'Loading…' : 'No students match these filters.'}
                </td>
              </tr>
            ) : rows.map((st) => (
              <Row key={st.id} st={st} onOpen={onOpen} />
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
    </section>
  );
}

function Row({ st, onOpen }) {
  /*
   * `attendancePercent` is null for a student with no register entry. The old
   * row ran `parseFloat(null) < 75` — that is `NaN < 75`, which is false — so
   * these students were badged green and "eligible". Handled, not coerced.
   */
  const pct = st.attendancePercent;
  const untracked = pct == null;
  const short = !untracked && pct < 75;
  const tone = untracked ? INK_4 : short ? BAD : OK;

  const open = () => onOpen(st.id);

  return (
    <tr
      className="att-row"
      onClick={open}
      // A row that opens a record is a control, and it was reachable only by
      // mouse. Enter and Space open it now, and it takes a focus ring.
      tabIndex={0}
      role="link"
      aria-label={`Open ${st.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
    >
      <td className="att-cell-reg">{st.regNo}</td>

      <td className="att-cell-name">
        <span>
          <UserAvatar
            userId={st.userId}
            name={st.name}
            initials={initialsOf(st.name)}
            size={28}
            bg={`${avatarInkOf(st.id)}14`}
            color={avatarInkOf(st.id)}
            style={{ fontSize: '11px', fontWeight: 700 }}
          />
          {st.name}
        </span>
      </td>

      <td>{st.program || <span style={{ color: INK_4 }}>—</span>}</td>

      <Num value={st.totalClasses} strong />
      <Num value={st.presentDays} tone={OK} />
      <Num value={st.lateDays} tone={WARN} />
      <Num value={st.absentDays} tone={BAD} />
      <Num value={st.leaveDays} />

      <td>
        {untracked ? (
          <span className="att-meta" style={{ color: INK_4 }}>Not measured</span>
        ) : (
          <span className="att-pct">
            <span className="att-pct-value" style={{ color: tone }}>{pct1(pct)}%</span>
            <span className="att-pct-track">
              <span
                className="att-pct-fill"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: tone }}
              />
            </span>
          </span>
        )}
      </td>

      <td>
        <Standing untracked={untracked} short={short} />
      </td>
    </tr>
  );
}

/* A zero is a real measurement and prints as 0; a null means nobody marked this
   student, and prints as a dash. Collapsing the two is what let unmarked
   students read as having attended nothing. */
function Num({ value, tone, strong }) {
  const empty = value == null;
  const zero = value === 0;
  return (
    <td
      className={`att-cell-num${strong ? ' strong' : ''}${empty ? ' empty' : ''}${zero ? ' zero' : ''}`}
      style={!empty && !zero && tone ? { color: tone } : undefined}
    >
      {empty ? '—' : Number(value).toLocaleString()}
    </td>
  );
}

/* Three standings, not two. "Not measured" is a different state from "meets the
   requirement", and collapsing them certified unmarked students as eligible. */
function Standing({ untracked, short }) {
  const [cls, text] = untracked
    ? ['untracked', 'Not tracked']
    : short
      ? ['short', 'Below 75%']
      : ['eligible', 'Eligible'];

  return <span className={`att-standing ${cls}`}>{text}</span>;
}

export default AttendanceView;
