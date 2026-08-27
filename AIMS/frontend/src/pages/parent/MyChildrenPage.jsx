/*
 * /parent/my-children — the ward list.
 *
 * Lifted verbatim out of ParentDashboard.jsx, which was one route holding
 * eight screens in a `parentTab` useState. The markup is unchanged; what
 * changed is that it is now reachable by address, so a link can name it and a
 * reload stays on it.
 *
 * "View full dashboard" used to call two setters that were in scope because
 * everything was one component. It navigates now, and it carries the child it
 * was pressed on through in the query string — which is the point of the
 * split: the dashboard opens showing THAT child, not the first one.
 */

import { useNavigate } from 'react-router-dom';
import UserAvatar from '../../components/common/UserAvatar';
import { formatMoney } from '../../utils/currency';
import { useParentPortal, withChild } from './ParentPortalContext';
import { PARENT_HOME } from './parentNav';
import {
  RED, MUTED, FAINT, OK, WARN, BAD, sectionStyle,
} from './parentTheme';
import { Users } from 'lucide-react';

export default function MyChildrenPage() {
  const navigate = useNavigate();
  const { myChildren, selectedChild } = useParentPortal();

  if (myChildren.length === 0) {
    return (
      <div style={{ ...sectionStyle, padding: '3rem', textAlign: 'center' }}>
        <Users size={48} color="#CBD5E1" />
        <p style={{ fontSize: '1rem', color: FAINT, marginTop: '1rem' }}>
          No children assigned to your account
        </p>
      </div>
    );
  }

  return (
    <>
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif", margin: '0 0 0.25rem' }}>
            My Children
          </h2>
          <p style={{ fontSize: '0.85rem', color: MUTED, margin: 0 }}>
            {myChildren.length} ward{myChildren.length > 1 ? 's' : ''} enrolled ·
            {' '}Attendance, grades and fees at a glance
          </p>
        </div>

        {/*
         * One card per child, each a summary of that child's own record.
         *
         * Everything here is nullable and everything here says so. The
         * card previously ran `child.cgpa || 0`, which turned "no result
         * published" into a CGPA of 0.00 and painted the card with the
         * red failing stripe — a child whose first semester simply has
         * not been graded was presented to their parent as failing.
         */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
          {myChildren.map((child) => {
            const isViewing = child.id === selectedChild?.id;

            const att = child.attendancePercent ?? null;
            const childCgpa = Number.isFinite(child.cgpa) ? child.cgpa : null;
            const childGpa = Number.isFinite(child.gpa) ? child.gpa : null;
            const childExam = child.examScore ?? null;
            const childCourses = child.enrolledCourses ?? [];

            const attColor = att === null ? MUTED : att < 75 ? BAD : OK;
            const cgpaColor = childCgpa === null ? MUTED
              : childCgpa >= 3.5 ? OK
              : childCgpa >= 2.5 ? '#0F172A' : BAD;
            const feeColor = !child.feeStatus ? MUTED
              : child.feeStatus === 'Paid' ? OK
              : child.feeStatus === 'Overdue' ? BAD : WARN;

            // Graded courses only: an ungraded subject is not a zero.
            const gradedCourses = childCourses.filter((c) => c.score !== null);

            return (
              <div
                key={child.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '16px',
                  border: isViewing ? `1px solid ${RED}` : '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  overflow: 'hidden',
                  transition: 'box-shadow 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.07)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
              >
                <div style={{ padding: '1.15rem 1.25rem' }}>
                  {/* Identity */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.9rem' }}>
                    <UserAvatar
                      userId={child.userId}
                      hasPhoto={child.hasPhoto}
                      version={child.avatarVersion}
                      name={child.name}
                      initials={child.initials}
                      bg={child.avatarBg || RED}
                      size={42}
                      shape="rounded"
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                        {child.name}
                      </h3>
                      <p style={{ fontSize: '0.76rem', color: MUTED, margin: '2px 0 0' }}>
                        {child.regNo}
                        {child.status && (
                          <>
                            {' · '}
                            <span style={{ color: child.status === 'Active' ? OK : WARN, fontWeight: 600 }}>
                              {child.status}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {isViewing && (
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 600, color: RED,
                        backgroundColor: '#FEF2F2', padding: '3px 9px', borderRadius: '20px',
                      }}>
                        Viewing
                      </span>
                    )}
                  </div>

                  {/* Placement.
                      This was one dot-separated run — "BS Computer
                      Science · Batch BSCS-2022 · Section CS-4A ·
                      Semester 4 · Active" — which gives the reader no
                      way to find a single field. Labelled pairs let the
                      eye go straight to the one it wants. */}
                  <dl style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr',
                    gap: '0.3rem 0.85rem', margin: '0 0 1rem',
                    fontSize: '0.78rem', alignItems: 'baseline',
                  }}>
                    {[
                      ['Program', child.program],
                      ['Batch', child.batch],
                      ['Section', child.section],
                      ['Semester', child.semester],
                    ]
                      .filter(([, value]) => value && value !== '—')
                      .map(([label, value]) => (
                        <div key={label} style={{ display: 'contents' }}>
                          <dt style={{ color: FAINT, whiteSpace: 'nowrap' }}>{label}</dt>
                          <dd style={{ color: '#334155', margin: 0, fontWeight: 500 }}>{value}</dd>
                        </div>
                      ))}
                  </dl>

                  {/* The four figures a parent actually checks */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '1px', backgroundColor: '#E2E8F0',
                    border: '1px solid #E2E8F0', borderRadius: '10px',
                    overflow: 'hidden', marginBottom: '0.9rem',
                  }}>
                    <div style={{ backgroundColor: '#FFFFFF', padding: '0.7rem 0.85rem' }}>
                      <p style={{ fontSize: '0.72rem', color: MUTED, margin: 0 }}>Attendance</p>
                      <p style={{ fontSize: '1.05rem', fontWeight: 700, color: attColor, margin: '2px 0 0', fontFamily: "'Outfit', sans-serif" }}>
                        {att === null ? '—' : `${att}%`}
                      </p>
                      <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '1px 0 0' }}>
                        {child.totalClasses
                          ? `${child.presentDays} of ${child.totalClasses} classes`
                          : 'Not marked yet'}
                      </p>
                    </div>

                    <div style={{ backgroundColor: '#FFFFFF', padding: '0.7rem 0.85rem' }}>
                      <p style={{ fontSize: '0.72rem', color: MUTED, margin: 0 }}>CGPA</p>
                      <p style={{ fontSize: '1.05rem', fontWeight: 700, color: cgpaColor, margin: '2px 0 0', fontFamily: "'Outfit', sans-serif" }}>
                        {childCgpa === null ? '—' : childCgpa.toFixed(2)}
                      </p>
                      <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '1px 0 0' }}>
                        {childCgpa === null
                          ? 'No result published'
                          : `Out of ${Number(child.maxCgpa || 4).toFixed(1)}${childGpa !== null ? ` · GPA ${childGpa.toFixed(2)}` : ''}`}
                      </p>
                    </div>

                    <div style={{ backgroundColor: '#FFFFFF', padding: '0.7rem 0.85rem' }}>
                      <p style={{ fontSize: '0.72rem', color: MUTED, margin: 0 }}>Exam average</p>
                      <p style={{
                        fontSize: '1.05rem', fontWeight: 700, margin: '2px 0 0',
                        fontFamily: "'Outfit', sans-serif",
                        color: childExam === null ? MUTED
                          : childExam >= 80 ? OK
                          : childExam >= 40 ? WARN : BAD,
                      }}>
                        {childExam === null ? '—' : `${childExam}%`}
                        {child.examGrade && (
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: MUTED, marginLeft: '6px' }}>
                            {child.examGrade}
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '1px 0 0' }}>
                        {gradedCourses.length
                          ? `${gradedCourses.length} of ${childCourses.length} course${childCourses.length > 1 ? 's' : ''} graded`
                          : 'No marks graded yet'}
                      </p>
                    </div>

                    <div style={{ backgroundColor: '#FFFFFF', padding: '0.7rem 0.85rem' }}>
                      <p style={{ fontSize: '0.72rem', color: MUTED, margin: 0 }}>Fee status</p>
                      <p style={{ fontSize: '1.05rem', fontWeight: 700, color: feeColor, margin: '2px 0 0', fontFamily: "'Outfit', sans-serif" }}>
                        {child.feeStatus || '—'}
                      </p>
                      <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '1px 0 0' }}>
                        {!child.feeStatus ? 'No fee issued'
                          : child.feeStatus === 'Paid' ? 'Cleared in full'
                          : `${formatMoney(child.remainingBalance)} outstanding`}
                      </p>
                    </div>
                  </div>

                  {/* Per-subject grades. The single most useful thing on
                      this screen, and it had no source until the roster
                      endpoint was wired in. Capped so the card stays a
                      summary; the full table is on the dashboard. */}
                  {gradedCourses.length > 0 && (
                    <div style={{ marginBottom: '0.9rem' }}>
                      <p style={{ fontSize: '0.72rem', color: MUTED, fontWeight: 600, margin: '0 0 0.5rem' }}>
                        Recent grades
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {gradedCourses.slice(0, 3).map((course) => (
                          <div
                            key={course.id ?? `${course.subjectId}-${course.semesterId}`}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: '10px', padding: '0.4rem 0.6rem',
                              backgroundColor: '#F8FAFC', borderRadius: '7px',
                            }}
                          >
                            <span style={{
                              fontSize: '0.76rem', color: '#0F172A', minWidth: 0,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              <span style={{ color: MUTED, fontWeight: 600 }}>{course.code}</span>
                              {'  '}{course.name}
                            </span>
                            <span style={{
                              fontSize: '0.76rem', fontWeight: 600, flexShrink: 0,
                              color: course.score >= 80 ? OK : course.score >= 40 ? WARN : BAD,
                            }}>
                              {course.score}% {course.grade && `· ${course.grade}`}
                            </span>
                          </div>
                        ))}
                      </div>
                      {gradedCourses.length > 3 && (
                        <p style={{ fontSize: '0.7rem', color: '#94A3B8', margin: '5px 0 0' }}>
                          +{gradedCourses.length - 3} more
                        </p>
                      )}
                    </div>
                  )}

                  {/* Opens the dashboard already scoped to THIS child.
                      It used to call two setters that happened to be in
                      scope; carrying the child in the address instead is
                      what makes the destination survive a reload. */}
                  <button
                    onClick={() => navigate(withChild(PARENT_HOME, child.id))}
                    style={{
                      width: '100%', padding: '0.55rem', borderRadius: '9px',
                      border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
                      color: RED, fontWeight: 600, fontSize: '0.82rem',
                      cursor: 'pointer', transition: 'background-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
                  >
                    View full dashboard
                  </button>
                </div>
              </div>
            );
          })}
        </div>
    </>
  );
}
