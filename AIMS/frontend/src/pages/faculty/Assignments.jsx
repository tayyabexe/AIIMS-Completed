import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import {
  FileText,
  Plus,
  Eye,
  Download,
  ClipboardList,
  CheckCircle2,
  Clock4,
  XCircle,
  AlertTriangle,
  GraduationCap,
} from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import DataTable from '../../components/faculty/DataTable.jsx';
import FilterBar, { FilterSelect, FilterInput, FilterDate } from '../../components/faculty/FilterBar.jsx';
import Modal from '../../components/faculty/Modal.jsx';
import { BarChartCard, PieChartCard } from '../../components/faculty/Charts.jsx';
import { useToast } from '../../components/faculty/Toast.jsx';
import { useData } from '../../context/FacultyDataContext.jsx';
import { faculty as facultyApi } from '../../api/endpoints';
import DataGate from '../../components/faculty/DataState.jsx';
import { useAuth } from '../../context/FacultyAuthContext.jsx';
import { useFacultyBadges } from '../../context/FacultyBadgeContext.jsx';
import { gradeFor, fmtDateShort } from '../../utils/helpers.js';
import { exportCSV } from '../../utils/exporters.js';
import './Assignments.css';

const STATUS_STYLES = {
  Active: { tone: 'info', bar: '#2a63c9' },
  Upcoming: { tone: 'neutral', bar: '#9497a0' },
  Grading: { tone: 'warning', bar: '#b6791b' },
  Completed: { tone: 'success', bar: '#1f9d55' },
};

const SUB_STATUS = {
  Graded: 'success',
  Submitted: 'info',
  Late: 'warning',
  'Not Submitted': 'danger',
};

function deriveAssignmentStatus(assignment, submissions) {
  const subs = submissions.filter((s) => s.assignmentId === assignment.id);
  if (!subs.length) return new Date(assignment.due) < new Date() ? 'Active' : 'Upcoming';
  const graded = subs.filter((s) => s.status === 'Graded').length;
  if (graded === subs.length) return 'Completed';
  if (graded > 0) return 'Grading';
  return 'Active';
}

