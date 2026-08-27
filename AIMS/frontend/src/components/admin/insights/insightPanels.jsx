/*
 * AI Insights, taken apart.
 *
 * This screen used to be one 525-line component that laid out its own grid in
 * CSS: four stat tiles, two charts, a table and two summary panels, in that
 * order, always. Every figure in it is still computed the same way from the
 * same two endpoints — nothing about the analysis has changed — but each panel
 * is now its own component registered under a key, so the arrangement is data
 * rather than markup.
 *
 * That is what lets a pinned query card land *between* the two charts and push
 * them aside. There is no longer a fixed row for the charts to be in.
 *
 * WHAT DID NOT CHANGE
 * -------------------
 * The honesty rules the previous rewrite established are kept verbatim:
 *
 *   - Nothing here forecasts. The two hardcoded "prediction" series that once
 *     lived on this screen are still gone, and every reason printed beside an
 *     at-risk student is a fact already recorded against them.
 *   - Risk cohorts are counted in SQL across the whole institute; the named
 *     list is the worst 25 and says so.
 *   - A figure the database cannot answer is a dash, never a zero.
 *
 * Every panel takes one `view` object — the derived figures, computed once by
 * AIInsightsView — plus the shell props. None of them fetches anything: eight
 * panels each loading the same endpoint would be eight requests for one
 * screen, and a panel the user removed should not still be costing a query.
 */

import {
  AlertTriangle, TrendingUp, Wallet, GraduationCap,
  Activity, BarChart3, Lightbulb, Sparkles,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import PanelShell from '../pinned/PanelShell';
import { formatMoney, formatMoneyCompact, compactAmount } from '../../../utils/currency';

const Placeholder = ({ text }) => (
  <div style={{
    height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#94A3B8', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center',
  }}>
    {text}
  </div>
);

/* ------------------------------------------------------------ stat tiles -- */

/*
 * The four headline figures.
 *
 * One component, four configurations, because they differ only in which
 * numbers they read — and four near-identical blocks of JSX is four places to
 * fix a spacing bug.
 */
function StatPanel({ spec, view, ...shell }) {
  const stat = spec.read(view);

  return (
    <PanelShell
      {...shell}
      title={spec.label}
      icon={spec.icon}
      iconColor={spec.color}
      bodyStyle={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 0.25rem',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          backgroundColor: spec.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <spec.icon size={20} color={spec.color} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h4 style={{
            fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', margin: 0,
            lineHeight: 1.1,
          }}>
            {stat.value}
          </h4>
          <p style={{
            fontSize: '0.72rem', color: '#94A3B8', margin: '0.2rem 0 0',
            lineHeight: 1.35,
          }}>
            {stat.desc}
          </p>
        </div>
      </div>
    </PanelShell>
  );
}

const STATS = {
  stat_at_risk: {
    label: 'At-Risk Students', icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2',
    read: (v) => ({
      value: v.atRiskTotal.toLocaleString(),
      desc: 'Need immediate intervention',
    }),
  },
  stat_avg_attendance: {
    label: 'Average Attendance', icon: TrendingUp, color: '#059669', bg: '#ECFDF5',
    read: (v) => ({
      value: `${v.avgAttendance.toFixed(1)}%`,
      desc: `${v.shortageCount} below the 75% threshold`,
    }),
  },
  stat_fee_collection: {
    label: 'Fee Collection', icon: Wallet, color: '#6366F1', bg: '#EEF2FF',
    read: (v) => ({
      value: formatMoneyCompact(v.totalFeeCollected),
      desc: `${v.paidCount} paid · ${v.pendingCount} pending · ${v.overdueCount} overdue`,
    }),
  },
  stat_pass_rate: {
    label: 'Pass Rate', icon: GraduationCap, color: '#D97706', bg: '#FFFBEB',
    read: (v) => ({
      value: `${v.passRate.toFixed(1)}%`,
      desc: `${v.distinctionCount} with Distinction · ${v.failedCount} failed`,
    }),
  },
};

/* ---------------------------------------------------------------- charts -- */

