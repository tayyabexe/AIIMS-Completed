import React, { useState, useEffect } from 'react';
import {
  Wallet,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Ban,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RePie, Pie, Cell,
} from 'recharts';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage, useListParams } from '../../hooks/useAdminPage';
import { formatMoney, formatMoneyCompact, compactAmount } from '../../utils/currency';
import Pagination from '../common/Pagination';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import FeePaymentApprovals from './FeePaymentApprovals';
import FeeStructuresView from './FeeStructuresView';
import { ROLES } from '../../api/roles';
import UserAvatar from '../common/UserAvatar';

const PIE_COLORS = ['#6366F1', '#8B5CF6', '#A855F7', '#F43F5E', '#F59E0B', '#10B981'];

/**
 * What a chart shows when it has no bars to draw. Keeps "still loading",
 * "the request failed" and "the database has nothing yet" visibly different,
 * so an empty panel is never mistaken for a broken one.
 */
const ChartPlaceholder = ({ loading, error, emptyMessage }) => (
  <div style={{
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '1rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: error ? '#DC2626' : '#94A3B8',
  }}>
    {loading ? 'Loading…' : error ? `Could not load this chart: ${error}` : emptyMessage}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        backgroundColor: '#0F172A',
        color: 'white',
        padding: '0.6rem 1rem',
        borderRadius: '12px',
        fontSize: '0.78rem',
        boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
        border: 'none',
      }}>
        <strong style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#F8FAFC' }}>
          {label}
        </strong>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color, fontWeight: 700, fontSize: '0.78rem' }}>
            {p.name}: {formatMoney(p.value)}
          </div>
        ))}
        {/* The API sends a payment COUNT alongside each month's total and it
            was never shown, so Rs 2.38m from 107 payments looked the same as
            Rs 2.38m from one. */}
        {payload[0]?.payload?.payments != null && (
          <div style={{ color: '#94A3B8', fontWeight: 600, fontSize: '0.72rem', marginTop: '3px' }}>
            {payload[0].payload.payments.toLocaleString()}{' '}
            {payload[0].payload.payments === 1 ? 'payment' : 'payments'}
          </div>
        )}
      </div>
    );
  }
  return null;
};

/*
 * The Fee Management screen.
 *
 * Served by GET /api/admin/fees: one page of students with their settled fee
 * position, the institute-wide totals, the category distribution and the
 * monthly collection series — all aggregated in SQL.
 *
 * Two corrections come with the move:
 *
 * 1. The totals summed a per-student figure that was itself only ONE of that
 *    student's fee vouchers. Anyone billed across several semesters was
 *    under-reported; student 1 alone holds four vouchers. The API sums them.
 *
 * 2. The monthly collection chart counted every payment row. A payment that a
 *    parent has declared but the accounts office has not verified is not money
 *    collected, so the chart overstated income. It now counts verified
 *    payments only.
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

/*
 * The four statuses GET /api/admin/fees actually emits.
 *
 * This screen used to test `feeStatus === 'Pending'`, a value the API has never
 * returned — the roll-up in getFeesPage yields Paid, Partial, Unpaid or Overdue.
 * Every Unpaid and every Partial row therefore failed both the "paid" and the
 * "pending" test and fell through to the red overdue styling, so 787 students
 * part-way through paying were coloured as if they had defaulted.
 *
 * Keyed off the real values, with a neutral fallback rather than a red one, so a
 * status added server-side shows up as unrecognised instead of as a crisis.
 */
const STATUS_STYLES = {
  Paid: { fg: '#065F46', bg: '#D1FAE5', row: 'transparent', hover: '#F8FAFC' },
  Partial: { fg: '#92400E', bg: '#FEF3C7', row: 'rgba(254, 243, 199, 0.15)', hover: 'rgba(254, 243, 199, 0.3)' },
  Unpaid: { fg: '#9A3412', bg: '#FFEDD5', row: 'rgba(255, 237, 213, 0.2)', hover: 'rgba(255, 237, 213, 0.4)' },
  Overdue: { fg: '#991B1B', bg: '#FEE2E2', row: 'rgba(254, 226, 226, 0.18)', hover: 'rgba(254, 226, 226, 0.32)' },
};
const NO_STATUS = { fg: '#475569', bg: '#F1F5F9', row: 'transparent', hover: '#F8FAFC' };
const statusStyle = (status) => STATUS_STYLES[status] || NO_STATUS;

