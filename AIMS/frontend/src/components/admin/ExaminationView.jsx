import React, { useState, useEffect, useMemo } from 'react';
import {
  Award,
  TrendingUp,
  AlertTriangle,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  GraduationCap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage, useListParams } from '../../hooks/useAdminPage';
import Pagination from '../common/Pagination';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import { PASS_GPA } from '../../utils/helpers';
import ResultPublishing from './ResultPublishing';
import UserAvatar from '../common/UserAvatar';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell,
} from 'recharts';

/*
 * Colours only. The set of grades comes from the database — see `gradeLetters`
 * inside the component — so a band added to the `grades` table appears here
 * without a code change, falling back to grey if it has no colour assigned.
 */
const GRADE_COLORS = {
  'A+': '#059669',
  'A': '#10B981',
  'A-': '#34D399',
  'B+': '#65A30D',
  'B': '#D97706',
  'B-': '#F59E0B',
  'C+': '#F97316',
  'C': '#EAB308',
  'C-': '#FB923C',
  'D+': '#EF4444',
  'D': '#9333EA',
  'F': '#DC2626',
};
const PIE_COLORS = ['#059669', '#10B981', '#65A30D', '#D97706', '#EAB308', '#9333EA', '#DC2626'];

const getGradeColor = (grade) => GRADE_COLORS[grade] || '#64748B';
const getGradeBg = (grade) => {
  const map = {
    'A+': '#ECFDF5',
    'A': '#D1FAE5',
    'B+': '#ECFCCB',
    'B': '#FEF3C7',
    'C': '#FEF08A',
    'D': '#F3E8FF',
    'F': '#FEE2E2',
  };
  return map[grade] || '#F8FAFC';
};

const getScoreColor = (score) => {
  if (score >= 80) return '#059669';
  if (score >= 70) return '#D97706';
  return '#DC2626';
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div style={{
        backgroundColor: '#0F172A',
        color: 'white',
        padding: '0.65rem 1rem',
        borderRadius: '12px',
        fontSize: '0.78rem',
        boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
        textAlign: 'center',
      }}>
        <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '4px', color: '#F8FAFC' }}>
          Grade {data.grade}
        </strong>
        <div style={{ color: data.grade === 'F' ? '#FCA5A5' : '#34D399', fontWeight: 800 }}>
          {data.count} Student{data.count !== 1 ? 's' : ''}
        </div>
        <div style={{ color: '#94A3B8', fontWeight: 600, marginTop: '2px' }}>
          {data.percentage.toFixed(1)}% of Total
        </div>
      </div>
    );
  }
  return null;
};

/*
 * The Examination screen.
 *
 * Served by GET /api/admin/examination: one page of students with their exam
 * standing, plus the institute-wide headline, the grade distribution and the
 * per-programme aggregates — all counted in SQL.
 *
 * Everything below used to be reduced over an in-memory copy of every student.
 * That made the numbers depend on what happened to be loaded, and it is why the
 * grade distribution and the average score had to carry the long list of
 * caveats that used to sit here. The server now answers each of them directly:
 *
 *   - the average score is over students with a graded sitting, so a student
 *     who has not sat an exam is absent from it rather than averaged in as 0%;
 *   - the pass rate is over students with a PUBLISHED result, so "not assessed
 *     yet" is not counted as a failure;
 *   - the grade buckets are the letters the institute's own `grades` table
 *     defines, so no student falls outside the chart.
 */
// Presentation-only, derived rather than shipped with every student row.
const AVATAR_COLOURS = [
  '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
  '#0891B2', '#EA580C', '#4F46E5', '#BE123C', '#0D9488', '#9333EA',
];
const initialsOf = (name) =>
  String(name || 'S').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase();
const avatarBgOf = (id) => AVATAR_COLOURS[(Number(id) || 0) % AVATAR_COLOURS.length];

