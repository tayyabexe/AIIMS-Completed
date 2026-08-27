import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import StudentTopBar from '../../components/student/StudentTopBar';
import { useStudentProfile } from '../../context/StudentProfileContext';
import './StudentDashboard.css';
import './MyCourses.css';
import { SkeletonRegion, SkeletonCardGrid } from '../../components/common/Skeleton';

import {
  IconChevronRight, IconGrid, IconBook, IconCalendarCheck, IconTrending,
  IconCard, IconClock, IconFile, IconUser,
} from '../../components/student/icons';

/* Local icon so the sidebar brand icon matches the cap icon used elsewhere */
const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

/*
 * The courses the signed-in student is registered for.
 *
 * This page used to render CourseData.jsx — six invented courses with invented
 * instructors ("Dr. Fatima Malik"), rooms, attendance percentages, marks,
 * grades and a "Course Progress" bar that was a literal number in the file.
 *
 * Sources now:
 *   roster, credit hours, semester -> GET /api/enrollments/student/:id
 *   instructor, room, schedule     -> GET /api/timetables/current
 *   attendance per course          -> GET /api/attendance/student/:id
 *   marks, grade, grade point      -> GET /api/marks/student/:id + /api/results/grades
 *
 * A figure the database does not hold is not drawn: a course with no marks yet
 * shows no grade rather than a placeholder letter.
 */
const MyCourses = () => {
  const { profile, studentData, loading, error } = useStudentProfile();

  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const courses = useMemo(() => studentData?.courses || [], [studentData]);
  const totalCredits = courses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);

  /* The term these courses belong to, named by the enrollment rows themselves
     rather than the fixed "6th Semester — Fall 2024" the page used to print. */
  const semesterLabel = useMemo(() => {
    const labels = [...new Set(courses.map((c) => c.semesterLabel).filter(Boolean))];
    return labels.length === 1 ? labels[0] : (profile.semester !== '—' ? profile.semester : null);
  }, [courses, profile.semester]);

  const subtitle = loading
    ? 'Loading your courses…'
    : [
        semesterLabel,
        `${courses.length} ${courses.length === 1 ? 'Course' : 'Courses'}`,
        totalCredits ? `${totalCredits} Credit Hours` : null,
      ].filter(Boolean).join(' | ');

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses', active: true },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  return (
    <div className="dashboard-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* Sidebar */}
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
              <p className="footer-line">CORVIT Systems © 2024</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* Main wrapper */}
      <div className="main-wrapper">
        {/* Top header (shared: chatbot, notifications, profile) */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">My Courses</span>
        </div>

        {/* Page content */}
        <div className="courses-page">
          <div className="courses-page-header">
            <div>
              <h1 className="courses-title">My Courses</h1>
              <p className="courses-subtitle">{subtitle}</p>
            </div>
            {profile.program !== '—' && (
              <span className="semester-pill">{profile.program}</span>
            )}
          </div>

          {error && <div className="courses-state">Your courses could not be loaded. {error}</div>}

          {!error && loading && courses.length === 0 && (
            <SkeletonRegion label="Loading your courses">
              <SkeletonCardGrid count={6} minWidth={280} lines={2} />
            </SkeletonRegion>
          )}

          {!error && !loading && courses.length === 0 && (
            <div className="courses-state">
              You are not registered for any course yet. Courses appear here once
              your enrollment is recorded.
            </div>
          )}

          <div className="courses-grid">
            {courses.map((course) => {
              const att = course.attendance;
              const result = course.result;

              return (
                <div className="course-card" key={course.enrollmentId ?? course.code}>
                  <div className="course-card-top">
                    <div className="course-card-top-row">
                      <span className="course-code-label">{course.code || '—'}</span>
                      {/* Only a grade the grading scale actually produced. */}
                      {result?.grade && <span className="grade-badge">{result.grade}</span>}
                    </div>
                    <h3 className="course-card-name">{course.title}</h3>
                  </div>

                  <div className="course-card-body">
                    <div className="course-stat-row">
                      <div className="course-stat">
                        <span className="stat-caption">Instructor</span>
                        <span className="stat-value">{course.instructor || '—'}</span>
                      </div>
                      <div className="course-stat">
                        <span className="stat-caption">Credit Hours</span>
                        <span className="stat-value">
                          {course.credits === null ? '—' : `${course.credits} CH`}
                        </span>
                      </div>
                    </div>

                    <div className="course-stat-row">
                      <div className="course-stat">
                        <span className="stat-caption">Attendance</span>
                        <span className={`stat-value ${att?.isLow ? 'low' : 'good'}`}>
                          {att?.pct === null || att?.pct === undefined
                            ? 'Not marked'
                            : `${att.pct}%`}
                        </span>
                      </div>
                      <div className="course-stat">
                        <span className="stat-caption">Marks</span>
                        <span className="stat-value">
                          {result && result.total > 0
                            ? `${Math.round(result.obtained)}/${result.total}`
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* "Course Progress" was a hardcoded percentage. What the
                        data supports is how much of the course's assessment has
                        been graded so far. */}
                    <div className="progress-header">
                      <span className="progress-caption">Assessment Graded</span>
                      <span className="progress-caption">
                        {result?.components?.length
                          ? `${result.components.length} ${result.components.length === 1 ? 'component' : 'components'}`
                          : 'None yet'}
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${result?.percent ?? 0}%` }}
                      ></div>
                    </div>

                    <Link
                      to={`/student/my-courses/${encodeURIComponent(course.code || '')}`}
                      className="view-details-btn"
                    >
                      <IconBook /> View Details <IconChevronRight />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyCourses;