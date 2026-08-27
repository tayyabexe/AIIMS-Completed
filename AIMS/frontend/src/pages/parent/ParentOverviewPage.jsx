/*
 * /parent/dashboard — the family overview.
 *
 * Lifted verbatim out of ParentDashboard.jsx when the portal was split into a
 * route per module. The markup is unchanged.
 *
 * The per-child figures it reads — attendance, fee status, CGPA, exam score —
 * now come from `childFigures()` in parentTheme.js rather than from constants
 * declared beside them in the old single component. That is not tidying: each
 * of those four had a null-handling bug (a child with no attendance record was
 * told they were "on track", a child with no fee record was told they owed
 * money), and the fixes live in one function now so a second screen reading
 * the same fields cannot reintroduce them.
 */

import UserAvatar from '../../components/common/UserAvatar';
import { formatMoney } from '../../utils/currency';
import { useParentPortal } from './ParentPortalContext';
import {
  RED, MUTED, OK, WARN, BAD, INK, sectionStyle,
  tileStyle, tileLabelStyle, tileValueStyle, tileNoteStyle,
  panelHeaderStyle, panelTitleStyle, childFigures,
} from './parentTheme';
// Shared with the Results page, so the dashboard and the screen it links to
// cannot describe the same assessment in two different ways.
import {
  allAssessments, countStates, formatMarks, gradeTone,
} from './assessments';
import { User } from 'lucide-react';