export const ExaminationView = () => {
  const { viewStudentProfile } = useAuth();

  const { params, filters, setFilter, setPage } = useListParams({
    q: '',
    program_id: '',
    limit: 10,
  });

  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.examination(p),
    params, { key: 'examination', debounceMs: 300 });

  const [filterGrade, setFilterGrade] = useState('all');

  const searchTerm = filters.q;
  const setSearchTerm = (value) => setFilter('q', value);

  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 10 };
  const summary = data?.summary ?? {};
  const rows = data?.rows ?? [];

  const totalStudents = pagination.total;
  const avgScore = summary.averageScore ?? null;
  const passRate = summary.passRate ?? null;
  const passCount = summary.passed ?? 0;
  const failCount = summary.failed ?? 0;
  const distinctionCount = summary.distinction ?? 0;
  const distinctionRate = summary.distinctionRate ?? null;
  const gradedCount = summary.scored ?? 0;
  // The pass rate's real denominator: students holding a published result.
  const withCgpaCount = summary.withCgpa ?? 0;

  // The chart's buckets and counts come from the server, ordered by grade
  // point; only the colour is chosen here.
  const gradeDistributionData = useMemo(() => {
    const bands = data?.gradeDistribution ?? [];
    const graded = bands.reduce((sum, b) => sum + b.students, 0);
    return bands.map((b) => ({
      grade: b.grade,
      count: b.students,
      percentage: graded ? (b.students / graded) * 100 : 0,
      fill: GRADE_COLORS[b.grade] || '#94A3B8',
    }));
  }, [data]);

  /*
   * `byProgram.avgScore` is an average CGPA, not a percentage.
   *
   * The SQL behind it is ROUND(AVG(newest.cgpa), 2) over each programme's most
   * recent results — a number on the 0–4 scale. This table rendered it as
   * `${avgScore}%`, so BBA Honors' 2.96 CGPA was displayed as "2.96%", coloured
   * red by a threshold meant for percentages, and given a progress bar 2.96%
   * wide. Every programme looked catastrophic.
   *
   * Kept as the CGPA it is, on a 4.00 scale, and named accordingly.
   */
  const MAX_GPA = 4;
  const programPerformanceData = (data?.byProgram ?? []).map((p) => ({
    program: p.program,
    avgCgpa: p.avgScore == null ? null : Number(p.avgScore),
    passRate: p.passRate == null ? null : Number(p.passRate),
    students: p.students,
  }));

  // A GPA scale, not a percentage one: 2.5 is the pass threshold this screen
  // reports against, so the bands are set around it rather than around 70/80.
  const getGpaColor = (gpa) => {
    if (gpa == null) return '#94A3B8';
    if (gpa >= 3.0) return '#059669';
    if (gpa >= PASS_GPA) return '#D97706';
    return '#DC2626';
  };

  // The grade filter narrows the page on screen. Grade is a derived figure
  // rather than a stored column, so filtering it server-side would mean
  // recomputing every student's exam aggregate to answer one dropdown.
  const paginatedStudents = useMemo(
    () => (filterGrade === 'all' ? rows : rows.filter((st) => st.examGrade === filterGrade)),
    [rows, filterGrade],
  );

  /*
   * The grades this institute actually awards, read from the `grades` table
   * via the API and ordered highest-first.
   *
   * These were previously driven by a hardcoded twelve-band ladder (A+, A-,
   * B+, B-, C+, …) that this institute does not use: its `grades` table defines
   * five bands, A/B/C/D/F. The dropdown and the legend therefore offered seven
   * grades no student can hold, each filtering to an empty table.
   */
  const gradeLetters = useMemo(
    () => (data?.gradingScale ?? []).map((g) => g.grade_letter),
    [data],
  );

  /*
   * The grading ladder keyed by letter, so a band's real percentage range can
   * be shown instead of the reader inferring it. Straight from the `grades`
   * table — five bands here, not the twelve this file's colour map allows for.
   */
  const gradeBands = useMemo(() => {
    const map = new Map();
    for (const g of data?.gradingScale ?? []) {
      map.set(g.grade_letter, {
        min: Number(g.min_percentage),
        max: Number(g.max_percentage),
        points: Number(g.grade_point),
      });
    }
    return map;
  }, [data]);

  // Exams on record, newest first. The API has always sent these and the
  // screen has never drawn them.
  const recentExams = data?.recentExams ?? [];

  // The programme filter: `program_id` is already in the request params, but
  // no control ever set it, so the filter existed only in the URL.
  const programOptions = data?.options?.programs ?? [];
  const selectedProgram = filters.program_id;
  const setSelectedProgram = (value) => setFilter('program_id', value);

  const filteredStudents = paginatedStudents;

  // How many students the grade chart is actually drawn over — students with a
  // graded sitting, which is not the same as every student in the filter.
  const gradedInChart = gradeDistributionData.reduce((sum, d) => sum + d.count, 0);

  // The "+x% vs Previous Semester" line was measured against a hardcoded 71.
  // No previous-semester aggregate is loaded here, so nothing is claimed.

  /*
   * The first load owns the whole screen.
   *
   * `summary` defaults to {}, and every tile below coalesces its missing figure
   * to 0 — so before the first response this page reported 0 students, 0
   * passed, 0 with distinction and an empty grade chart. Those read as an
   * institute where nobody has sat an exam, not as a page still loading.
   *
   * Refetches keep the current rows and dim the pagination control instead.
   */
  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading examination…"
        hint="Exam standing, grade distribution and per-programme results"
      />
    );
  }

  return (
    <div className="tab-transition" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Examination Center
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            Academic Management / <span style={{ color: '#94A3B8' }}>Examination & Grade Center</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Programme, filtered by the SERVER — unlike the grade dropdown
              beside it, which narrows the loaded page only. `program_id` was
              already being sent on every request; nothing ever set it. */}
          <select
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#334155',
              backgroundColor: '#FFFFFF',
              outline: 'none',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <option value="">All Programs</option>
            {programOptions.map((p) => (
              <option key={p.program_id} value={p.program_id}>{p.program_name}</option>
            ))}
          </select>

          <select
            value={filterGrade}
            onChange={(e) => setFilterGrade(e.target.value)}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#334155',
              backgroundColor: '#FFFFFF',
              outline: 'none',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <option value="all">All Grades</option>
            {gradeLetters.map(g => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
        {/* Average Score */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Institute Avg. Score
            </span>
            <h3 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#0F172A', lineHeight: 1.1, marginTop: '4px' }}>
              {avgScore === null ? '\u2014' : `${avgScore.toFixed(1)}%`}
            </h3>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginTop: '6px' }}>
              Across {gradedCount.toLocaleString()} students with graded exams
            </div>
          </div>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '14px',
            backgroundColor: '#EFF6FF',
            color: '#2563EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <GraduationCap size={28} />
          </div>
        </div>

        {/* Pass Rate */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pass Rate (CGPA ≥2.5)
            </span>
            <h3 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#059669', lineHeight: 1.1, marginTop: '4px' }}>
              {passRate === null ? '—' : `${passRate.toFixed(1)}%`}
            </h3>
            {/* The rate's denominator is students WITH a published CGPA; this
                caption used `pagination.total`, every student in the filter.
                Two denominators, one tile — "68.7%" beside "1,373 of 2,014"
                does not divide out. */}
            <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, marginTop: '6px', display: 'block' }}>
              {passCount.toLocaleString()} of {withCgpaCount.toLocaleString()} students with a result
            </span>
          </div>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '14px',
            backgroundColor: '#ECFDF5',
            color: '#10B981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Award size={26} />
          </div>
        </div>

        {/* Distinction Rate */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Distinction (≥ 80%)
            </span>
            <h3 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#059669', lineHeight: 1.1, marginTop: '4px' }}>
              {distinctionRate === null ? '\u2014' : `${distinctionRate.toFixed(1)}%`}
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, marginTop: '6px', display: 'block' }}>
              {distinctionCount} of {gradedCount.toLocaleString()} students with graded exams
            </span>
          </div>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '14px',
            backgroundColor: '#FFFBEB',
            color: '#D97706',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <TrendingUp size={26} />
          </div>
        </div>

        {/* Fail Count */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #FCA5A5',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(220,38,38,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Failed Students (CGPA &lt;2.5)
            </span>
            <h3 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#DC2626', lineHeight: 1.1, marginTop: '4px' }}>
              {failCount.toLocaleString()} Students
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 700, marginTop: '6px', display: 'block' }}>
              {withCgpaCount > 0
                ? `${((failCount / withCgpaCount) * 100).toFixed(1)}% of students with a result`
                : 'No published results yet'}
            </span>
          </div>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '14px',
            backgroundColor: '#FEF2F2',
            color: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <AlertTriangle size={28} />
          </div>
        </div>
      </div>

      {/* Charts + Program Performance side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.25rem', alignItems: 'start' }}>

      {/* Grade Distribution Bar Chart */}
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '20px',
        border: '1px solid #E2E8F0',
        padding: '1.75rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            {/* The chart counts students with a GRADED SITTING, not every
                student in the filter — it was headed with pagination.total
                (2,014) while the bars summed to 2,000. */}
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
              Grade Distribution — {gradedInChart.toLocaleString()} Graded Students
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
              Bar height = student count · Label on top = share of graded students
              {totalStudents > gradedInChart &&
                ` · ${(totalStudents - gradedInChart).toLocaleString()} not yet assessed`}
            </p>
          </div>
          {/* getGradeColor(), not a bare GRADE_COLORS lookup: a band the
              institute adds to its `grades` table would otherwise get an
              undefined colour and render as an invisible swatch. Each chip
              carries the band's real percentage range from the database. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {gradeLetters.map(g => {
              const band = gradeBands.get(g);
              return (
                <div
                  key={g}
                  title={band ? `${g}: ${band.min}–${band.max}% · ${band.points.toFixed(2)} grade points` : g}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', fontWeight: 700 }}
                >
                  <span style={{ width: '10px', height: '10px', backgroundColor: getGradeColor(g), borderRadius: '3px' }} />
                  <span style={{ color: '#334155' }}>{g}</span>
                  {band && <span style={{ color: '#94A3B8', fontWeight: 600 }}>{band.min}–{band.max}%</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ width: '100%', height: '280px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={gradeDistributionData} margin={{ top: 24, right: 10, left: 0, bottom: 5 }} barCategoryGap="20%" barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="grade"
                tick={{ fontSize: 14, fontWeight: 800, fill: '#0F172A' }}
                axisLine={{ stroke: '#E2E8F0' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F1F5F9' }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={64}>
                {gradeDistributionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
                <LabelList
                  dataKey="percentage"
                  position="top"
                  formatter={(val) => (val == null ? "—" : `${Number(val).toFixed(1)}%`)}
                  style={{ fontSize: '12px', fontWeight: 800, fill: '#0F172A' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', flexWrap: 'wrap', paddingTop: '0.25rem', borderTop: '1px solid #F1F5F9' }}>
          {/* Same colour source as the bars. This row indexed PIE_COLORS by
              the grade's position instead, so grade C's bar was #EAB308 and
              its swatch, an inch below, was #65A30D — one grade, two colours,
              in a single panel. */}
          {gradeDistributionData.filter(d => d.count > 0).map(d => (
            <div key={d.grade} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '10px', height: '10px', backgroundColor: getGradeColor(d.grade), borderRadius: '3px' }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>{d.grade}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748B' }}>
                {d.count.toLocaleString()} · {d.percentage.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Program Performance */}
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '20px',
        border: '1px solid #E2E8F0',
        padding: '1.35rem 1.5rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
            Program Performance Summary
          </h3>
          <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
            Average CGPA (of 4.00) and pass rate by academic program
          </p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#64748B', fontWeight: 700 }}>
                <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.7rem' }}>Program</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.7rem' }}>Students</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.7rem' }}>Avg. CGPA</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.7rem' }}>Pass Rate</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.7rem' }}>Performance</th>
              </tr>
            </thead>
            <tbody>
              {programPerformanceData.map((p, i) => {
                const cgpaColor = getGpaColor(p.avgCgpa);
                const passColor = p.passRate == null ? '#94A3B8' : getScoreColor(p.passRate);
                // The bar measures CGPA against 4.00, not against 100.
                const cgpaFill = p.avgCgpa == null ? 0 : Math.min((p.avgCgpa / MAX_GPA) * 100, 100);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', fontSize: '0.875rem' }}>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: '#0F172A', fontSize: '0.8rem' }}>{p.program}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#475569', fontWeight: 600, fontSize: '0.8rem' }}>{p.students.toLocaleString()}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 800, fontSize: '0.8rem', color: cgpaColor }}>
                      {p.avgCgpa === null ? '\u2014' : p.avgCgpa.toFixed(2)}
                    </td>
                    {/* A programme with no published results returned null and
                        printed "NaN%". */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 800, fontSize: '0.8rem', color: passColor }}>
                      {p.passRate === null ? '\u2014' : `${p.passRate.toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
                        title={p.avgCgpa === null ? 'No published results' : `${p.avgCgpa.toFixed(2)} of 4.00`}>
                        <div style={{ width: '80px', height: '8px', backgroundColor: '#E2E8F0', borderRadius: '9999px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${cgpaFill}%`,
                            height: '100%',
                            backgroundColor: cgpaColor,
                            borderRadius: '9999px',
                            transition: 'width 0.6s ease',
                          }} />
                        </div>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: cgpaColor, display: 'inline-block', flexShrink: 0 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {/*
        Exams on record.

        `recentExams` — fifteen real exams with their subject, type, date, total
        marks and how many marks have been entered against each — has been in
        every response this screen has ever received and was never rendered.
        It is the only place in the admin portal that answers "which exams
        exist, and has anyone marked them yet".
      */}
      {recentExams.length > 0 && (
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '20px',
          border: '1px solid #E2E8F0',
          padding: '1.75rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
              Exams on Record
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
              The {recentExams.length} most recent exams, newest first · marks entered against each
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '0.85rem',
          }}>
            {recentExams.map((ex, i) => {
              const marked = ex.marksEntered > 0;
              return (
                <div
                  key={ex.examId}
                  className="exam-card"
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: '14px',
                    padding: '0.9rem 1rem',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    animationDelay: `${Math.min(i, 12) * 35}ms`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.25 }}>
                      {ex.name}
                    </span>
                    <span style={{
                      backgroundColor: '#EEF2FF', color: '#4338CA',
                      fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.03em',
                      padding: '0.2rem 0.5rem', borderRadius: '6px',
                      textTransform: 'uppercase', flexShrink: 0, whiteSpace: 'nowrap',
                    }}>
                      {ex.type}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 600 }}>
                    {ex.subjectCode ? `${ex.subjectCode} · ${ex.subjectName}` : (ex.subjectName || 'No subject linked')}
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '0.5rem', flexWrap: 'wrap',
                    fontSize: '0.72rem', color: '#64748B', fontWeight: 600,
                    borderTop: '1px solid #F1F5F9', paddingTop: '0.5rem',
                  }}>
                    <span>
                      {ex.date ? new Date(ex.date).toLocaleDateString(undefined, {
                        day: 'numeric', month: 'short', year: 'numeric',
                      }) : 'No date set'}
                    </span>
                    <span>{ex.totalMarks} marks</span>
                  </div>

                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    fontSize: '0.7rem', fontWeight: 800,
                    color: marked ? '#065F46' : '#92400E',
                    backgroundColor: marked ? '#D1FAE5' : '#FEF3C7',
                    padding: '0.22rem 0.6rem', borderRadius: '9999px',
                    alignSelf: 'flex-start',
                  }}>
                    {marked
                      ? `${ex.marksEntered.toLocaleString()} ${ex.marksEntered === 1 ? 'mark' : 'marks'} entered`
                      : 'Not marked yet'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Student Exam Roster */}
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '20px',
        border: '1px solid #E2E8F0',
        padding: '1.75rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
              Student Exam Roster
            </h3>
            {/* Says what the page-local grade filter is actually doing, rather
                than claiming to show "all 2,014 students" while displaying 10. */}
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
              {filterGrade === 'all'
                ? <>Exam standing for {totalStudents.toLocaleString()} students, {pagination.limit} at a time</>
                : <>Grade <strong>{filterGrade}</strong> · {paginatedStudents.length} of the {rows.length} students on this page</>}
            </p>
          </div>

          <FilterField
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search by student name or registration number…"
            style={{ width: '260px' }}
            inputStyle={{ padding: '0.5rem 2.2rem 0.5rem 2.2rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
          />
        </div>

        {/* Summary Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {gradeLetters.map(g => {
            const count = gradeDistributionData.find(d => d.grade === g)?.count ?? 0;
            return (
              <span key={g} style={{
                backgroundColor: filterGrade === g ? getGradeColor(g) : getGradeBg(g),
                color: filterGrade === g ? 'white' : getGradeColor(g),
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '0.3rem 0.75rem',
                borderRadius: '9999px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                border: filterGrade === g ? 'none' : `1px solid ${getGradeColor(g)}33`,
              }}
                onClick={() => setFilterGrade(filterGrade === g ? 'all' : g)}
              >
                {g}: {count}
              </span>
            );
          })}
        </div>

        {/* Paginated Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#64748B', fontWeight: 700 }}>
                <th style={{ padding: '0.85rem 1rem' }}>Reg. No.</th>
                <th style={{ padding: '0.85rem 1rem' }}>Student Name</th>
                <th style={{ padding: '0.85rem 1rem' }}>Program</th>
                <th style={{ padding: '0.85rem 1rem' }}>Semester</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Exam Score</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Grade</th>
                {/* GPA, CGPA and the sitting count arrive on every row and none
                    of them was drawn — the pass/fail pill was computed from a
                    CGPA the reader could not see. */}
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>GPA / CGPA</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Sittings</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Result</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {/* The grade dropdown filters the loaded page only, so it can
                  empty the table while the pager still reports 2,014 students.
                  Saying which of the two is responsible avoids that reading as
                  a broken request. */}
              {paginatedStudents.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.9rem' }}>
                    {filterGrade !== 'all' && rows.length > 0
                      ? <>No student on this page holds grade <strong>{filterGrade}</strong>. The grade filter applies to the {rows.length} loaded rows — try another page.</>
                      : searchTerm
                        ? <>No students match “<strong>{searchTerm}</strong>”.</>
                        : 'No exam standing recorded yet.'}
                  </td>
                </tr>
              )}
              {paginatedStudents.map((st) => {
                // PASS_GPA, the shared threshold, rather than a second hardcoded
                // 2.5 that could drift from the tile above. Null CGPA is "not
                // assessed", never a fail.
                const isFail = st.cgpa != null && Number(st.cgpa) < PASS_GPA;
                const isDistinction = st.examGrade === 'A+' || st.examGrade === 'A';
                const scoreNum = st.examScore == null ? null : Number(st.examScore);

                return (
                  <tr
                    key={st.id}
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      fontSize: '0.875rem',
                      backgroundColor: isFail ? 'rgba(254, 226, 226, 0.18)' : 'transparent',
                      transition: 'background-color 0.15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = isFail ? 'rgba(254, 226, 226, 0.35)' : '#F8FAFC'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isFail ? 'rgba(254, 226, 226, 0.18)' : 'transparent'}
                  >
                    <td style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 600 }}>
                      {st.regNo}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#0F172A', fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <UserAvatar
                          userId={st.userId}
                          name={st.name}
                          initials={initialsOf(st.name)}
                          size={32}
                          bg={avatarBgOf(st.id)}
                        />
                        <span>{st.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#475569', fontSize: '0.82rem' }}>
                      {st.program}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 600, fontSize: '0.82rem' }}>
                      <span style={{
                        backgroundColor: '#F1F5F9', color: '#334155',
                        fontSize: '0.72rem', fontWeight: 700,
                        padding: '0.2rem 0.6rem', borderRadius: '6px',
                      }}>
                        {st.semester}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                        <strong style={{
                          color: isFail ? '#DC2626' : (isDistinction ? '#059669' : '#0F172A'),
                          fontSize: '0.95rem', fontWeight: 900,
                        }}>
                          {scoreNum === null ? '\u2014' : `${scoreNum.toFixed(1)}%`}
                        </strong>
                        <div style={{ width: '50px', height: '6px', backgroundColor: '#E2E8F0', borderRadius: '9999px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${scoreNum === null ? 0 : Math.min(scoreNum, 100)}%`, height: '100%',
                            backgroundColor: isFail ? '#DC2626' : (isDistinction ? '#10B981' : '#D97706'),
                            borderRadius: '9999px',
                          }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <span
                        title={gradeBands.get(st.examGrade)
                          ? `${gradeBands.get(st.examGrade).min}–${gradeBands.get(st.examGrade).max}%`
                          : undefined}
                        style={{
                          backgroundColor: getGradeBg(st.examGrade),
                          color: getGradeColor(st.examGrade),
                          fontSize: '0.85rem', fontWeight: 900,
                          padding: '0.15rem 0.7rem', borderRadius: '8px',
                          display: 'inline-block',
                        }}>
                        {st.examGrade || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontSize: '0.82rem' }}>
                      <span style={{ fontWeight: 800, color: '#0F172A' }}>
                        {st.gpa == null ? '—' : Number(st.gpa).toFixed(2)}
                      </span>
                      <span style={{ color: '#CBD5E1', margin: '0 4px' }}>/</span>
                      <span style={{ fontWeight: 800, color: isFail ? '#DC2626' : '#059669' }}>
                        {st.cgpa == null ? '—' : Number(st.cgpa).toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>
                      {st.examSittings || <span style={{ color: '#CBD5E1' }}>None</span>}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      {/* Published vs Draft matters: an unpublished result is
                          not one the student can see, and it was invisible
                          here. */}
                      <span style={{
                        backgroundColor: st.resultStatus === 'Published' ? '#EFF6FF' : '#F8FAFC',
                        color: st.resultStatus === 'Published' ? '#1D4ED8' : '#94A3B8',
                        border: `1px solid ${st.resultStatus === 'Published' ? '#BFDBFE' : '#E2E8F0'}`,
                        fontSize: '0.68rem', fontWeight: 800,
                        padding: '0.2rem 0.6rem', borderRadius: '6px',
                        display: 'inline-block',
                      }}>
                        {st.resultStatus || 'Not assessed'}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      {/* A student with no CGPA at all was reported as "Failed
                          (CGPA)", because `(st.cgpa || 0) < 2.5` treats absent
                          as zero. Not assessed is not the same as failed. */}
                      <span style={{
                        backgroundColor: st.cgpa == null ? '#F8FAFC' : isFail ? '#FEE2E2' : (isDistinction ? '#D1FAE5' : '#FEF3C7'),
                        color: st.cgpa == null ? '#64748B' : isFail ? '#991B1B' : (isDistinction ? '#065F46' : '#92400E'),
                        fontSize: '0.7rem', fontWeight: 800,
                        padding: '0.25rem 0.75rem', borderRadius: '9999px',
                        display: 'inline-block',
                      }}>
                        {st.cgpa == null ? 'Not assessed' : isFail ? 'Failed (CGPA)' : (isDistinction ? 'Distinction' : 'Passed')}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); viewStudentProfile(st.id); }}
                        style={{
                          backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1',
                          borderRadius: '8px', padding: '0.35rem 0.65rem',
                          fontSize: '0.75rem', fontWeight: 700, color: '#334155',
                          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
                        }}
                        title="View Full Profile"
                      >
                        <Eye size={14} /> Profile
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* One shared control, replacing the variant that drew EVERY page
            number. The grade dropdown narrows the page in the browser, so the
            counts here stay the server's — they describe the query, not the
            rows left after that client-side filter. */}
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          limit={pagination.limit}
          count={paginatedStudents.length}
          onChange={setPage}
          noun="student"
          loading={loading}
        />
      </div>

      {/* Publishing sits at the end of this screen because it is the step that
          follows everything above it: exams are scheduled, marks are entered
          against them, and this is what turns those marks into the GPA and
          CGPA the rest of the portal reads. Until it existed, `results` was a
          table four portals read and nothing could write. */}
      <ResultPublishing />
    </div>
  );
};

export default ExaminationView;
