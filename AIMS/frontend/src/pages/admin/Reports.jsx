import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, DollarSign, FileText, TrendingUp, Users, BrainCircuit,
  Download, Clock
} from 'lucide-react';
import { formatMoneyCompact } from '../../utils/currency';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { LIVE } from '../../api/queryClient';
import RouteLoader from '../../components/common/RouteLoader';
import {
  generateAttendanceReport,
  generateFeeReport,
  generateExamReport,
  generateEnrollmentReport,
  generateFacultyReport,
  generateAIAnalyticsReport,
} from '../../utils/pdfGenerator';

function parseAttendance(val) {
  if (typeof val === 'string') return parseFloat(val.replace('%', '')) || 0;
  return parseFloat(val) || 0;
}

/*
 * The Reports screen.
 *
 * The headline figures come from GET /api/admin/reports, which is aggregates
 * only — no student row crosses the wire, because this screen never lists an
 * individual student. It previously reduced over an in-memory copy of all
 * 2,013 of them.
 *
 * The report BODIES still need per-student rows, so each generator fetches them
 * from /api/admin/students/export when its button is pressed. That is the right
 * trade: a report is an explicit, occasional action, and the rows it needs are
 * fetched then rather than on every sign-in for everyone.
 */
export default function Reports() {
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const { data, loading, error, refresh } = useAdminPage(
    () => adminApi.reports(),
    // Institute-wide aggregates: the slower analytics beat.
    {}, { key: 'admin-reports', live: LIVE.analytics });

  /*
   * Faculty for the performance report, with each teacher's real weekly load.
   *
   * This used to come from a hardcoded `faculty` array whose headline figure
   * was an invented "average rating" out of 5. There is no rating anywhere in
   * aims_db; what the database does record is teaching load, so that is what
   * the report shows. The three-request client-side join it replaced (teachers
   * + workload summary + departments) is now one SQL statement.
   */
  const { data: facultyData } = useAdminPage(
    () => adminApi.teachers({ limit: 200 }),
    {}, { key: 'teachers-all', live: LIVE.analytics });

  const faculty = (facultyData?.rows ?? []).map((t) => ({
    id: t.teacherId,
    name: t.name,
    department: t.department,
    designation: t.designation,
    subjects: t.subjectCount,
    sections: t.sectionCount,
    weeklyHours: t.weeklyContactHours,
  }));

  // Average weekly teaching hours across faculty who have a recorded load.
  const withLoad = faculty.filter((f) => f.weeklyHours != null && f.weeklyHours > 0);
  const avgWeeklyHours = withLoad.length
    ? (withLoad.reduce((s, f) => s + f.weeklyHours, 0) / withLoad.length).toFixed(1)
    : null;

  const enrolment = data?.enrolment ?? {};
  const feeTotals = data?.fees ?? {};
  const attendanceTotals = data?.attendance ?? {};
  const academics = data?.academics ?? {};

  const totalStudents = enrolment.total ?? 0;
  const activeStudents = enrolment.active ?? 0;
  const avgAtt = attendanceTotals.average == null ? '—' : attendanceTotals.average.toFixed(1);
  const attendanceAtRisk = attendanceTotals.belowThreshold ?? 0;

  const totalCollected = feeTotals.collected ?? 0;
  const totalOutstanding = feeTotals.outstanding ?? 0;

  const avgCgpa = academics.averageCgpa == null ? null : academics.averageCgpa.toFixed(2);
  const passRate = academics.passRate == null ? '—' : academics.passRate.toFixed(1);

  /*
   * "At risk" here means attendance below the 75% requirement. The previous
   * version also folded in overdue fees and a low CGPA, but it counted each
   * student once across all three — a figure this endpoint does not return,
   * and one the AI Analytics screen already reports properly. Claiming a
   * combined number the server has not computed would be inventing it.
   */
  const atRiskCount = attendanceAtRisk;

  const reportTypes = [
    {
      id: 'attendance',
      label: 'Attendance Report',
      icon: Calendar,
      desc: 'Daily, weekly, monthly attendance by department and student.',
      stats: `${avgAtt}% avg · ${attendanceAtRisk} below 75%`,
      color: '#2563EB',
      bgColor: '#EFF6FF',
      hoverBg: '#DBEAFE',
      generate: (rows) => generateAttendanceReport(rows),
    },
    {
      id: 'fee',
      label: 'Fee Collection Report',
      icon: DollarSign,
      desc: 'Collected, pending, and overdue fee status by department.',
      stats: `${formatMoneyCompact(totalCollected)} collected · ${formatMoneyCompact(totalOutstanding)} outstanding`,
      color: '#059669',
      bgColor: '#ECFDF5',
      hoverBg: '#D1FAE5',
      generate: (rows) => generateFeeReport(rows),
    },
    {
      id: 'exam',
      label: 'Examination Results',
      icon: FileText,
      desc: 'Subject-wise and student-wise result summary.',
      stats: avgCgpa
        ? `${avgCgpa} avg CGPA · ${passRate}% pass`
        : 'No results published yet',
      color: '#7C3AED',
      bgColor: '#F5F3FF',
      hoverBg: '#EDE9FE',
      generate: (rows) => generateExamReport(rows),
    },
    {
      id: 'ai-analytics',
      label: 'AI Performance Report',
      icon: BrainCircuit,
      desc: 'AI-generated insights on student risk, performance trends.',
      stats: `${atRiskCount} below 75% attendance`,
      color: '#BE185D',
      bgColor: '#FDF2F8',
      hoverBg: '#FCE7F3',
      generate: (rows) => generateAIAnalyticsReport(rows),
    },
    {
      id: 'faculty',
      label: 'Faculty Performance',
      icon: Users,
      desc: 'Teaching load by subject, section and weekly contact hours.',
      stats: avgWeeklyHours
        ? `${faculty.length} faculty · avg ${avgWeeklyHours} hrs/week`
        : `${faculty.length} faculty`,
      color: '#0891B2',
      bgColor: '#ECFEFF',
      hoverBg: '#CFFAFE',
      generate: () => generateFacultyReport(faculty), needsStudents: false,
    },
    {
      id: 'enrollment',
      label: 'Enrollment Analytics',
      icon: TrendingUp,
      desc: 'Year-over-year enrollment trends by department and category.',
      stats: `${totalStudents.toLocaleString()} enrolled · ${activeStudents.toLocaleString()} active`,
      color: '#D97706',
      bgColor: '#FFFBEB',
      hoverBg: '#FEF3C7',
      generate: (rows) => generateEnrollmentReport(rows),
    },
  ];

  /*
   * Fetches the rows the chosen report needs, then builds the PDF.
   *
   * The student-backed reports pull from /api/admin/students/export, which is
   * the one deliberately-bulk endpoint in the portal. It runs here, on a click,
   * rather than at sign-in for every admin whether or not they ever open this
   * screen.
   */
  const handleGenerate = async (reportId) => {
    const report = reportTypes.find(r => r.id === reportId);
    if (!report) return;

    setDownloading(reportId);
    setDownloadError(null);

    try {
      if (report.needsStudents === false) {
        report.generate();
      } else {
        const { rows, count } = await adminApi.exportStudents({});
        if (!count) {
          setDownloadError('There are no student records to report on.');
          return;
        }
        report.generate(rows);
      }
    } catch (err) {
      setDownloadError(`Could not generate the report: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  };

  /*
   * The whole screen waits for its first response.
   *
   * Each report card prints a live headline underneath it — "88.2% avg · 140
   * below 75%", "Rs. 41.2M collected". Those are read from `data ?? {}`
   * defaults, so before the response arrived every card advertised 0% average,
   * 0 at risk and Rs. 0 collected. A report card is exactly where a wrong
   * summary figure does the most damage: it is the number someone repeats
   * without opening the report.
   */
  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading reports…"
        hint="Institute-wide attendance, fee, examination and faculty aggregates"
      />
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold" style={{ color: 'var(--text-dark)' }}>
          Generate Report
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--navy-500)' }}>
          Generate and download institute reports as PDF
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {reportTypes.map((type) => {
          const Icon = type.icon;
          const isDownloading = downloading === type.id;

          return (
            <div
              key={type.id}
              className="card-hover"
              style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                border: '1px solid var(--border-light)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }}
            >
              <div style={{ height: '4px', backgroundColor: type.color }} />

              <div style={{ padding: '1.25rem 1.25rem 0.75rem', flex: 1 }}>
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: type.bgColor }}
                  >
                    <Icon size={22} color={type.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-dark)' }}>{type.label}</h3>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--navy-500)' }}>{type.desc}</p>
                    <p className="text-xs mt-1.5 font-semibold" style={{ color: type.color }}>{type.stats}</p>
                  </div>
                </div>
              </div>

              <div style={{
                padding: '0.5rem 1rem 0.85rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '0.75rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                  <Clock size={12} color="var(--navy-400)" style={{ flexShrink: 0 }} />
                  <span className="text-xs" style={{ color: 'var(--navy-500)' }}>{type.stats}</span>
                </div>
                <button
                  onClick={() => handleGenerate(type.id)}
                  disabled={isDownloading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '0.4rem 0.9rem', borderRadius: '8px',
                    border: 'none', cursor: isDownloading ? 'wait' : 'pointer',
                    backgroundColor: isDownloading ? type.bgColor : type.color,
                    color: isDownloading ? type.color : 'white',
                    fontWeight: 700, fontSize: '0.75rem',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxShadow: isDownloading ? 'none' : '0 2px 6px rgba(0,0,0,0.12)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isDownloading) {
                      e.currentTarget.style.backgroundColor = type.hoverBg || type.bgColor;
                      e.currentTarget.style.color = type.color;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isDownloading) {
                      e.currentTarget.style.backgroundColor = type.color;
                      e.currentTarget.style.color = 'white';
                    }
                  }}
                >
                  <Download size={13} className={isDownloading ? 'loader-spin' : ''} />
                  {isDownloading ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .loader-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>
  );
}
