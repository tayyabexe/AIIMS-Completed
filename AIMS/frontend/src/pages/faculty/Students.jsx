import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users, UserCheck, AlertTriangle, Download, GraduationCap } from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import DataTable from '../../components/faculty/DataTable.jsx';
import Avatar from '../../components/faculty/Avatar.jsx';
import FilterBar, { FilterSelect, FilterInput } from '../../components/faculty/FilterBar.jsx';
import DataGate from '../../components/faculty/DataState.jsx';
import { useToast } from '../../components/faculty/Toast.jsx';
import { useAuth } from '../../context/FacultyAuthContext.jsx';
import { faculty as facultyApi } from '../../api/endpoints';
import { useServerQuery } from '../../hooks/useAdminPage';
import { exportCSV, exportExcel, exportPDF, EXPORT_FORMATS } from '../../utils/exporters.js';
import './Students.css';

// GET /api/faculty/students — the students in the sections this teacher takes.
// The columns that used to render blank (Program, Department, Email, CGPA) are
// resolved server-side from programs, departments, users and results; the old
// loader left all four null. Search also no longer crashes on a null email.

const attendanceTone = (pct) => {
  if (pct === null || pct === undefined) return 'neutral';
  if (pct >= 85) return 'success';
  if (pct >= 75) return 'info';
  if (pct >= 60) return 'warning';
  return 'danger';
};