function AttendanceBandsPanel({ view, ...shell }) {
  return (
    <PanelShell
      {...shell}
      title="Attendance Distribution"
      subtitle={`Students by attendance band · ${view.attendanceTracked.toLocaleString()} with a record`}
      icon={Activity}
    >
      {view.attendanceBands.length === 0 ? (
        <Placeholder text="No attendance has been recorded yet." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={view.attendanceBands}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="band" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
              formatter={(v) => [`${v} students`]}
            />
            <Bar dataKey="count" fill="#6366F1" radius={[6, 6, 0, 0]} name="Students" maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </PanelShell>
  );
}

function MonthlyCollectionPanel({ view, ...shell }) {
  return (
    <PanelShell
      {...shell}
      title="Monthly Fee Collection"
      subtitle="Payments received, by month"
      icon={BarChart3}
      iconColor="#059669"
    >
      {view.monthlyCollection.length === 0 ? (
        <Placeholder text={view.analyticsLoaded ? 'No payments have been recorded yet.' : 'Loading…'} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={view.monthlyCollection} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={compactAmount} />
            <Tooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
              formatter={(v) => [formatMoney(v)]}
            />
            <Bar dataKey="collected" fill="#059669" radius={[6, 6, 0, 0]} name="Collected" maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </PanelShell>
  );
}

/* ----------------------------------------------------------- at-risk list -- */

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.7rem', fontWeight: 700,
  color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em',
  textAlign: 'left', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, backgroundColor: '#F8FAFC', zIndex: 1,
};

const tdStyle = { padding: '0.6rem 0.75rem', textAlign: 'left', whiteSpace: 'nowrap' };

function AtRiskPanel({ view, ...shell }) {
  /*
   * The whole ranked list, not the top seven.
   *
   * The old fixed layout showed seven because that was the number that fitted
   * the space it had been given. The card's height is now the user's to set,
   * so the cut belongs to the scroll position rather than to a slice — and the
   * server's cap of 25 is the only truncation left, which the subtitle states.
   */
  return (
    <PanelShell
      {...shell}
      title="Students at Risk"
      subtitle={`${view.atRisk.length} of ${view.atRiskTotal.toLocaleString()} flagged, ranked by how many signals they trip`}
      icon={AlertTriangle}
      iconColor="#DC2626"
      bodyStyle={{ padding: 0 }}
    >
      {view.atRisk.length === 0 ? (
        <Placeholder text="No student currently trips any risk signal." />
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <th style={thStyle}>Student</th>
              <th style={thStyle}>Department</th>
              <th style={thStyle}>Semester</th>
              <th style={thStyle}>Risk Factor</th>
              <th style={thStyle}>CGPA</th>
              <th style={thStyle}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {view.atRisk.map((s, i) => (
              <tr key={s.id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 600, color: '#0F172A', fontSize: '0.82rem' }}>{s.name}</span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: '#64748B', fontSize: '0.78rem' }}>{s.dept}</span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: '#64748B', fontSize: '0.78rem' }}>{s.semester}</span>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      width: 56, height: 6, borderRadius: 4,
                      backgroundColor: '#E2E8F0', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        backgroundColor: s.riskFactor >= 80 ? '#DC2626' : s.riskFactor >= 60 ? '#D97706' : '#FBBF24',
                        width: `${s.riskFactor}%`,
                      }} />
                    </div>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700,
                      color: s.riskFactor >= 80 ? '#DC2626' : s.riskFactor >= 60 ? '#D97706' : '#B45309',
                    }}>
                      {s.riskFactor}%
                    </span>
                  </div>
                </td>
                <td style={tdStyle}>
                  {/* The student's real published CGPA, not a forecast. */}
                  <span style={{ color: '#64748B', fontSize: '0.82rem' }}>
                    {s.cgpa != null ? s.cgpa.toFixed(2) : '—'}
                  </span>
                </td>
                <td style={{ ...tdStyle, maxWidth: 240, whiteSpace: 'normal' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>{s.reason}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelShell>
  );
}

/* -------------------------------------------------------- summary panels -- */

/*
 * Each line is a sentence about a count the database returned, and the count
 * is in the sentence. Nothing here was written by a model — the wording is
 * fixed and the numbers are substituted, which is why a recommendation cannot
 * be wrong about the figure it cites.
 */
function RecommendationsPanel({ view, ...shell }) {
  const lines = [
    view.shortageCount > 0
      ? `Set up an intervention programme for ${view.shortageCount} students below 75% attendance`
      : 'Attendance levels are healthy across all students',
    `Schedule parent-teacher meetings for the ${view.atRisk.length} at-risk students identified`,
    `Send fee reminders to ${view.pendingCount + view.overdueCount} students with pending or overdue payments`,
    view.overdueCount > 0
      ? 'Consider flexible payment plans for overdue fee defaulters'
      : 'Fee collection is on track with no overdue amounts',
    view.failedCount > 0
      ? `Deploy remedial classes for the ${view.failedCount} students below the pass mark before finals`
      : 'All students are passing — maintain current academic standards',
  ];

  return (
    <PanelShell
      {...shell}
      title="Recommendations"
      subtitle="Each line cites a figure from this screen"
      icon={Lightbulb}
      iconColor="#D97706"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {lines.map((rec, i) => (
          <div
            key={rec}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.7rem',
              padding: '0.7rem', borderRadius: 12,
              backgroundColor: i % 2 === 0 ? '#FFFBEB' : '#F8FAFC',
              border: `1px solid ${i % 2 === 0 ? '#FEF3C7' : '#F1F5F9'}`,
            }}
          >
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              backgroundColor: i % 2 === 0 ? '#FDE68A' : '#E2E8F0',
              color: i % 2 === 0 ? '#92400E' : '#64748B',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.68rem', fontWeight: 800,
            }}>
              {i + 1}
            </div>
            <p style={{ fontSize: '0.8rem', color: '#0F172A', margin: 0, lineHeight: 1.45 }}>
              {rec}
            </p>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function QuickStatsPanel({ view, ...shell }) {
  const items = [
    { label: 'Total Students', value: view.totalStudents.toLocaleString(), bg: '#EEF2FF', color: '#4338CA' },
    { label: 'Pass Rate', value: `${view.passRate.toFixed(1)}%`, bg: '#ECFDF5', color: '#059669' },
    { label: 'Attendance', value: `${view.avgAttendance.toFixed(1)}%`, bg: '#FEF3C7', color: '#D97706' },
    { label: 'Fee Collected', value: formatMoneyCompact(view.totalFeeCollected), bg: '#F3E8FF', color: '#7C3AED' },
    { label: 'Below pass mark', value: String(view.failedCount), bg: '#FEE2E2', color: '#DC2626' },
    { label: 'Attendance short', value: String(view.shortageCount), bg: '#FFE4E6', color: '#BE123C' },
    { label: 'Distinction', value: String(view.distinctionCount), bg: '#ECFDF5', color: '#059669' },
    { label: 'Fees overdue', value: String(view.overdueCount), bg: '#FEF2F2', color: '#991B1B' },
  ];

  return (
    <PanelShell
      {...shell}
      title="Quick Stats"
      subtitle="Snapshot of key metrics"
      icon={BarChart3}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))',
        gap: '0.6rem',
      }}>
        {items.map((item) => (
          <div key={item.label} style={{
            padding: '0.7rem', borderRadius: 12, backgroundColor: item.bg,
            display: 'flex', flexDirection: 'column', gap: '0.1rem',
          }}>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: item.color }}>
              {item.value}
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 500 }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/*
        * The old version of this strip claimed "Model trained on latest
        * semester data — predictions updated daily". There is no model and
        * there are no predictions: every figure above is a count. The strip
        * now says what is actually true of the numbers beside it.
        */}
      <div style={{
        marginTop: '0.85rem', padding: '0.65rem', borderRadius: 12,
        background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
        color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        <Sparkles size={14} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: '0.74rem', fontWeight: 600, lineHeight: 1.4 }}>
          Counted across every student record at page load — no forecast, no
          estimate.
        </span>
      </div>
    </PanelShell>
  );
}

/*
 * The registry the grid renders through.
 *
 * A key the server knows about but this map does not would render nothing, so
 * these keys and the ones in backend config/dashboardCards.js are one list
 * kept in two files — the shortest coupling available without shipping React
 * component names from the API.
 */
export const INSIGHT_PANELS = {
  ...Object.fromEntries(
    Object.entries(STATS).map(([key, spec]) => [
      key,
      (props) => <StatPanel spec={spec} {...props} />,
    ]),
  ),
  chart_attendance_bands: AttendanceBandsPanel,
  chart_monthly_collection: MonthlyCollectionPanel,
  table_at_risk: AtRiskPanel,
  panel_recommendations: RecommendationsPanel,
  panel_quick_stats: QuickStatsPanel,
};

export default INSIGHT_PANELS;
