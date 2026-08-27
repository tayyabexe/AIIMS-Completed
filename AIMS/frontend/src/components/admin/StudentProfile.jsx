import React, { useState } from 'react';
import { 
  User, 
  GraduationCap, 
  Mail, 
  Phone, 
  MapPin, 
  Award, 
  BookOpen, 
  CreditCard,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  CheckCircle2,
  BookMarked,
  ShieldCheck,
  Eye,
  // Still used by the search-results banner and its empty state below; the
  // filter box itself is a FilterField, which draws its own icon.
  Search,
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { studentProfilePath } from '../../pages/admin/adminNav';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import StudentFeeVouchers from './StudentFeeVouchers';
import UserAvatar from '../common/UserAvatar';
import './StudentProfile.css';

/*
 * One student's profile.
 *
 * The student to show comes from the URL (/student-profile/:studentId), so a
 * profile can be linked to, bookmarked, reloaded and opened in a second tab.
 * It used to be picked out of an in-memory array of every student by an id
 * held in context — which meant the profile of student 1,847 was only
 * reachable by scrolling to them, and a refresh always landed back on the
 * first student in the table.
 *
 * The record itself comes from GET /api/admin/students/:id: one student's
 * worth of data, including the email, guardian, documents and per-course marks
 * that are too expensive to load for everybody at once.
 */
/*
 * Avatar initials and colour are presentation, so they are derived here from
 * the name and id rather than being sent by the API. The old bulk loader
 * computed them server-trip-side and shipped them with every one of the 2,013
 * student records.
 */
const AVATAR_COLOURS = [
  '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
  '#0891B2', '#EA580C', '#4F46E5', '#BE123C', '#0D9488', '#9333EA',
];

const initialsOf = (name) =>
  String(name || 'S').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase();

const avatarBgOf = (id) => AVATAR_COLOURS[(Number(id) || 0) % AVATAR_COLOURS.length];

// A figure the database does not hold is a dash, never a zero.
const show = (value, suffix = '') => (value == null || value === '' ? '—' : `${value}${suffix}`);

const FEE_COLOUR = {
  Paid: '#059669',
  Partial: '#D97706',
  Unpaid: '#D97706',
  Overdue: '#DC2626',
};

export const StudentProfile = () => {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const { selectedStudentId, setSelectedStudentId } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  /*
   * The URL wins. The context id remains as a fallback only for the redirect
   * from the retired /student-profile addresses; every live way into this
   * screen now carries the id in the path, because the screen is served at
   * /students/:studentId.
   */
  const activeId = studentId || selectedStudentId;

  const { data, loading, error, refresh } = useAdminPage(
    () => adminApi.student(activeId),
    { id: activeId }, { key: 'student-one', enabled: !!activeId });

  const activeStudent = data?.student ?? {};

  // Searching queries the database rather than filtering a local copy, so it
  // reaches every student and not just the ones already downloaded.
  const isSearching = searchTerm.trim().length > 0;

  const { data: searchData, loading: searching } = useAdminPage(
    (p) => adminApi.students(p),
    { q: searchTerm.trim(), limit: 12 }, { key: 'students', enabled: isSearching, debounceMs: 300 });

  const filteredStudents = searchData?.rows ?? [];

  const openStudent = (id) => {
    setSelectedStudentId(id);
    navigate(studentProfilePath(id));
  };

  /*
   * Prev/next step through the student roster in id order. They used to index
   * into the in-memory array; now each press asks the server for the single
   * neighbouring row, so they work across all 2,000-odd students rather than
   * only the ones that happened to be loaded.
   */
  const stepStudent = async (direction) => {
    if (!activeStudent.id) return;
    try {
      const { rows } = await adminApi.students({
        page: 1,
        limit: 1,
        after: direction === 'next' ? activeStudent.id : undefined,
        before: direction === 'prev' ? activeStudent.id : undefined,
      });
      if (rows.length) openStudent(rows[0].id);
    } catch {
      /* a failed step simply leaves the current student in place */
    }
  };

  const handlePrevStudent = () => stepStudent('prev');
  const handleNextStudent = () => stepStudent('next');

  const renderSearchResults = () => {
    if (!isSearching) return null;

    if (filteredStudents.length === 0) {
      return (
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '3rem 2rem',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
        }}>
          <Search size={40} style={{ color: '#CBD5E1', marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#64748B', margin: '0 0 0.25rem' }}>
            No students found
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0 }}>
            No results match <strong>"{searchTerm}"</strong>. Try a different name or registration number.
          </p>
        </div>
      );
    }

    return (
      <>
        {/* Results count banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
          padding: '0.75rem 1.25rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Search size={16} color="#64748B" />
            <span style={{ fontSize: '0.85rem', color: '#475569' }}>
              <strong style={{ color: '#0F172A' }}>{filteredStudents.length}</strong> student{filteredStudents.length !== 1 ? 's' : ''} found for 
              <strong style={{ color: '#DC2626' }}> "{searchTerm}"</strong>
            </span>
          </div>
          <button
            onClick={() => setSearchTerm('')}
            style={{
              background: '#F1F5F9', border: '1px solid #CBD5E1',
              borderRadius: '8px', padding: '0.35rem 0.75rem',
              fontSize: '0.75rem', fontWeight: 700,
              color: '#475569', cursor: 'pointer',
            }}
          >
            Clear Search
          </button>
        </div>

        {/* Search result cards */}
        <div className="sp-search-grid">
          {filteredStudents.map((st) => {
            const isLowAttendance = parseFloat(st.attendance) < 75;
            return (
              <div
                key={st.id}
                onClick={() => {
                  openStudent(st.id);
                  setSearchTerm('');
                }}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '16px',
                  border: '1px solid #E2E8F0',
                  padding: '1.25rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderColor = '#DC2626';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.03)';
                  e.currentTarget.style.borderColor = '#E2E8F0';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {/* Card top: avatar + name + reg no */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <UserAvatar
                    userId={st.userId}
                    name={st.name}
                    initials={initialsOf(st.name)}
                    size={48}
                    bg={avatarBgOf(st.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                      {st.name}
                    </h4>
                    <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '2px 0 0' }}>
                      {st.regNo} · {st.program}
                    </p>
                  </div>
                  <span style={{
                    backgroundColor: st.status === 'Active' ? '#D1FAE5' : '#FEE2E2',
                    color: st.status === 'Active' ? '#065F46' : '#991B1B',
                    fontSize: '0.65rem', fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    whiteSpace: 'nowrap',
                  }}>
                    {st.status}
                  </span>
                </div>

                {/* Info row: semester, batch, attendance, fee */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{
                    backgroundColor: '#F1F5F9', color: '#334155',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '0.2rem 0.6rem', borderRadius: '6px',
                  }}>
                    {st.semester}
                  </span>
                  <span style={{
                    backgroundColor: '#EFF6FF', color: '#1D4ED8',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '0.2rem 0.6rem', borderRadius: '6px',
                  }}>
                    Batch {st.batch}
                  </span>
                  <span style={{
                    backgroundColor: isLowAttendance ? '#FEE2E2' : '#ECFDF5',
                    color: isLowAttendance ? '#991B1B' : '#065F46',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '0.2rem 0.6rem', borderRadius: '6px',
                  }}>
                    Attendance: {st.attendance}
                  </span>
                  <span style={{
                    backgroundColor: st.feeStatus === 'Paid' ? '#D1FAE5' : st.feeStatus === 'Overdue' ? '#FEE2E2' : '#FEF3C7',
                    color: st.feeStatus === 'Paid' ? '#065F46' : st.feeStatus === 'Overdue' ? '#991B1B' : '#92400E',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '0.2rem 0.6rem', borderRadius: '6px',
                  }}>
                    Fee: {st.feeStatus}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{
                  display: 'flex',
                  gap: '1rem',
                  paddingTop: '0.5rem',
                  borderTop: '1px solid #F1F5F9',
                }}>
                  <div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>CGPA</span>
                    <p style={{ fontSize: '1rem', fontWeight: 900, color: '#0F172A', margin: 0 }}>{st.cgpa}</p>
                  </div>
                  {/* MISSING API: there is no bulk per-student exam
                      percentage endpoint. GET /api/marks/student/:id answers it
                      for one student at a time, which this list cannot use, so
                      the figure is shown as unavailable rather than as the
                      `undefined%` / `0%` it used to print for all 2,003 rows. */}
                  <div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>Exam Score</span>
                    <p style={{ fontSize: '1rem', fontWeight: 900, color: '#0F172A', margin: 0 }}>
                      {st.examScore == null ? '—' : `${st.examScore}%`}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>Grade</span>
                    <p style={{ fontSize: '1rem', fontWeight: 900, color: st.examGrade === 'F' ? '#DC2626' : '#059669', margin: 0 }}>{st.examGrade || '—'}</p>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end' }}>
                    <span style={{
                      backgroundColor: '#F1F5F9', color: '#2563EB',
                      fontSize: '0.7rem', fontWeight: 700,
                      padding: '0.3rem 0.7rem', borderRadius: '8px',
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}>
                      <Eye size={12} /> View Profile
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="tab-transition sp-page">
      {/* Top Header Row with Title, Breadcrumbs & Search */}
      <div className="sp-header">
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Student Profile
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            Academic / <span style={{ color: '#94A3B8' }}>Student Profile</span>
          </span>
        </div>

        {/* Search + Navigation Bar.
            Three groups, each a box of its own: the way out, the way to
            another student, and who is open now with the arrows that step off
            them. As one bar they wrapped into a run-on line — the search
            placeholder clipped mid-word and the student's name ended up
            separated from the arrows that move it. */}
        <div className="sp-toolbar">
          <button
            onClick={() => navigate('/students')}
            className="sp-toolbar-group"
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#475569',
              cursor: 'pointer',
              padding: '0.5rem 0.85rem',
            }}
          >
            <ChevronLeft size={15} /> All students
          </button>

          {/* FilterField supplies its own clear affordance, so the hand-rolled
              "Clear" button that used to sit here is gone with it. */}
          <FilterField
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search name or registration number…"
            style={{ width: '260px', maxWidth: '100%' }}
            inputStyle={{
              padding: '0.55rem 2.2rem 0.55rem 2.2rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '0.82rem',
              fontWeight: 500,
              backgroundColor: '#FFFFFF',
            }}
          />

          {!isSearching && (
            <div className="sp-toolbar-group">
              {/* The student currently open.
                  This was a <select> listing every student in the institute,
                  built from the portal-wide array. With that array gone it
                  crashed the page outright ("students is not defined"), and it
                  was the wrong control anyway: a dropdown of 2,000 options is
                  unusable. Use the search box beside it to change student. */}
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, paddingLeft: '2px' }}>
                <strong style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0F172A' }}>
                  {activeStudent?.name || 'No student selected'}
                </strong>
                <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 600 }}>
                  {activeStudent?.regNo || '—'}
                </span>
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  onClick={handlePrevStudent}
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    color: '#475569',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Previous Student"
                >
                  <ChevronLeft size={16} />
                </button>
                {/* "N of 2,013" needed the whole roster in memory to know
                    which position this student was at. The prev/next buttons
                    now step by asking the server for the neighbouring row, so
                    the label states the student's id instead. */}
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', padding: '0 4px', whiteSpace: 'nowrap' }}>
                  ID {activeStudent?.id ?? '—'}
                </span>
                <button
                  onClick={handleNextStudent}
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    color: '#475569',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Next Student"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search Results Grid — appears below search bar when user types */}
      {searching && isSearching && (
        <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0 }}>Searching…</p>
      )}
      {!searching && renderSearchResults()}

      {/* The three states the profile itself can be in. Rendering the layout
          regardless would show a card full of dashes that looks like a student
          with no data, rather than a request still in flight. */}
      {!activeId && (
        <div style={{
          backgroundColor: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0',
          padding: '3rem 2rem', textAlign: 'center',
        }}>
          <User size={40} style={{ color: '#CBD5E1', marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#64748B', margin: '0 0 0.25rem' }}>
            No student selected
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: 0 }}>
            Search above, or pick a student from the{' '}
            <button
              onClick={() => navigate('/students')}
              style={{ background: 'none', border: 'none', color: '#DC2626', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: '0.85rem' }}
            >
              Students list
            </button>.
          </p>
        </div>
      )}

      {activeId && loading && !data && (
        <RouteLoader
          label="Loading student record…"
          hint="Contact details, guardian, fee position, attendance and marks"
        />
      )}

      {activeId && error && (
        <div style={{
          padding: '1rem 1.25rem', borderRadius: '12px',
          backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
        }}>
          <p style={{ fontWeight: 600, margin: 0 }}>Could not load this student</p>
          <p style={{ fontSize: '0.875rem', margin: '4px 0 10px' }}>{error}</p>
          <button
            onClick={refresh}
            style={{
              padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid #FECACA',
              backgroundColor: '#FFFFFF', color: '#991B1B', fontWeight: 600,
              fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Full Student Profile View */}
      {activeStudent.id && (
      <>
      <div className="sp-body">
        {/* Left Column: Personal Information & Guardian Details */}
        <div className="sp-column">
          {/* Main Profile Header Card */}
          <div className="sp-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '1.1rem' }}>
              <UserAvatar
                userId={activeStudent.userId}
                name={activeStudent.name}
                initials={initialsOf(activeStudent.name)}
                size={52}
                bg={avatarBgOf(activeStudent.id)}
                style={{ boxShadow: `0 4px 12px ${avatarBgOf(activeStudent.id)}40`, flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.2 }}>{activeStudent.name}</h3>
                <p style={{ fontSize: '0.78rem', color: '#64748B', fontWeight: 600 }}>
                  {activeStudent.regNo} · {activeStudent.program}
                </p>
                <span style={{
                  backgroundColor: activeStudent.status === 'Active' ? '#D1FAE5' : '#FEE2E2',
                  color: activeStudent.status === 'Active' ? '#065F46' : '#991B1B',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  display: 'inline-block',
                  marginTop: '4px'
                }}>
                  {activeStudent.status} Student
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', paddingTop: '1rem', borderTop: '1px solid #F1F5F9' }}>
              <div className="sp-contact">
                <Mail size={15} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} /> {show(activeStudent.email)}
              </div>
              <div className="sp-contact">
                <Phone size={15} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} /> {show(activeStudent.phone)}
              </div>
              <div className="sp-contact">
                <MapPin size={15} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} /> {show(activeStudent.address)}
              </div>
              <div className="sp-contact">
                <GraduationCap size={15} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} /> {activeStudent.semester || '—'} · Batch {activeStudent.batch || '—'}
              </div>
            </div>
          </div>

          {/* Parent / Guardian Info Card */}
          <div className="sp-card">
            <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserCheck size={17} color="#DC2626" /> Guardian
            </h4>
            <div className="sp-facts">
              <div>
                <span className="sp-fact-label">Name</span>
                <span className="sp-fact-value">{activeStudent.guardianName || '—'}</span>
              </div>
              <div>
                <span className="sp-fact-label">Emergency contact</span>
                <span className="sp-fact-value">{activeStudent.guardianPhone || '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Academic Performance Cards & Enrolled Courses */}
        <div className="sp-column">
          {/* Key Metrics Grid */}
          <div className="sp-metrics">
            {/* CGPA */}
            <div className="sp-metric">
              <div className="sp-metric-icon" style={{ backgroundColor: '#ECFDF5', color: '#059669' }}>
                <Award size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span className="sp-metric-label">Current CGPA</span>
                <h4 className="sp-metric-value">{show(activeStudent.cgpa)} <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94A3B8' }}>/ 4.0</span></h4>
              </div>
            </div>

            {/* Attendance */}
            <div className="sp-metric">
              <div className="sp-metric-icon" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
                <BookOpen size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span className="sp-metric-label">Attendance</span>
                <h4 className="sp-metric-value">{show(activeStudent.attendance)}</h4>
              </div>
            </div>

            {/* Fee Status */}
            <div className="sp-metric">
              <div className="sp-metric-icon" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                <CreditCard size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span className="sp-metric-label">Fee Status</span>
                <h4 className="sp-metric-value" style={{ color: FEE_COLOUR[activeStudent.feeStatus] || '#64748B' }}>
                  {show(activeStudent.feeStatus)}
                </h4>
              </div>
            </div>
          </div>

          {/* Enrolled Courses Table */}
          <div className="sp-card">
            <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BookMarked size={18} color="#DC2626" /> Registered Courses & Performance
            </h4>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#64748B', fontWeight: 700 }}>
                    <th style={{ padding: '0.75rem 0.85rem' }}>Code</th>
                    <th style={{ padding: '0.75rem 0.85rem' }}>Course Name</th>
                    <th style={{ padding: '0.75rem 0.85rem' }}>Credits</th>
                    <th style={{ padding: '0.75rem 0.85rem' }}>Score</th>
                    <th style={{ padding: '0.75rem 0.85rem' }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeStudent.enrolledCourses || []).map((crs, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9', fontSize: '0.85rem' }}>
                      <td style={{ padding: '0.75rem 0.85rem', fontWeight: 700, color: '#334155' }}>
                        {crs.code}
                      </td>
                      <td style={{ padding: '0.75rem 0.85rem', color: '#0F172A', fontWeight: 600 }}>
                        {crs.name}
                      </td>
                      <td style={{ padding: '0.75rem 0.85rem', color: '#64748B' }}>
                        {show(crs.creditHours)} Cr
                      </td>
                      <td style={{ padding: '0.75rem 0.85rem', color: '#2563EB', fontWeight: 700 }}>
                        {crs.score == null ? '—' : crs.score + '%'}
                      </td>
                      <td style={{ padding: '0.75rem 0.85rem' }}>
                        <span style={{
                          backgroundColor: '#ECFDF5',
                          color: '#059669',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px'
                        }}>
                          {show(crs.grade)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Full width, below the two columns: the fee history is a table of
          semesters and instalments and does not fit a 320px column. This is
          also where a voucher is raised, because "which semesters has this
          student already been billed for" is the question you have to answer
          before raising one. */}
      <StudentFeeVouchers
        studentId={activeStudent.id}
        studentName={activeStudent.name}
        programId={activeStudent.programId}
        // So the issue dialog can show the fee structure for the semester the
        // voucher will actually land on before it is raised.
        currentSemesterId={activeStudent.semesterId}
        currentSemesterLabel={activeStudent.semester}
      />
      </>
      )}
    </div>
  );
};

export default StudentProfile;