export default function Students() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const { can } = useAuth();

  /*
   * The teacher's students, cached under one key. This was a fetch-on-mount
   * into three pieces of local state, re-run on every visit to the screen.
   */
  const {
    data: payload, loading, error, refresh: load,
  } = useServerQuery(() => facultyApi.students(), {}, { key: 'faculty-students' });
  const [exporting, setExporting] = useState('');

  const [section, setSection] = useState('all');
  const [program, setProgram] = useState('all');
  const [semester, setSemester] = useState('all');
  const [department, setDepartment] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState(searchParams.get('q') || '');

  useEffect(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery !== null) setQuery(urlQuery);
  }, [searchParams]);

  const students = payload?.data || [];
  const totals = payload?.totals || {};
  const filters = payload?.filters || {};

  const options = (key) => (filters[key] || []).map((o) => ({
    value: String(o.value),
    label: `${o.value} (${o.count})`,
  }));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    return students.filter((s) => {
      if (section !== 'all' && s.section_name !== section) return false;
      if (program !== 'all' && s.program_name !== program) return false;
      if (department !== 'all' && s.department_name !== department) return false;
      if (status !== 'all' && s.academic_status !== status) return false;
      if (semester !== 'all' && String(s.semester_number) !== semester) return false;
      if (!q) return true;

      // Every field is nullable in the schema, so each is coerced before
      // matching — `s.email.toLowerCase()` used to throw on a student with no
      // linked user account.
      return [s.full_name, s.registration_number, s.email, s.phone]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [students, section, program, department, status, semester, query]);

  const hasActiveFilters = section !== 'all' || program !== 'all' || semester !== 'all'
    || department !== 'all' || status !== 'all' || !!query;

  const resetFilters = () => {
    setSection('all');
    setProgram('all');
    setSemester('all');
    setDepartment('all');
    setStatus('all');
    setQuery('');
    setSearchParams({});
  };

  const handleExport = (format) => {
    setExporting(format);

    const headers = [
      'Roll Number', 'Student Name', 'Program', 'Department', 'Section',
      'Semester', 'Email', 'Phone', 'CGPA', 'Attendance %', 'Marks %', 'Status',
    ];
    const exportRows = rows.map((s) => [
      s.registration_number,
      s.full_name,
      s.program_name || '—',
      s.department_name || '—',
      s.section_name || '—',
      s.semester_number ?? '—',
      s.email || '—',
      s.phone || '—',
      s.cgpa ?? '—',
      s.attendance?.percentage != null ? `${s.attendance.percentage}%` : '—',
      s.marks?.percentage != null ? `${s.marks.percentage}%` : '—',
      s.academic_status || '—',
    ]);

    setTimeout(() => {
      if (format === 'csv') exportCSV('my_students.csv', headers, exportRows);
      if (format === 'xlsx') exportExcel('my_students.xlsx', 'Students', headers, exportRows);
      if (format === 'pdf') {
        exportPDF('my_students.pdf', {
          title: 'My Students',
          subtitle: `${exportRows.length} students · attendance and marks are for this teacher's subjects`,
          headers,
          rows: exportRows,
        });
      }
      setExporting('');
      showToast(`Student list exported as ${format.toUpperCase()}`);
    }, 200);
  };

  if (loading || error) {
    return (
      <Layout title="Students">
        <DataGate loading={loading} error={error} onRetry={load} label="Loading students…" />
      </Layout>
    );
  }

  const statCards = [
    { label: 'Total Students', value: totals.students ?? 0, icon: Users, bg: '#eaf1fd', color: '#2a63c9' },
    { label: 'Active', value: totals.active ?? 0, icon: UserCheck, bg: '#e7f7ee', color: '#1f9d55' },
    {
      label: 'Avg Attendance',
      value: totals.average_attendance != null ? `${totals.average_attendance}%` : '—',
      icon: GraduationCap,
      bg: '#fdf2df',
      color: '#b6791b',
    },
    { label: 'Below 75%', value: totals.at_risk ?? 0, icon: AlertTriangle, bg: '#fdeaea', color: '#d1373f' },
  ];

  return (
    <Layout title="Students">
      <div className="marks-top-row">
        <div className="marks-heading">
          <h2>My Students</h2>
          <p>
            {totals.students ?? 0} students across {totals.sections ?? 0} sections and{' '}
            {totals.subjects ?? 0} subjects — attendance and marks are for your own classes
          </p>
        </div>
        {can('export_reports') && (
          <div className="attendance-export-group">
            {EXPORT_FORMATS.map(({ label, format }) => (
              <button
                key={format}
                className="btn btn-outline"
                disabled={exporting === format || !rows.length}
                onClick={() => handleExport(format)}
              >
                <Download size={14} /> {exporting === format ? 'Exporting…' : `Export ${label}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="students-stat-grid">
        {statCards.map(({ label, value, icon: Icon, bg, color }) => (
          <div className="students-stat-card" key={label}>
            <div className="students-stat-top">
              <span className="students-stat-label" title={label}>{label}</span>
              <span className="students-stat-icon" style={{ background: bg, color }}>
                <Icon size={17} />
              </span>
            </div>
            <span className="students-stat-value" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

      <FilterBar resetActive={hasActiveFilters} onReset={resetFilters}>
        <FilterInput
          label="Search"
          placeholder="Name, roll number, email or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FilterSelect label="Section" value={section} onChange={(e) => setSection(e.target.value)} allLabel="All Sections" options={options('sections')} />
        <FilterSelect label="Program" value={program} onChange={(e) => setProgram(e.target.value)} allLabel="All Programs" options={options('programs')} />
        <FilterSelect label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} allLabel="All Departments" options={options('departments')} />
        <FilterSelect
          label="Semester"
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
          allLabel="All Semesters"
          options={(filters.semesters || []).map((o) => ({
            value: String(o.value),
            label: `Semester ${o.value} (${o.count})`,
          }))}
        />
        <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)} allLabel="All Statuses" options={options('statuses')} />
      </FilterBar>

      <DataTable
        columns={[
          {
            key: 'full_name',
            label: 'Student',
            render: (r) => (
              <div className="student-cell">
                <Avatar name={r.full_name} size={34} userId={r.user_id} />
                <span style={{ fontWeight: 700 }}>{r.full_name}</span>
              </div>
            ),
          },
          { key: 'registration_number', label: 'Roll Number' },
          { key: 'program_name', label: 'Program', render: (r) => r.program_name || '—' },
          { key: 'section_name', label: 'Section', render: (r) => r.section_name || '—' },
          {
            key: 'semester_number',
            label: 'Semester',
            align: 'center',
            render: (r) => (r.semester_number != null ? `Semester ${r.semester_number}` : '—'),
          },
          { key: 'department_name', label: 'Department', render: (r) => r.department_name || '—' },
          {
            key: 'attendance',
            label: 'Attendance',
            align: 'center',
            render: (r) => (r.attendance && r.attendance.percentage !== null ? (
              <span className={`badge badge-${attendanceTone(r.attendance.percentage)}`}>
                {r.attendance.percentage}%
              </span>
            ) : <span style={{ color: '#94A3B8' }}>—</span>),
          },
          {
            key: 'marks',
            label: 'Marks',
            align: 'center',
            render: (r) => (r.marks
              ? `${r.marks.obtained}/${r.marks.total}`
              : <span style={{ color: '#94A3B8' }}>—</span>),
          },
          {
            key: 'cgpa',
            label: 'CGPA',
            align: 'center',
            render: (r) => (r.cgpa != null ? r.cgpa.toFixed(2) : '—'),
          },
          { key: 'email', label: 'Email', render: (r) => r.email || '—' },
          {
            key: 'academic_status',
            label: 'Status',
            render: (r) => <span className="badge badge-neutral">{r.academic_status || '—'}</span>,
          },
        ]}
        rows={rows}
        rowKey={(r) => r.student_id}
        searchable={false}
        emptyMessage={students.length === 0
          ? 'You have no sections assigned, so there are no students to show.'
          : 'No students match these filters.'}
      />

      <div className="students-note">
        Showing {rows.length} of {students.length} students ·{' '}
        <button
          type="button"
          className="link link-btn"
          onClick={() => navigate('/faculty/my-classes')}
        >
          View by class
        </button>
      </div>
    </Layout>
  );
}