export const FeeManagementView = () => {
  const { viewStudentProfile, user } = useAuth();

  /*
   * The fee catalogue is guarded by authorize(...ADMINS), which is Super Admin
   * and Admin only — the Accountant reaches this screen but not that endpoint.
   * Hiding the section for them is the menu agreeing with the server, the same
   * principle as ROLE_MODULES in adminNav.js: it grants nothing, it only stops
   * the portal advertising what the server will refuse.
   */
  const canEditFeeCatalogue = [ROLES.SUPER_ADMIN, ROLES.ADMIN]
    .includes(Number(user?.roleId));
  const [searchParams] = useSearchParams();

  // The dashboard's task list links here with ?fee_status=Overdue.
  const { params, filters, setFilter, setPage } = useListParams({
    q: '',
    program_id: '',
    batch_id: '',
    fee_status: searchParams.get('fee_status') || '',
    limit: 10,
  });

  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.fees(p),
    params, { key: 'fees', debounceMs: 300 });

  const searchTerm = filters.q;
  const setSearchTerm = (value) => setFilter('q', value);
  const filterStatus = filters.fee_status;
  const setFilterStatus = (value) => setFilter('fee_status', value);
  const selectedProgram = filters.program_id;
  const setSelectedProgram = (value) => setFilter('program_id', value);
  const selectedBatch = filters.batch_id;
  const setSelectedBatch = (value) => setFilter('batch_id', value);

  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 10 };
  const totals = data?.totals ?? {};
  const options = data?.options ?? { programs: [], batches: [], sections: [] };
  const analyticsError = error;

  const feeDistributionData = data?.distribution ?? [];
  const monthlyCollectionData = data?.monthlyCollection ?? [];

  /*
   * Every figure below describes the SAME cohort as the roster, because the API
   * now applies the search, programme, batch, section and semester filters to
   * the aggregates as well as to the rows.
   *
   * Two different populations still live on this screen and they are not
   * interchangeable: `pagination.total` counts STUDENTS matching the filter,
   * `totals.studentsBilled` counts those who have a fee voucher. 2,003 students
   * hold 2,000 billed positions, so using the first as the denominator of the
   * second reported "827 of 2,014 paid" when it was 827 of 2,000. Each figure
   * below is labelled with the population it belongs to.
   */
  const totalStudents = pagination.total;
  const studentsBilled = totals.studentsBilled ?? 0;
  const totalFeePool = totals.billed ?? 0;
  const totalCollected = totals.collected ?? 0;
  const totalPending = totals.outstanding ?? 0;

  const overdueCount = totals.overdue ?? 0;
  const unpaidCount = totals.unpaid ?? 0;
  const partialCount = totals.partial ?? 0;
  const paidCount = totals.paid ?? 0;

  const collectionRate = totalFeePool > 0
    ? ((totalCollected / totalFeePool) * 100).toFixed(1)
    : '0.0';

  /*
   * Month-on-month, but only between months that are genuinely adjacent.
   *
   * The series carries only the months that saw a verified payment, and this
   * database jumps from Apr 2024 to Jul 2026. Taking the last two entries
   * blindly compared figures 27 months apart and captioned it "Up from last
   * month". If the final two periods are not consecutive, nothing is claimed.
   */
  const lastMonth = monthlyCollectionData[monthlyCollectionData.length - 2];
  const thisMonth = monthlyCollectionData[monthlyCollectionData.length - 1];
  const monthsApart = (a, b) => {
    if (!a?.key || !b?.key) return null;
    const [ay, am] = a.key.split('-').map(Number);
    const [by, bm] = b.key.split('-').map(Number);
    return (by - ay) * 12 + (bm - am);
  };
  const consecutive = monthsApart(lastMonth, thisMonth) === 1;
  const trendUp = consecutive ? thisMonth.collected >= lastMonth.collected : null;

  const scheduleTotal = feeDistributionData.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const totalPayments = monthlyCollectionData.reduce((sum, m) => sum + (m.payments ?? 0), 0);

  // Says which of the cohort filters are narrowing the page, for the captions
  // that would otherwise imply these are institute-wide figures.
  const activeFilterCount = [filters.q, filters.program_id, filters.batch_id, filters.fee_status]
    .filter((v) => v !== '' && v != null).length;
  const scopeCaption = activeFilterCount > 0
    ? 'Filtered cohort'
    : 'Institute-wide';

  const paginatedStudents = data?.rows ?? [];
  const filteredStudents = paginatedStudents;

  /*
   * The whole screen waits, rather than each panel filling in around a set of
   * zeros.
   *
   * Every figure above is read out of `data ?? {}` defaults, so before the
   * first response this page rendered a complete, confident dashboard: Rs. 0
   * collected, a 0.0% collection rate, "0/0 Paid" and an empty roster — with a
   * small "Loading…" caption inside the two charts. Those zeros look exactly
   * like an institute that has collected nothing. A screen that does not know
   * its numbers must not print numbers.
   *
   * Only the FIRST load is caught here. A later refetch — changing a filter,
   * turning a page — keeps the current rows on screen and dims the controls
   * instead, because replacing a populated table with a spinner on every
   * keystroke is its own kind of unusable.
   */
  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading fee management…"
        hint="Collection totals, the roster and the approvals queue"
      />
    );
  }

  return (
    <div className="tab-transition" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Fee Management Center
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            Financial Management / <span style={{ color: '#94A3B8' }}>Fee Overview</span>
          </span>
        </div>

        {/* Which population every figure on this screen describes. The totals
            follow the filters now, so this is the difference between "Rs 187M
            billed across the institute" and "Rs 38M billed in Computer
            Science" — the same tile, two very different claims. */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '0.45rem 0.9rem', borderRadius: '9999px',
          backgroundColor: activeFilterCount > 0 ? '#EEF2FF' : '#F8FAFC',
          border: `1px solid ${activeFilterCount > 0 ? '#C7D2FE' : '#E2E8F0'}`,
          fontSize: '0.75rem', fontWeight: 700,
          color: activeFilterCount > 0 ? '#4338CA' : '#64748B',
        }}>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%',
            backgroundColor: activeFilterCount > 0 ? '#6366F1' : '#94A3B8',
          }} />
          {scopeCaption} · {totalStudents.toLocaleString()} students · {studentsBilled.toLocaleString()} billed
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1.25rem' }}>
        {/* Total Collection */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Total Collection
            </span>
            <h3 style={{ fontSize: '1.65rem', fontWeight: 900, color: '#0F172A', lineHeight: 1.1, marginTop: '4px' }}>
              {formatMoneyCompact(totalCollected)}
            </h3>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#059669', fontSize: '0.75rem', fontWeight: 700, marginTop: '6px' }}>
              <ArrowUpRight size={14} /> {paidCount.toLocaleString()} of {studentsBilled.toLocaleString()} billed students paid
            </div>
          </div>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '14px',
            backgroundColor: '#ECFDF5',
            color: '#10B981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Wallet size={26} />
          </div>
        </div>

        {/* Collection Rate */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Collection Rate
            </span>
            <h3 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#059669', lineHeight: 1.1, marginTop: '4px' }}>
              {collectionRate}%
            </h3>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: trendUp === null ? '#94A3B8' : trendUp ? '#059669' : '#DC2626', fontSize: '0.75rem', fontWeight: 700, marginTop: '6px' }}>
              {trendUp === null
                ? (monthlyCollectionData.length > 1
                  ? `No consecutive months to compare · latest ${thisMonth.label}`
                  : 'No month-on-month history yet')
                : <>{trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{trendUp ? 'Up' : 'Down'} on {lastMonth.label}</>}
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
            justifyContent: 'center'
          }}>
            <TrendingUp size={26} />
          </div>
        </div>

        {/* Pending Amount */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #FCA5A5',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(220,38,38,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pending + Overdue
            </span>
            <h3 style={{ fontSize: '1.65rem', fontWeight: 900, color: '#DC2626', lineHeight: 1.1, marginTop: '4px' }}>
              {formatMoneyCompact(totalPending)}
            </h3>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#DC2626', fontSize: '0.75rem', fontWeight: 700, marginTop: '6px' }}>
              <AlertTriangle size={14} /> {(partialCount + unpaidCount + overdueCount).toLocaleString()} students still owe
            </div>
          </div>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '14px',
            backgroundColor: '#FEF2F2',
            color: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Clock size={26} />
          </div>
        </div>

        {/* Overdue */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #FCA5A5',
          padding: '1.35rem',
          boxShadow: '0 2px 8px rgba(220,38,38,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Overdue Students
            </span>
            <h3 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#DC2626', lineHeight: 1.1, marginTop: '4px' }}>
              {overdueCount} Students
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 700, marginTop: '6px', display: 'block' }}>
              Immediate action required
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
            justifyContent: 'center'
          }}>
            <Ban size={26} />
          </div>
        </div>
      </div>

      {/* Charts Row: Monthly Collection + Fee Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
        {/* Monthly Collection Bar Chart */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '20px',
          border: '1px solid #E2E8F0',
          padding: '1.75rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
                Monthly Collection Overview
              </h3>
              {/* Verified payments only, and only the months that saw one —
                  so this says how many payments the series is built from
                  rather than implying an unbroken monthly run. */}
              <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '2px' }}>
                {totalPayments.toLocaleString()} verified payments across{' '}
                {monthlyCollectionData.length} {monthlyCollectionData.length === 1 ? 'month' : 'months'}
                {monthlyCollectionData.length > 0 && ` · ${monthlyCollectionData[0].label} to ${thisMonth.label}`}
              </p>
            </div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '1.25rem',
              backgroundColor: '#F8FAFC',
              padding: '0.5rem 1rem',
              borderRadius: '10px',
              border: '1px solid #E2E8F0'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#6366F1' }}>
                <span style={{ width: '12px', height: '12px', backgroundColor: '#6366F1', borderRadius: '3px' }} />
                Collected
              </div>
            </div>
          </div>

          <div style={{ height: '260px', width: '100%' }}>
            {monthlyCollectionData.length === 0 ? (
              <ChartPlaceholder
                loading={loading && !data}
                error={analyticsError}
                emptyMessage="No payments have been recorded yet."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCollectionData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94A3B8', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={compactAmount} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="collected" fill="#6366F1" radius={[6, 6, 0, 0]} name="Collected" maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Fee Distribution */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '20px',
          border: '1px solid #E2E8F0',
          padding: '1.75rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem'
        }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
              Published Fee Schedule
            </h3>
            {/* Named for what it is. This is the price list in `fee_structures`
                — what a semester COSTS — not money billed or collected, which
                is why its total does not reconcile with the tiles above. It
                was captioned "fee allocation", which reads like the latter. */}
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '2px' }}>
              What one semester costs by category · {formatMoney(scheduleTotal)} per schedule
              {' '}· not billing or collection
            </p>
          </div>

          {feeDistributionData.length === 0 ? (
            <div style={{ height: '180px' }}>
              <ChartPlaceholder
                loading={loading && !data}
                error={analyticsError}
                emptyMessage="No fee structures have been defined yet."
              />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Donut chart */}
              <div style={{ width: '180px', height: '180px', flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RePie>
                    <Pie
                      data={feeDistributionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={3}
                      dataKey="amount"
                    >
                      {feeDistributionData.map((entry, i) => (
                        <Cell key={entry.category} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [formatMoney(v)]} />
                  </RePie>
                </ResponsiveContainer>
              </div>

              {/* Legend + progress bars */}
              <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {feeDistributionData.map((item, i) => (
                  <div key={item.category}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {item.category}
                      </div>
                      {/* The Rs figure was fetched and thrown away, leaving a
                          percentage of an undisclosed total. */}
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A' }}>
                          {formatMoney(item.amount)}
                        </span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8' }}>
                          {item.percentage.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: '#F1F5F9', borderRadius: '9999px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${item.percentage}%`,
                        height: '100%',
                        backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                        borderRadius: '9999px',
                        transition: 'width 0.6s ease'
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Student Fee Roster Table */}
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '20px',
        border: '1px solid #E2E8F0',
        padding: '1.75rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
              Student Fee Roster
            </h3>
            {/* `filterStatus` defaults to '' — the old test was `!== 'all'`,
                which is always true, so this line permanently read
                "Filtered by:" followed by nothing. */}
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '2px' }}>
              Showing <strong style={{ color: '#0F172A' }}>{filteredStudents.length}</strong> of {totalStudents.toLocaleString()} students
              {filterStatus && <span> · Filtered by: <strong style={{ color: '#6366F1' }}>{filterStatus}</strong></span>}
            </p>
          </div>

          {/* Filters Row: Batch, Program, Status, Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Select Batch */}
            <select
              value={selectedBatch}
              onChange={(e) => { setSelectedBatch(e.target.value); }}
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#0F172A',
                backgroundColor: '#FFFFFF',
                outline: 'none',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}
            >
              <option value="">All Batches</option>
              {options.batches.map(b => (
                <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>
              ))}
            </select>

            {/* Select Program */}
            <select
              value={selectedProgram}
              onChange={(e) => { setSelectedProgram(e.target.value); }}
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#0F172A',
                backgroundColor: '#FFFFFF',
                outline: 'none',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}
            >
              <option value="">All Programs</option>
              {options.programs.map(p => (
                <option key={p.program_id} value={p.program_id}>{p.program_name}</option>
              ))}
            </select>

            {/* Select Status */}
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); }}
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#0F172A',
                backgroundColor: '#FFFFFF',
                outline: 'none',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}
            >
              <option value="">All Status</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Overdue">Overdue</option>
            </select>

            {/* 200px is the narrowest filter box in the portal, which is
                exactly where a native placeholder loses the most text. */}
            <FilterField
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by student name or registration number…"
              style={{ width: '200px' }}
              inputStyle={{ padding: '0.5rem 2.2rem 0.5rem 2.2rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>
        </div>

        {/* Status Summary Chips.
            All FOUR statuses the API reports, and they add up. The Partial
            bucket was simply missing — 787 students part-way through paying
            appeared in none of the three chips, which is why they summed to
            1,216 of 2,000 and looked like a rounding fault rather than an
            omitted category. Each chip is also a filter now, since the numbers
            invite the click. */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { status: 'Paid', count: paidCount, Icon: CheckCircle2 },
            { status: 'Partial', count: partialCount, Icon: TrendingUp },
            { status: 'Unpaid', count: unpaidCount, Icon: Clock },
            { status: 'Overdue', count: overdueCount, Icon: AlertTriangle },
          ].map(({ status, count, Icon }) => {
            const style = statusStyle(status);
            const active = filterStatus === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setFilterStatus(active ? '' : status)}
                aria-pressed={active}
                title={active ? `Clear the ${status} filter` : `Show only ${status} students`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  backgroundColor: active ? style.fg : style.bg,
                  color: active ? '#FFFFFF' : style.fg,
                  border: active ? 'none' : `1px solid ${style.fg}22`,
                  fontSize: '0.72rem', fontWeight: 700,
                  padding: '0.35rem 0.85rem', borderRadius: '9999px',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                <Icon size={14} /> {count.toLocaleString()} {status}
              </button>
            );
          })}
          <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>
            = {studentsBilled.toLocaleString()} billed students
          </span>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#64748B', fontWeight: 700 }}>
                <th style={{ padding: '0.85rem 1rem' }}>Reg. No.</th>
                <th style={{ padding: '0.85rem 1rem' }}>Student Name</th>
                <th style={{ padding: '0.85rem 1rem' }}>Program</th>
                {/* The API sends `batch` on every row and there is a batch
                    filter in the toolbar, but no column ever showed it — so
                    filtering by batch gave no visible confirmation. */}
                <th style={{ padding: '0.85rem 1rem' }}>Batch</th>
                <th style={{ padding: '0.85rem 1rem' }}>Semester</th>
                <th style={{ padding: '0.85rem 1rem' }}>Billed</th>
                <th style={{ padding: '0.85rem 1rem' }}>Paid</th>
                {/* `remainingBalance` was fetched on every row and discarded,
                    leaving the reader to subtract two columns by eye — on the
                    one screen whose entire purpose is who owes what. */}
                <th style={{ padding: '0.85rem 1rem' }}>Balance Due</th>
                <th style={{ padding: '0.85rem 1rem' }}>Due Date</th>
                <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {/* An empty roster used to render as a bare header with nothing
                  under it, which looks like a failed request. The message
                  names the filters actually responsible. */}
              {paginatedStudents.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.9rem' }}>
                    {activeFilterCount > 0
                      ? <>No students match {filterStatus ? <strong>{filterStatus}</strong> : 'these filters'}
                        {searchTerm && <> for “<strong>{searchTerm}</strong>”</>}. Try widening the filters above.</>
                      : 'No students have been billed yet.'}
                  </td>
                </tr>
              )}
              {paginatedStudents.map((st) => {
                const style = statusStyle(st.feeStatus);
                const isPaid = st.feeStatus === 'Paid';

                return (
                  <tr
                    key={st.id}
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      fontSize: '0.875rem',
                      backgroundColor: style.row,
                      transition: 'background-color 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = style.hover}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = style.row}
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
                      {st.program || <span style={{ color: '#CBD5E1' }}>Not assigned</span>}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#475569', fontSize: '0.82rem', fontWeight: 600 }}>
                      {st.batch || <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 600, fontSize: '0.82rem' }}>
                      <span style={{
                        backgroundColor: '#F1F5F9',
                        color: '#334155',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px'
                      }}>
                        {st.semester || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#0F172A', fontWeight: 700 }}>
                      {formatMoney(st.feeAmount)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: isPaid ? '#059669' : '#0F172A', fontWeight: 700 }}>
                      {formatMoney(st.paidAmount)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: st.remainingBalance > 0 ? style.fg : '#94A3B8' }}>
                      {st.remainingBalance > 0 ? formatMoney(st.remainingBalance) : 'Settled'}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#64748B', fontSize: '0.82rem' }}>
                      {/* A Paid position has no outstanding instalment, so the
                          API sends no due date — "N/A" read as missing data
                          rather than as nothing being owed. */}
                      {st.dueDate || (isPaid ? <span style={{ color: '#94A3B8' }}>Nothing due</span> : <span style={{ color: '#CBD5E1' }}>Not set</span>)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span style={{
                        backgroundColor: style.bg,
                        color: style.fg,
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        display: 'inline-block'
                      }}>
                        {st.feeStatus || 'Not billed'}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          viewStudentProfile(st.id);
                        }}
                        style={{
                          backgroundColor: '#F1F5F9',
                          border: '1px solid #CBD5E1',
                          borderRadius: '8px',
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#334155',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
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
            number — 202 buttons at 10 rows a page over 2,013 students. */}
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

      {/* The approvals queue.
          It sits below the roster because it is the thing a member of the
          accounts office comes to this screen to ACT on, whereas the roster and
          the charts above are what they come to read. Verifying a payment moves
          the totals up there, so it refreshes them. */}
      <FeePaymentApprovals onDecided={refresh} />

      {/* The catalogue behind the numbers above: what a semester of each
          programme costs. It sits last because it is the thing changed least
          often and the thing whose changes reach furthest — every voucher
          issued from here on is billed from it. */}
      {canEditFeeCatalogue && <FeeStructuresView />}
    </div>
  );
};

export default FeeManagementView;