export default function ParentOverviewPage() {
  const { user, myChildren, selectedChild } = useParentPortal();

  const {
    attendanceVal, hasAttendance, attendanceColor,
    feeStatus, hasFee, feeDue,
    cgpa, hasCgpa,
    examScore, hasExamScore, gradeColor,
    courses,
  } = childFigures(selectedChild);

  // How much of this child's term has been marked, across every course. Used
  // in the courses card's header so the count is visible before the table is
  // read row by row.
  const termStates = countStates(allAssessments(courses));

  if (myChildren.length === 0) {
    return (
      <div style={{ ...sectionStyle, padding: '3rem', textAlign: 'center' }}>
        <User size={48} color="#CBD5E1" />
        <p style={{ fontSize: '1rem', color: '#94A3B8', marginTop: '1rem' }}>
          No children assigned to your account
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Page heading. The full-bleed red gradient panel that stood
          here carried one number — the ward count — behind a 900-weight
          headline and a blurred backdrop. The count now sits inline. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap',
        marginBottom: '1.5rem',
      }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif", margin: '0 0 0.25rem' }}>
            Welcome, {user?.name || 'Parent'}
          </h1>
          <p style={{ fontSize: '0.85rem', color: MUTED, margin: 0 }}>
            {myChildren.length} ward{myChildren.length > 1 ? 's' : ''} enrolled ·
            {' '}Academic progress, attendance and fee status
          </p>
        </div>
      </div>

      {/* Which child this page is reporting on.
          Read-only: the picker is the "My Children" list in the
          sidebar, which governs every tab rather than just this one. */}
      {selectedChild && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '0.85rem 1.1rem', marginBottom: '1.25rem',
          backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
          borderRadius: '12px', flexWrap: 'wrap',
        }}>
          <UserAvatar
            userId={selectedChild.userId}
            hasPhoto={selectedChild.hasPhoto}
            version={selectedChild.avatarVersion}
            name={selectedChild.name}
            initials={selectedChild.initials}
            bg={selectedChild.avatarBg || RED}
            size={38}
            shape="rounded"
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
              {selectedChild.name}
            </p>
            <p style={{ fontSize: '0.78rem', color: MUTED, margin: '2px 0 0' }}>
              {[selectedChild.regNo, selectedChild.program, selectedChild.section, selectedChild.semester]
                .filter((v) => v && v !== '—')
                .join(' · ')}
            </p>
          </div>
          {selectedChild.status && (
            <span style={{
              fontSize: '0.72rem', fontWeight: 600, padding: '3px 10px',
              borderRadius: '20px', backgroundColor: '#F1F5F9', color: MUTED,
            }}>
              {selectedChild.status}
            </span>
          )}
        </div>
      )}

      {/* Headline metrics for the selected child.
          Four figures on one line each: label, value, one qualifier.
          Each renders an em dash and a neutral note when its source
          row does not exist, rather than asserting a default. */}
      {selectedChild && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.85rem', marginBottom: '0.85rem' }}>
          {[
            {
              key: 'attendance',
              label: 'Attendance',
              value: hasAttendance ? `${attendanceVal}%` : '—',
              note: !hasAttendance ? 'No classes marked'
                : attendanceVal < 75 ? 'Below 75% requirement'
                  : 'Meets 75% requirement',
              color: attendanceColor,
            },
            {
              key: 'cgpa',
              label: 'CGPA',
              value: hasCgpa ? cgpa.toFixed(2) : '—',
              note: hasCgpa
                ? `Out of ${Number(selectedChild.maxCgpa).toFixed(1)}`
                : 'No result published',
              color: MUTED,
            },
            {
              key: 'exam',
              label: 'Exam average',
              value: hasExamScore ? `${examScore}%` : '—',
              suffix: hasExamScore ? selectedChild.examGrade : null,
              note: !hasExamScore ? 'No marks graded'
                : examScore >= 80 ? 'Excellent'
                  : examScore >= 60 ? 'Good'
                    : examScore >= 40 ? 'Needs improvement' : 'At risk',
              color: gradeColor,
            },
            {
              key: 'fee',
              label: 'Fee status',
              value: hasFee ? feeStatus : '—',
              note: !hasFee ? 'No fee issued'
                : selectedChild.feeAdvance > 0 ? `${formatMoney(selectedChild.feeAdvance)} in credit`
                  : feeStatus === 'Paid' ? 'Cleared in full'
                    : feeStatus === 'Overdue' ? 'Past due date'
                      : `${formatMoney(selectedChild.feeOutstanding)} outstanding`,
              color: !hasFee ? MUTED
                : feeStatus === 'Overdue' ? BAD : feeDue ? WARN : OK,
            },
          ].map((tile) => (
            <div key={tile.key} className="stat-card" style={tileStyle}>
              <p style={tileLabelStyle}>{tile.label}</p>
              <p style={tileValueStyle}>
                {tile.value}
                {tile.suffix && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: MUTED, marginLeft: '7px' }}>
                    {tile.suffix}
                  </span>
                )}
              </p>
              <p style={{ ...tileNoteStyle, color: tile.color }}>{tile.note}</p>
            </div>
          ))}
        </div>
      )}

      {/* Breakdowns. These carry what the tiles above cannot: the
          attendance denominators and the fee ledger.

          `alignItems: start` matters — the grid used to stretch both
          panels to the taller one's height, which left a band of empty
          white below the attendance bar whenever the fee ledger had
          more rows than the attendance panel had content. */}
      {selectedChild && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'start', gap: '0.85rem', marginBottom: '0.85rem',
        }}>
          {/* Attendance breakdown */}
          <div style={sectionStyle}>
            <div style={{ ...panelHeaderStyle }}>
              <h3 style={panelTitleStyle}>Attendance</h3>
              <span style={{ fontSize: '0.76rem', fontWeight: 600, color: attendanceColor }}>
                {!hasAttendance ? 'Not recorded' : `${attendanceVal}%`}
              </span>
            </div>
            <div style={{ padding: '0.85rem 1.1rem 1rem' }}>
              {hasAttendance ? (
                <>
                  <div style={{ height: '6px', backgroundColor: '#F1F5F9', borderRadius: '3px', overflow: 'hidden', marginBottom: '0.7rem' }}>
                    <div style={{
                      height: '100%', borderRadius: '3px',
                      backgroundColor: attendanceColor,
                      width: `${Math.min(attendanceVal, 100)}%`,
                    }} />
                  </div>
                  {/* Denominators inline rather than as three big
                      centred numerals — same information, a third of
                      the vertical space. */}
                  <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                    <span style={{ color: MUTED }}>
                      Present <strong style={{ color: INK, fontWeight: 600 }}>{selectedChild.presentDays}</strong>
                    </span>
                    <span style={{ color: MUTED }}>
                      Absent <strong style={{ color: INK, fontWeight: 600 }}>{selectedChild.absentDays}</strong>
                    </span>
                    <span style={{ color: MUTED }}>
                      Held <strong style={{ color: INK, fontWeight: 600 }}>{selectedChild.totalClasses}</strong>
                    </span>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: '0.83rem', color: MUTED, margin: 0 }}>
                  No attendance has been marked for this child yet.
                </p>
              )}
            </div>
          </div>

          {/* Fee ledger */}
          <div style={sectionStyle}>
            <div style={{ ...panelHeaderStyle }}>
              <h3 style={panelTitleStyle}>Fee details</h3>
              {hasFee && (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 600, padding: '2px 9px', borderRadius: '20px',
                  backgroundColor: feeStatus === 'Paid' ? '#ECFDF5' : feeStatus === 'Overdue' ? '#FEE2E2' : '#FEF3C7',
                  color: selectedChild.feeColor,
                }}>
                  {feeStatus}
                </span>
              )}
            </div>
            <div style={{ padding: '0.4rem 1.1rem 0.75rem' }}>
              {hasFee ? (
                // Hairline-separated rows rather than four filled grey
                // pills: the pills were mostly padding, and stacked
                // they made this the tallest thing on the page.
                <div>
                  {[
                    ['Total payable', formatMoney(selectedChild.feeBilled ?? selectedChild.feeAmount), INK],
                    ['Paid', formatMoney(selectedChild.feePaid ?? selectedChild.paidAmount), INK],
                    selectedChild.feeAdvance > 0
                      // Paid beyond what has been billed. Shown as
                      // credit, not as a negative outstanding.
                      ? ['Advance balance', formatMoney(selectedChild.feeAdvance), OK]
                      : ['Outstanding', formatMoney(selectedChild.feeOutstanding ?? selectedChild.remainingBalance),
                        (selectedChild.feeOutstanding ?? selectedChild.remainingBalance) > 0 ? BAD : OK],
                    ['Due date', selectedChild.dueDate || '—', feeStatus === 'Overdue' ? BAD : INK],
                  ].map(([label, value, color], i) => (
                    <div
                      key={label}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        padding: '0.45rem 0', gap: '1rem',
                        borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                      }}
                    >
                      <span style={{ fontSize: '0.8rem', color: MUTED }}>{label}</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color }}>{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.83rem', color: MUTED, margin: '0.45rem 0' }}>
                  No fee has been issued to this child yet.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Registered courses, with what each one has actually been assessed on.
          Fed by GET /api/enrollments/student/:id for the roster and
          GET /api/marks/student/:id/assessments for the sittings. The table
          used to end at Score and Grade, so a child sitting at 60% looked
          identical whether that came from one quiz or from a full term's
          work — and a course whose assessments were all still unmarked was
          indistinguishable from one that had none set. The trailing column
          says which, in the same words the Results page uses. */}
      {selectedChild && (
        <div style={sectionStyle}>
          <div style={panelHeaderStyle}>
            <h3 style={panelTitleStyle}>
              Registered courses
            </h3>
            <span style={{ fontSize: '0.76rem', color: MUTED }}>
              {courses.length
                ? `${courses.length} course${courses.length > 1 ? 's' : ''}`
                  + (termStates.graded + termStates.pending + termStates.scheduled
                    ? ` · ${termStates.graded} of `
                      + `${termStates.graded + termStates.pending + termStates.scheduled}`
                      + ' assessments marked'
                    : '')
                : 'None'}
            </span>
          </div>

          {courses.length === 0 ? (
            <div style={{ padding: '1.75rem 1.25rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.85rem', color: MUTED, margin: 0 }}>
                {selectedChild.name} is not registered for any courses yet.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Code</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Course</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'center', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Credits</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'center', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Semester</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'right', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Marks</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'center', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Score</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'center', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Grade</th>
                    <th style={{ padding: '0.7rem 1.25rem', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: '0.76rem' }}>Assessments</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => {
                    // A course with no graded sitting is shown as
                    // ungraded, not as a zero.
                    const scored = course.score !== null && course.score !== undefined;
                    const scoreColor = !scored ? MUTED
                      : course.score >= 80 ? OK
                      : course.score >= 40 ? WARN : BAD;

                    // What the score above is made of, and what is still to
                    // come. `graded` is the only part the score can reflect.
                    const state = countStates(course.assessments);
                    const set = state.graded + state.pending + state.scheduled;

                    return (
                      <tr
                        key={course.id ?? `${course.subjectId}-${course.semesterId}`}
                        style={{ borderBottom: '1px solid #F1F5F9' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FAFAFA'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <td style={{ padding: '0.7rem 1.25rem', color: MUTED, fontWeight: 600 }}>{course.code}</td>
                        <td style={{ padding: '0.7rem 1.25rem', color: '#0F172A' }}>{course.name}</td>
                        <td style={{ padding: '0.7rem 1.25rem', textAlign: 'center', color: MUTED }}>
                          {course.credits ?? '—'}
                        </td>
                        <td style={{ padding: '0.7rem 1.25rem', textAlign: 'center', color: MUTED }}>
                          {course.semesterNumber ?? '—'}
                        </td>
                        {/* The denominator behind the percentage. "60%" is the
                            figure a parent reads; "42 / 70" is the one they
                            ask for next. */}
                        <td style={{
                          padding: '0.7rem 1.25rem', textAlign: 'right', color: MUTED,
                          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                        }}>
                          {scored && course.assessedTotal > 0
                            ? `${formatMarks(course.assessedObtained)} / ${course.assessedTotal}`
                            : '—'}
                        </td>
                        <td style={{ padding: '0.7rem 1.25rem', textAlign: 'center', fontWeight: 600, color: scoreColor }}>
                          {scored ? `${course.score}%` : '—'}
                        </td>
                        <td style={{ padding: '0.7rem 1.25rem', textAlign: 'center', fontWeight: 600, color: gradeTone(course.grade) }}>
                          {course.grade || '—'}
                        </td>
                        {/* Not a repeat of the score: this says how much of the
                            course that score covers. */}
                        <td style={{ padding: '0.7rem 1.25rem', color: MUTED, whiteSpace: 'nowrap' }}>
                          {set === 0 ? 'None set yet' : (
                            <>
                              <span style={{ color: INK, fontWeight: 600 }}>
                                {state.graded}/{set}
                              </span>
                              {' marked'}
                              {state.pending
                                ? <span style={{ color: WARN }}>{` · ${state.pending} pending`}</span>
                                : null}
                              {state.scheduled ? ` · ${state.scheduled} upcoming` : null}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
