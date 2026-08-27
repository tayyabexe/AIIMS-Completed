import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import { useStudentProfile } from '../../context/StudentProfileContext';
import './StudentDashboard.css';
import './Result.css';
import { SkeletonRegion, SkeletonStatRow, SkeletonChart, SkeletonTable } from '../../components/common/Skeleton';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconCheckCircle, IconAward, IconAlertCircle,
} from '../../components/student/icons';

/*
 * The signed-in student's own results.
 *
 * This page used to render eight invented subjects ("CS601 Machine Learning,
 * quiz 18, mid 22 ..."), a fixed Sem 1-8 strip, a hardcoded 3.70 CGPA and a
 * grade ladder of its own (A+ = 10 points, then multiplied by 0.4) that matched
 * nothing in the database.
 *
 * Everything below is derived in api/studentData.js from:
 *   GET /api/marks/student/:id  — the student's RELEASED marks, joined to exams
 *                                 and subjects so each score has a denominator
 *   GET /api/enrollments/student/:id — the courses they are registered for
 *   GET /api/student-results    — published GPA/CGPA per semester
 *   GET /api/results/grades     — the institute's real grading scale
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE PROMISES (Tasks 8, 9 and 10)
 * ---------------------------------------------------------------------------
 * Three defects met on this one screen, and they were really one defect: the
 * page could not tell the difference between a course that had not been marked
 * and a course that was not there, so it showed both as nothing, and filled the
 * gap with a GPA it worked out itself.
 *
 *   TASK 8 — the table is the ENROLMENT ROSTER, not the list of marks. Every
 *            registered course has a row from the day it is registered. A
 *            course with nothing released yet says "Awaiting result" instead of
 *            being absent.
 *
 *   TASK 9 — a GPA is shown only when the institute has published one. The old
 *            page computed a provisional GPA in the browser and captioned it
 *            "not published yet", which is a number with the authority of a
 *            result and none of the checking. No published result now means no
 *            GPA, and the page says which it is.
 *
 *   TASK 10 — a mark reaches this page when an administrator releases it, not
 *            when a teacher types it. That gate is in the API
 *            (markController.getStudentMarks); what this page adds is telling
 *            the student the difference, so an empty row reads as "not out yet"
 *            rather than as "you scored nothing".
 *
 * The rule the whole screen follows: never show a figure the institute has not
 * stood behind, and never leave the absence of one unexplained.
 */

const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const ITEMS_PER_PAGE = 8;

/* The four exam types the `exams` table records marks against, in the order a
   transcript reads. "Practical" and "Viva" also exist and are folded into the
   subject total but do not get their own column. */
const COMPONENT_COLUMNS = [
  { key: 'Quiz', label: 'Quiz' },
  { key: 'Assignment', label: 'Assignment' },
  { key: 'Mid-Term', label: 'Mid' },
  { key: 'Final', label: 'Final' },
];

/*
 * A mark, printed the way a mark should read.
 *
 * `marks.obtained_marks` is decimal(6,2), so a subject total is a fraction such
 * as 106.68 and adding five of them up in binary floating point produces
 * 377.79999999999995 — which the semester summary printed verbatim. Rounding to
 * one decimal keeps the figure honest (106.7, not a re-rounded 107 that no
 * longer agrees with the 71.1% shown beside it) and drops a pointless ".0" from
 * a whole number.
 */