export default function Assignments() {
  const showToast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useData();
  const { can } = useAuth();
  const { acknowledgeAssignments } = useFacultyBadges() || {};

  // Opening this screen is the acknowledgement that clears the sidebar's
  // "new assignments" bubble: it advances the watermark stored against the
  // account, so the count only ever covers what arrived since this visit.
  useEffect(() => {
    if (loading || error) return;
    acknowledgeAssignments?.();
  }, [loading, error, acknowledgeAssignments]);

  const assignments = data?.assignments || [];
  const submissions = data?.submissions || [];
  const subjects = data?.subjects || [];

  const [subject, setSubject] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [tab, setTab] = useState('overview'); // overview | analytics | students

  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [newAssignment, setNewAssignment] = useState({ title: '', subject: 'CS-301', due: '', totalMarks: 50 });
  const online = useOnlineStatus();

  // The half-defined assignment survives a crash or a refresh.
  const assignmentDraft = useDraft('faculty.assignment.new', newAssignment, {
    enabled: createOpen,
    onRestore: setNewAssignment,
    isEmpty: (value) => !value?.title?.trim() && !value?.due,
  });

  // Grading an assignment means entering its marks. An assignment is an
  // exam_type='Assignment' row, so its marks are entered on the Marks screen
  // (which lists assignments alongside the other exams). This jumps straight
  // to that assignment's sheet instead of the old in-memory grading modal,
  // which wrote fabricated per-student "submissions" the database cannot store.
  const openMarksFor = (assignment) => {
    navigate(`/faculty/marks?exam=${assignment.id}`);
  };

  // --- Analytics derived from data -----------------------------------------
  const analytics = useMemo(() => {
    if (!submissions.length) return null;
    const graded = submissions.filter((s) => s.status === 'Graded');
    const marks = graded.map((s) => s.marks);
    const avg = marks.length ? (marks.reduce((a, b) => a + b, 0) / marks.length).toFixed(1) : '—';
    const highest = marks.length ? Math.max(...marks) : '—';
    const lowest = marks.length ? Math.min(...marks) : '—';
    const passed = graded.filter((s) => gradeFor(s.marks, s.totalMarks).label !== 'F').length;
    const passRatio = graded.length ? Math.round((passed / graded.length) * 100) : 0;
    const completion = submissions.length
      ? Math.round((submissions.filter((s) => s.status !== 'Not Submitted').length / submissions.length) * 100)
      : 0;

    const buckets = { 'A+': 0, A: 0, 'B+': 0, B: 0, C: 0, F: 0 };
    graded.forEach((s) => {
      const g = gradeFor(s.marks, s.totalMarks).label;
      if (buckets[g] !== undefined) buckets[g]++;
    });
    const gradeDist = Object.entries(buckets).map(([name, value]) => ({ name, value }));

    const statusCounts = {
      Graded: graded.length,
      Pending: submissions.filter((s) => s.status === 'Submitted').length,
      Late: submissions.filter((s) => s.status === 'Late').length,
      'Not Submitted': submissions.filter((s) => s.status === 'Not Submitted').length,
    };
    const statusData = Object.entries(statusCounts).map(([name, value]) => ({
      name,
      value,
      color: name === 'Graded' ? '#1f9d55' : name === 'Pending' ? '#2a63c9' : name === 'Late' ? '#b6791b' : '#9497a0',
    }));

    return { graded, avg, highest, lowest, passRatio, completion, gradeDist, statusData };
  }, [submissions]);

  const rows = useMemo(() => {
    return assignments      .map((a) => {
        const subs = submissions.filter((s) => s.assignmentId === a.id);
        const graded = subs.filter((s) => s.status === 'Graded');
        const submitted = subs.filter((s) => s.status !== 'Not Submitted');
        const avg = graded.length
          ? (graded.reduce((sum, s) => sum + s.marks, 0) / graded.length).toFixed(1)
          : '—';
        return {
          ...a,
          status: deriveAssignmentStatus(a, submissions),
          submittedCount: submitted.length,
          gradedCount: graded.length,
          totalStudents: subs.length,
          avgMarks: avg,
          subjectTitle: subjects.find((s) => s.code === a.subject)?.title || a.subject,
        };
      })
      .filter((a) => {
        const fromOk = !dueFrom || a.due >= dueFrom;
        const toOk = !dueTo || a.due <= dueTo;
        return fromOk && toOk;
      });
  }, [assignments, submissions, subjects, dueFrom, dueTo]);

  const filtered = useMemo(() => {
    return rows.filter((a) => {
      const subjectOk = subject === 'all' || a.subject === subject;
      const statusOk = status === 'all' || a.status === status;
      const q = query.trim().toLowerCase();
      const queryOk = !q || a.title.toLowerCase().includes(q) || a.subject.toLowerCase().includes(q);
      return subjectOk && statusOk && queryOk;
    });
  }, [rows, subject, status, query]);

  // --- All-students tab -------------------------------------------------------
  // Counts are computed from subject-filtered submissions ONLY (not the status
  // filter), so the status cards always reflect the full filtered set.
  const statusCounts = useMemo(() => {
    const c = { Graded: 0, Submitted: 0, Late: 0, 'Not Submitted': 0 };
    submissions.forEach((s) => {
      const a = assignments.find((x) => x.id === s.assignmentId);
      if (!a) return;
      if (subject !== 'all' && a.subject !== subject) return;
      const q = query.trim().toLowerCase();
      if (q && !s.studentName.toLowerCase().includes(q) && !s.roll.toLowerCase().includes(q)) return;
      c[s.status] = (c[s.status] || 0) + 1;
    });
    return c;
  }, [submissions, assignments, subject, query]);

  const studentRows = useMemo(() => {
    return submissions
      .filter((s) => {
        const a = assignments.find((x) => x.id === s.assignmentId);
        if (!a) return false;
        const subjectOk = subject === 'all' || a.subject === subject;
        const statusOk = status === 'all' || s.status === status;
        const q = query.trim().toLowerCase();
        const queryOk = !q || s.studentName.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q);
        return subjectOk && statusOk && queryOk;
      })
      .map((s) => {
        const a = assignments.find((x) => x.id === s.assignmentId);
        return {
          ...s,
          assignment: a?.title || '—',
          grade: s.marks !== null ? gradeFor(s.marks, s.totalMarks).label : '—',
          gradeTone: s.marks !== null ? gradeFor(s.marks, s.totalMarks).tone : 'neutral',
        };
      });
  }, [submissions, assignments, subject, status, query]);

  const [creatingBusy, setCreatingBusy] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (creatingBusy) return;
    if (!newAssignment.title.trim() || !newAssignment.due.trim()) return;

    // An assignment IS an exam with exam_type='Assignment' — that is the only
    // record the database keeps. This used to push an invented row plus a fake
    // submission per student into in-memory state, which vanished on reload and
    // never reached the server. It now creates the real exam row, so the
    // assignment persists and shows up everywhere the exams table is read
    // (here, the Marks screen, reports).
    const subjectDef = subjects.find((s) => s.code === newAssignment.subject);
    if (!subjectDef?.subjectId) {
      showToast('Pick a subject you teach for this assignment.');
      return;
    }

    setCreatingBusy(true);
    try {
      await facultyApi.createExam({
        exam_name: newAssignment.title.trim(),
        exam_type: 'Assignment',
        subject_id: subjectDef.subjectId,
        exam_date: newAssignment.due,
        total_marks: Number(newAssignment.totalMarks) || 50,
      });
      assignmentDraft.clear();
      setCreateOpen(false);
      setNewAssignment({ title: '', subject: subjects[0]?.code || '', due: '', totalMarks: 50 });
      // Re-read faculty data so the new Assignment-type exam appears from the DB.
      await reload();
      showToast('Assignment created.');
    } catch (err) {
      showToast(err.message || 'Could not create the assignment.');
    } finally {
      setCreatingBusy(false);
    }
  };

  const handleExportStudents = () => {
    const headers = ['Student Name', 'Roll Number', 'Assignment', 'Marks', 'Grade', 'Submission Date', 'Status'];
    const rowsCsv = studentRows.map((s) => [
      s.studentName,
      s.roll,
      s.assignment,
      s.marks ?? '—',
      s.grade,
      s.submittedAt ? fmtDateShort(s.submittedAt) : '—',
      s.status,
    ]);
    exportCSV('assignment_submissions.csv', headers, rowsCsv);
    showToast('Submissions exported to CSV');
  };

  // Assignments come from exams where exam_type='Assignment'. There are none
  // yet, so the empty state below is real — but it must not be shown until the
  // request has actually finished, or it claims "none" while still loading.
  if (loading || error) {
    return (
      <Layout title="Assignments">
        <DataGate loading={loading} error={error} onRetry={reload} label="Loading assignments…" />
      </Layout>
    );
  }

  return (
    <Layout title="Assignments">
      <div className="assign-top-row">
        <div className="assign-heading">
          <h2>Assignments</h2>
          <p>Student submits → teacher reviews → marks only → grade generated automatically</p>
        </div>
        {can('manage_assignments') && (
          <button
            className="btn btn-primary"
            onClick={() => {
              // Default the subject to one the teacher actually teaches, so the
              // create call always has a real subject_id to send.
              const codes = [...new Set(subjects.map((s) => s.code))];
              if (!codes.includes(newAssignment.subject)) {
                setNewAssignment((v) => ({ ...v, subject: codes[0] || '' }));
              }
              setCreateOpen(true);
            }}
            disabled={!subjects.length}
          >
            <Plus size={16} /> Create Assignment
          </button>
        )}
      </div>

      <div className="assign-tabs">
        <button className={`assign-tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>
          <ClipboardList size={15} /> Overview
        </button>
        <button className={`assign-tab${tab === 'analytics' ? ' active' : ''}`} onClick={() => setTab('analytics')}>
          <FileText size={15} /> Analytics
        </button>
        <button className={`assign-tab${tab === 'students' ? ' active' : ''}`} onClick={() => setTab('students')}>
          <GraduationCap size={15} /> All Students
        </button>
      </div>

      <FilterBar
        resetActive={subject !== 'all' || status !== 'all' || !!query || !!dueFrom || !!dueTo}
        onReset={() => { setSubject('all'); setStatus('all'); setQuery(''); setDueFrom(''); setDueTo(''); }}
      >
        <FilterInput label="Search" placeholder="Assignment title or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        <FilterSelect
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          allLabel="All Subjects"
          options={[...new Set(assignments.map((a) => a.subject))]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          allLabel="All Statuses"
          options={Object.keys(STATUS_STYLES)}
        />
        <FilterDate label="Due From" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
        <FilterDate label="Due To" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
      </FilterBar>

      {tab === 'overview' && (
        <DataTable
          columns={[
            { key: 'title', label: 'Assignment', render: (r) => <strong>{r.title}</strong> },
            { key: 'subject', label: 'Subject', render: (r) => <span className="assign-subject-cell">{r.subject}<em>{r.subjectTitle}</em></span> },
            { key: 'due', label: 'Due Date', render: (r) => fmtDateShort(r.due) },
            { key: 'submittedCount', label: 'Submitted', align: 'center', render: (r) => `${r.submittedCount}/${r.totalStudents}` },
            { key: 'gradedCount', label: 'Graded', align: 'center' },
            { key: 'avgMarks', label: 'Avg Marks', align: 'center' },
            {
              key: 'status',
              label: 'Status',
              render: (r) => <span className={`badge badge-${STATUS_STYLES[r.status].tone}`}>{r.status}</span>,
            },
            {
              key: 'actions',
              label: 'Actions',
              sortable: false,
              render: (r) => (
                <div className="assign-actions">
                  <button className="assign-btn" onClick={() => setViewing(r)}><Eye size={13} /> View</button>
                  {can('manage_marks') && (
                    <button className="assign-btn grade" onClick={() => openMarksFor(r)}>Enter Marks</button>
                  )}
                </div>
              ),
            },
          ]}
          rows={filtered}
          rowKey="id"
          searchable={false}
          emptyMessage="No assignments match these filters."
        />
      )}

      {tab === 'analytics' && analytics && (
        <div className="assign-analytics">
          <div className="analytics-stat-grid">
            {[
              { label: 'Total Graded', value: analytics.graded.length, color: '#1f9d55' },
              { label: 'Average Marks', value: analytics.avg, color: '#2a63c9' },
              { label: 'Highest Marks', value: analytics.highest, color: '#7c3aed' },
              { label: 'Lowest Marks', value: analytics.lowest, color: '#d1373f' },
              { label: 'Pass Ratio', value: `${analytics.passRatio}%`, color: '#1f9d55' },
              { label: 'Completion', value: `${analytics.completion}%`, color: '#b6791b' },
            ].map((s) => (
              <div className="analytics-stat" key={s.label}>
                <div className="analytics-stat-value" style={{ color: s.color }}>{s.value}</div>
                <div className="analytics-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="chart-grid">
            <BarChartCard
              title="Grade Distribution"
              subtitle="Student-wise grades across graded submissions"
              data={analytics.gradeDist}
              xKey="name"
              series={[{ key: 'value', name: 'Students', color: '#d1373f' }]}
              height={280}
              formatter={(v) => `${v} students`}
            />
            <PieChartCard
              title="Submission Status"
              subtitle="Pending vs graded vs not submitted"
              data={analytics.statusData}
              height={280}
              formatter={(v) => `${v} submissions`}
            />
          </div>
        </div>
      )}

      {tab === 'students' && (
        <>
          <div className="student-status-cards">
            {[
              { label: 'Completed', value: statusCounts.Graded || 0, icon: CheckCircle2, color: '#1f9d55', key: 'Graded' },
              { label: 'Pending', value: statusCounts.Submitted || 0, icon: Clock4, color: '#2a63c9', key: 'Submitted' },
              { label: 'Not Submitted', value: statusCounts['Not Submitted'] || 0, icon: XCircle, color: '#d1373f', key: 'Not Submitted' },
              { label: 'Late Submitted', value: statusCounts.Late || 0, icon: AlertTriangle, color: '#b6791b', key: 'Late' },
            ].map((c) => (
              <button
                key={c.key}
                className={`student-status-card${status === c.key ? ' active' : ''}`}
                onClick={() => setStatus(status === c.key ? 'all' : c.key)}
              >
                <span className="student-status-icon" style={{ background: `${c.color}1a`, color: c.color }}>
                  <c.icon size={17} />
                </span>
                <div>
                  <div className="student-status-value">{c.value}</div>
                  <div className="student-status-label">{c.label}</div>
                </div>
              </button>
            ))}
          </div>

          <DataTable
            columns={[
              { key: 'studentName', label: 'Student Name', render: (r) => <strong>{r.studentName}</strong> },
              { key: 'roll', label: 'Roll Number' },
              { key: 'assignment', label: 'Assignment', render: (r) => <span style={{ color: 'var(--text-secondary)' }}>{r.assignment}</span> },
              { key: 'marks', label: 'Marks', align: 'center', render: (r) => (r.marks !== null ? `${r.marks}/${r.totalMarks}` : '—') },
              { key: 'grade', label: 'Grade', align: 'center', render: (r) => (r.grade !== '—' ? <span className={`badge badge-${r.gradeTone}`}>{r.grade}</span> : '—') },
              { key: 'submittedAt', label: 'Submission Date', render: (r) => (r.submittedAt ? fmtDateShort(r.submittedAt) : '—') },
              { key: 'status', label: 'Status', render: (r) => <span className={`badge badge-${SUB_STATUS[r.status]}`}>{r.status}</span> },
            ]}
            rows={studentRows}
            rowKey="id"
            searchable={false}
            emptyMessage="No submissions found."
            toolbar={
              <button className="btn btn-outline" onClick={handleExportStudents}>
                <Download size={14} /> Export CSV
              </button>
            }
          />
        </>
      )}

      {createOpen && (
        <Modal title="Create Assignment" subtitle="Add a new assignment for your class" onClose={() => setCreateOpen(false)}>
          <form onSubmit={handleCreate}>
            <DraftNotice draft={assignmentDraft} online={online} />
            <div className="modal-field">
              <label>Assignment Title</label>
              <input
                type="text"
                value={newAssignment.title}
                onChange={(e) => setNewAssignment((v) => ({ ...v, title: e.target.value }))}
                placeholder="e.g. Binary Search Trees Lab"
                required
              />
            </div>
            <div className="modal-row-2">
              <div className="modal-field">
                <label>Subject</label>
                <select
                  value={newAssignment.subject}
                  onChange={(e) => setNewAssignment((v) => ({ ...v, subject: e.target.value }))}
                >
                  {[...new Set(subjects.map((s) => s.code))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="modal-field">
                <label>Total Marks</label>
                <input
                  type="number"
                  min="1"
                  value={newAssignment.totalMarks}
                  onChange={(e) => setNewAssignment((v) => ({ ...v, totalMarks: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-field">
              <label>Due Date</label>
              <input
                type="date"
                value={newAssignment.due}
                onChange={(e) => setNewAssignment((v) => ({ ...v, due: e.target.value }))}
                required
              />
            </div>
            <div className="modal-footer" style={{ padding: 0, border: 'none', marginTop: 4 }}>
              <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creatingBusy}>
                {creatingBusy ? 'Creating…' : 'Create Assignment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal
          title={viewing.title}
          subtitle={`${viewing.subject} · Due: ${fmtDateShort(viewing.due)} · ${viewing.totalStudents} students`}
          onClose={() => setViewing(null)}
          width={720}
        >
          <div className="modal-field">
            <label>Status</label>
            <div>
              <span className={`badge badge-${STATUS_STYLES[viewing.status].tone}`}>{viewing.status}</span>
              <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                {viewing.gradedCount} graded · {viewing.submittedCount} submitted · Avg {viewing.avgMarks}
              </span>
            </div>
          </div>
          <div className="modal-field">
            <label>Description</label>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Students submit through the portal before the due date. The teacher enters marks only;
              the grade is generated automatically and the assignment is marked as graded.
            </p>
          </div>
          <div className="modal-field">
            <label>Class Roster & Submission Status</label>
            <div className="scroll-x">
              <table style={{ width: '100%', minWidth: 460 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 12.5, color: 'var(--text-muted)' }}>Student</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 12.5, color: 'var(--text-muted)' }}>Roll</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 12.5, color: 'var(--text-muted)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 12.5, color: 'var(--text-muted)' }}>Marks</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 12.5, color: 'var(--text-muted)' }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions
                    .filter((s) => s.assignmentId === viewing.id)
                    .map((s) => {
                      const g = s.marks !== null ? gradeFor(s.marks, s.totalMarks) : null;
                      return (
                        <tr key={s.id}>
                          <td style={{ padding: '8px 6px', fontSize: 13.5, fontWeight: 600 }}>{s.studentName}</td>
                          <td style={{ padding: '8px 6px', fontSize: 13.5 }}>{s.roll}</td>
                          <td style={{ padding: '8px 6px' }}>
                            <span className={`badge badge-${SUB_STATUS[s.status]}`}>{s.status}</span>
                          </td>
                          <td style={{ padding: '8px 6px', fontSize: 13.5 }}>{s.marks ?? '—'}</td>
                          <td style={{ padding: '8px 6px' }}>
                            {g ? <span className={`badge badge-${g.tone}`}>{g.label}</span> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

    </Layout>
  );
}