const marks = (n) => {
  if (n === null || n === undefined) return '—';
  const value = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const componentScore = (subject, type) => {
  const parts = subject.components.filter((c) => c.type === type && c.obtained !== null);
  if (!parts.length) return null;
  return {
    obtained: parts.reduce((t, c) => t + c.obtained, 0),
    total: parts.reduce((t, c) => t + (c.total ?? 0), 0),
  };
};

const showComponent = (subject, type) => {
  const s = componentScore(subject, type);
  if (!s) return '—';
  return s.total ? `${marks(s.obtained)} / ${marks(s.total)}` : marks(s.obtained);
};

/* Row tint by percentage, matching the legend under the table header. */
const rowClassFor = (percent) => {
  if (percent === null) return '';
  if (percent >= 90) return 'row-excellent';
  if (percent >= 75) return 'row-good';
  if (percent >= 60) return 'row-average';
  return 'row-poor';
};

const gradeColors = {
  'A+': '#16a34a', A: '#22c55e', 'B+': '#2563eb', B: '#7c3aed',
  'C+': '#d97706', C: '#dc2626', D: '#9ca3af', F: '#b91c2c',
};

const fmt = (n, digits = 2) => (n === null || n === undefined ? '—' : Number(n).toFixed(digits));

const Result = () => {
  const { studentData, loading, error } = useStudentProfile();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const [activeSem, setActiveSem] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results', active: true },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  // Only the semesters this student actually has a record for.
  const semesters = useMemo(() => studentData?.semesters || [], [studentData]);

  // Default to the latest semester on record, once it is known.
  useEffect(() => {
    if (activeSem === null && semesters.length) {
      setActiveSem(semesters[semesters.length - 1].semesterId);
    }
  }, [semesters, activeSem]);

  useEffect(() => { setCurrentPage(1); }, [activeSem]);

  const semester = semesters.find((s) => s.semesterId === activeSem) || null;
  const records = semester?.subjects || [];

  /* ── Semester totals, all from the student's own released marks ── */
  const stats = useMemo(() => {
    const scored = records.filter((r) => r.percent !== null);
    const obtained = records.reduce((t, r) => t + r.obtained, 0);
    const total = records.reduce((t, r) => t + r.total, 0);

    return {
      // Credits of every registered course, including the ones still awaiting a
      // result — this is the semester's weight, not a running total of what has
      // come back so far.
      credits: records.reduce((t, r) => t + (Number(r.credits) || 0), 0),
      obtained,
      total,
      // The semester's own marks over the marks available — the same ratio the
      // per-subject percentages use, kept to one decimal so it reconciles with
      // them instead of being a rounded-off whole number.
      overallPct: total > 0 ? Math.round((obtained / total) * 1000) / 10 : null,
      passed: records.filter((r) => r.passed === true).length,
      graded: scored.length,
      // Registered, nothing released yet. The number the page leads with when
      // it is non-zero, because it explains every dash below it.
      awaiting: records.filter((r) => r.awaitingResult).length,
    };
  }, [records]);

  /* ── Pagination ── */
  const totalPages = Math.max(Math.ceil(records.length / ITEMS_PER_PAGE), 1);
  const paginatedRecords = records.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );
  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  /* ── Grade distribution, only over subjects that have a real grade ── */
  const gradeDist = useMemo(() => {
    const dist = new Map();
    for (const r of records) {
      if (!r.grade) continue;
      dist.set(r.grade, (dist.get(r.grade) || 0) + 1);
    }
    // Best grade first, using the grade point the scale supplied.
    const pointOf = (letter) =>
      records.find((r) => r.grade === letter)?.gradePoint ?? 0;
    return [...dist.entries()].sort((a, b) => pointOf(b[0]) - pointOf(a[0]));
  }, [records]);

  const maxGradeCount = gradeDist.length ? Math.max(...gradeDist.map(([, c]) => c)) : 0;

  /* ── Academic standing, computed rather than asserted ── */
  const standing = useMemo(() => {
    const scored = records.filter((r) => r.percent !== null);
    if (!scored.length) return null;

    const best = scored.reduce((a, b) => (b.percent > a.percent ? b : a));
    const worst = scored.reduce((a, b) => (b.percent < a.percent ? b : a));
    const failed = records.filter((r) => r.passed === false);

    return { best, worst, failed };
  }, [records]);

  const cgpa = studentData?.profile?.cgpa ?? null;
  const gpa = semester?.gpa ?? null;

  /*
   * Whether the institute has published this semester's result.
   *
   * This is the switch the whole top of the page turns on. `gpa === null` is
   * not the same question — a published result could in principle carry a null
   * GPA — so the page asks the fact directly rather than inferring it from a
   * missing number.
   */
  const isPublished = semester?.published === true;

  /* The GPA ring is filled by GPA against the 4.0 scale, not by an average
     percentage standing in for it. */
  const ringPct = gpa === null ? 0 : Math.min((gpa / 4) * 100, 100);

  const renderBody = () => {
    if (loading) {
      return (
        <SkeletonRegion label="Loading your results">
          <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
          <SkeletonChart height={210} bars={8} style={{ marginBottom: '1.25rem' }} />
          <SkeletonTable rows={7} cols={6} />
        </SkeletonRegion>
      );
    }

    if (error) {
      return (
        <div className="result-empty-card">
          <div className="result-empty-icon"><IconAlertCircle /></div>
          <h3 className="result-empty-title">Could not load your results</h3>
          <p className="result-empty-text">{error}</p>
        </div>
      );
    }

    /* Reached only when the student has no registrations AND no results — the
       page no longer falls here merely because nothing has been marked. */
    if (!semesters.length) {
      return (
        <div className="result-empty-card">
          <div className="result-empty-icon"><IconTrending /></div>
          <h3 className="result-empty-title">No courses registered</h3>
          <p className="result-empty-text">
            You are not registered for any courses yet, so there is nothing to report.
            Results appear here once you are enrolled and the examination office
            releases them.
          </p>
        </div>
      );
    }

    return (
      <>
        {/* ── Performance overview ── */}
        <div className="overview-grid">
          {/*
            * The GPA card has two states, and it commits to one of them.
            *
            * Published: the ring, the figure, and the date it was released.
            * Not published: no ring and no number at all — an explanation of
            * what has to happen first. It deliberately does NOT show a greyed
            * "0.00" or a provisional figure, because a number on this card is
            * read as the student's standing whatever caption sits under it.
            */}
          <div className="overview-card cgpa-card">
            <span className="card-title">
              {semester ? `${semester.label} GPA` : 'Semester GPA'}
            </span>

            {isPublished ? (
              <>
                <div className="cgpa-ring-wrap">
                  <svg viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" stroke="#eceef2" strokeWidth="10" fill="none" />
                    <circle
                      cx="60" cy="60" r="50"
                      stroke="#22c55e" strokeWidth="10" fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${(ringPct / 100) * 314.16} 314.16`}
                      transform="rotate(-90 60 60)"
                    />
                  </svg>
                  <div className="cgpa-ring-center">
                    <span className="cgpa-value">{fmt(gpa)}</span>
                    <span className="cgpa-label">GPA</span>
                  </div>
                </div>
                {semester?.publishedAt && (
                  <p className="result-note">
                    Published {new Date(semester.publishedAt).toLocaleDateString(undefined, {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </p>
                )}
              </>
            ) : (
              <div className="gpa-pending">
                <span className="gpa-pending-icon"><IconClock /></span>
                <p className="gpa-pending-title">Result not published yet</p>
                <p className="gpa-pending-text">
                  Your GPA for {semester ? semester.label : 'this semester'} is calculated and
                  released by the examination office once all marks are approved.
                  {stats.awaiting > 0 && ` ${stats.awaiting} of your ${records.length} `
                    + `course${records.length === 1 ? '' : 's'} `
                    + `${stats.awaiting === 1 ? 'is' : 'are'} still awaiting results.`}
                </p>
              </div>
            )}

            <div className="cgpa-stats-row">
              <div className="cgpa-stat">
                <span className="cgpa-stat-val">{fmt(cgpa)}</span>
                <span className="cgpa-stat-lbl">CGPA</span>
              </div>
              <div className="cgpa-stat">
                <span className="cgpa-stat-val">{stats.credits || '—'}</span>
                <span className="cgpa-stat-lbl">Credits</span>
              </div>
            </div>
          </div>

          <div className="overview-card summary-card-wide">
            <span className="card-title">Semester Summary</span>
            {/* "Awaiting" replaces "Passed" while anything is outstanding: how
                many results are still to come is the more useful fact, and a
                pass count over a partial set invites the wrong conclusion. */}
            <div className="summary-stats-row">
              {stats.awaiting > 0 ? (
                <div className="summary-stat-box amber">
                  <span className="summary-stat-value">{stats.awaiting}</span>
                  <span className="summary-stat-label">Awaiting Result</span>
                </div>
              ) : (
                <div className="summary-stat-box green">
                  <span className="summary-stat-value">{stats.passed}</span>
                  <span className="summary-stat-label">Passed</span>
                </div>
              )}
              <div className="summary-stat-box purple">
                <span className="summary-stat-value">
                  {stats.overallPct === null ? '—' : `${stats.overallPct.toFixed(1)}%`}
                </span>
                <span className="summary-stat-label">
                  {stats.awaiting > 0 ? 'Avg. So Far' : 'Avg. Score'}
                </span>
              </div>
              <div className="summary-stat-box orange">
                <span className="summary-stat-value">{records.length}</span>
                <span className="summary-stat-label">Subjects</span>
              </div>
              <div className="summary-stat-box blue">
                <span className="summary-stat-value">
                  {stats.total ? `${marks(stats.obtained)}/${marks(stats.total)}` : '—'}
                </span>
                <span className="summary-stat-label">Marks Obtained</span>
              </div>
            </div>

            <span className="card-title grade-dist-title">Grade Distribution</span>
            <div className="grade-dist">
              {gradeDist.length === 0 ? (
                <p className="result-inline-empty">
                  {stats.awaiting > 0
                    ? 'No results have been released for this semester yet.'
                    : 'No graded subjects in this semester yet.'}
                </p>
              ) : (
                gradeDist.map(([letter, count]) => (
                  <div className="grade-bar-col" key={letter}>
                    <span className="grade-bar-count">{count}</span>
                    <div className="grade-bar-track">
                      <div
                        className="grade-bar-fill"
                        style={{
                          height: `${(count / maxGradeCount) * 100}%`,
                          background: gradeColors[letter] || '#9ca3af',
                        }}
                      ></div>
                    </div>
                    <span className="grade-bar-label">{letter}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Result Table ── */}
        <div className="table-card">
          <div className="table-card-header">
            <span className="card-title" style={{ margin: 0 }}>
              Subject-wise Results — {semester ? semester.label : '—'}
            </span>
            <div className="table-legend">
              <span><i className="dot-legend excellent"></i> 90-100</span>
              <span><i className="dot-legend good"></i> 75-89</span>
              <span><i className="dot-legend average"></i> 60-74</span>
              <span><i className="dot-legend poor"></i> Below 60</span>
            </div>
          </div>

          {/*
            * Said once, above the table, rather than left to be inferred from a
            * row of dashes. A student looking at a blank line needs to know
            * whether their mark is missing or simply not out yet — those feel
            * identical on screen and are not remotely the same thing.
            */}
          {stats.awaiting > 0 && (
            <div className="awaiting-banner">
              <span className="awaiting-banner-icon"><IconClock /></span>
              <span>
                <strong>
                  {stats.awaiting} of {records.length} course
                  {records.length === 1 ? '' : 's'} awaiting results.
                </strong>{' '}
                Marks appear here once the examination office releases them. Your
                teachers may have finished marking before then.
              </span>
            </div>
          )}
          <div className="result-table">
            <div className="table-row table-head">
              <span>Code</span>
              <span>Subject Title</span>
              {COMPONENT_COLUMNS.map((c) => <span key={c.key}>{c.label}</span>)}
              <span>Total</span>
              <span>Grade</span>
              <span>Points</span>
              <span>Status</span>
            </div>
            {paginatedRecords.length === 0 ? (
              <div className="table-row">
                <span className="cell-subject" style={{ gridColumn: '1 / -1' }}>
                  You have no courses registered for this semester.
                </span>
              </div>
            ) : (
              paginatedRecords.map((r) => (
                <div
                  className={`table-row ${r.awaitingResult ? 'row-awaiting' : rowClassFor(r.percent)}`}
                  key={r.key}
                >
                  <span className="cell-code">{r.code || '—'}</span>
                  <span className="cell-subject">{r.title}</span>
                  {COMPONENT_COLUMNS.map((c) => (
                    <span className="cell-quiz" key={c.key}>{showComponent(r, c.key)}</span>
                  ))}
                  <span className="cell-total">
                    {r.total ? `${marks(r.obtained)} / ${marks(r.total)}` : '—'}
                  </span>
                  <span className={`cell-grade grade-${String(r.grade || '').replace('+', 'p')}`}>
                    {r.grade || '—'}
                  </span>
                  <span className="cell-gpa">{fmt(r.gradePoint)}</span>
                  <span>
                    {/*
                      * Three states, kept distinct on purpose. "Awaiting result"
                      * is a registered course nothing has been released for —
                      * previously it had no row at all (Task 8) and, before the
                      * read path was gated, showed a teacher's unfinished draft
                      * as though it were final (Task 10). "Pending" remains what
                      * it always was: marks are out, but the grading scale gave
                      * no verdict.
                      */}
                    {r.awaitingResult ? (
                      <span className="status-pill awaiting">Awaiting result</span>
                    ) : r.passed === null ? (
                      <span className="status-pill">Pending</span>
                    ) : (
                      <span className={`status-pill ${r.passed ? 'good' : 'low'}`}>
                        {r.passed ? '✓ Pass' : '✗ Fail'}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="table-footer">
            <span className="table-footer-item">
              <strong>Total Credits:</strong> {stats.credits || '—'}
            </span>
            <span className="table-footer-item">
              <strong>Results Released:</strong> {stats.graded} of {records.length}
            </span>
            <span className="table-footer-item">
              {/* Only ever the published CGPA — the footer used to print
                  whatever number the card above it was showing, computed one
                  included. */}
              <strong>CGPA:</strong>{' '}
              {cgpa === null
                ? <span className="cgpa-highlight muted">Not published</span>
                : <span className="cgpa-highlight">{fmt(cgpa)}/4.0</span>}
            </span>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn pagination-prev"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                ‹ Prev
              </button>
              <div className="pagination-pages">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    className={`pagination-page ${currentPage === page ? 'active' : ''}`}
                    onClick={() => handlePageChange(page)}
                    aria-current={currentPage === page ? 'page' : undefined}
                    aria-label={`Page ${page}`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                className="pagination-btn pagination-next"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next ›
              </button>
              <span className="pagination-info">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–
                {Math.min(currentPage * ITEMS_PER_PAGE, records.length)} of {records.length}
              </span>
            </div>
          )}
        </div>

        {/* ── Academic standing — every line computed from the rows above ── */}
        {standing && (
          <div className="bottom-grid">
            <div className="achievement-card">
              <span className="card-title">Academic Standing</span>
              <div className="achievement-body">
                <div className="achievement-item">
                  <span className="achievement-icon award"><IconAward /></span>
                  <div className="achievement-info">
                    <span className="achievement-label">Best Performer</span>
                    {/* The marks the percentage is taken from are shown with
                        it, so the figure can be checked rather than trusted:
                        106.7/150 is 71.1%, which reads as arithmetic only when
                        both numbers are on screen. */}
                    <span className="achievement-value">
                      {standing.best.title} ({marks(standing.best.obtained)}/
                      {marks(standing.best.total)} · {standing.best.percent}%)
                    </span>
                  </div>
                </div>

                <div className="achievement-item">
                  <span className="achievement-icon check"><IconCheckCircle /></span>
                  <div className="achievement-info">
                    <span className="achievement-label">Attendance</span>
                    <span className="achievement-value">
                      {studentData?.attendance?.percent === null
                        ? 'No attendance recorded'
                        : `${studentData.attendance.percent}% across ${studentData.attendance.counted} sessions`}
                    </span>
                  </div>
                </div>

                <div className="achievement-item">
                  <span className={`achievement-icon ${standing.failed.length ? 'warning' : 'check'}`}>
                    {standing.failed.length ? <IconAlertCircle /> : <IconCheckCircle />}
                  </span>
                  <div className="achievement-info">
                    <span className="achievement-label">Backlogs</span>
                    <span className="achievement-value">
                      {standing.failed.length
                        ? standing.failed.map((f) => f.code || f.title).join(', ')
                        : 'None this semester'}
                    </span>
                  </div>
                </div>

                <div className="achievement-item">
                  <span className="achievement-icon warning"><IconAlertCircle /></span>
                  <div className="achievement-info">
                    <span className="achievement-label">Lowest Score</span>
                    <span className="achievement-value">
                      {standing.worst.title} ({marks(standing.worst.obtained)}/
                      {marks(standing.worst.total)} · {standing.worst.percent}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Semester-by-semester GPA, from the results actually on record. */}
              <div className="cgpa-bar-block">
                <span className="card-title" style={{ marginBottom: 8 }}>GPA by Semester</span>
                <div className="sem-progress-bar">
                  <div className="sem-progress-track">
                    {/* An unpublished semester is an empty segment, not a
                        segment reading 0.00 — which is a grade, and a bad one. */}
                    {semesters.map((s) => (
                      <div
                        key={s.semesterId}
                        className={`sem-progress-seg ${s.published && s.gpa !== null ? 'filled' : ''}`}
                        style={{ width: `${100 / semesters.length}%` }}
                        title={s.published
                          ? `${s.label}: GPA ${fmt(s.gpa)}`
                          : `${s.label}: result not published yet`}
                      >
                        <span className="sem-progress-label">
                          {s.published ? fmt(s.gpa) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="sem-progress-labels">
                    <span>{semesters[0]?.label}</span>
                    <span style={{ marginLeft: 'auto' }}>
                      {semesters[semesters.length - 1]?.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="dashboard-layout">
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${isMenuOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand" onClick={() => window.history.back()}>
          <span className="brand-icon"><IconCap2 /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2026</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* ── Main wrapper ── */}
      <div className="main-wrapper">
        <StudentTopBar onMenuToggle={toggleMenu} />

        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Results</span>
        </div>

        <div className="result-page">
          <div className="result-page-header">
            <div>
              <h1 className="result-title">Academic Results</h1>
              {/* The programme was a fixed "Bachelor of Technology — Computer
                  Science & Engineering"; it is the student's own now. */}
              <p className="result-subtitle">
                {studentData?.profile?.program && studentData.profile.program !== '—'
                  ? studentData.profile.program
                  : 'Your academic record'}
              </p>
            </div>
            {/* Only semesters this student has a record for. */}
            <div className="sem-pills">
              {semesters.map((s) => (
                <button
                  key={s.semesterId}
                  className={`sem-pill ${activeSem === s.semesterId ? 'active' : ''}`}
                  onClick={() => setActiveSem(s.semesterId)}
                  title={s.published ? `${s.label} · published` : `${s.label} · not published yet`}
                >
                  {/* The semester NUMBER, from the enrollment. semesterId is a
                      global row id, so this pill read "Sem 23" for a student in
                      their first semester of the fifth programme on record. */}
                  Sem {s.semesterNumber ?? s.semesterId}
                  {!s.published && <i className="sem-pill-dot" title="Result not published" />}
                </button>
              ))}
            </div>
          </div>

          {renderBody()}
        </div>
      </div>
    </div>
  );
};

export default Result;
