/*
 * One row per registered course, one column per kind of assessment.
 *
 * This is the screen the parent portal was missing. What existed before was a
 * single "Score" column holding the summed percentage of a course, so a parent
 * could see that their child stood at 60% in Programming Fundamentals and had
 * no way at all to see that the 60% was a full-mark quiz, a weak mid-term, and
 * a final that has not been sat yet. Those three facts are the ones a parent
 * can act on; the average of them is the one they cannot.
 *
 * Each cell holds the individual sittings of that type, labelled by the server
 * ("Q1", "Q2", "MT") and stated:
 *
 *   20/20      marked and released
 *   Pending    the sitting has happened; no result has been released
 *   15 Dec     scheduled, not sat yet
 *
 * A course keeps its row whether or not anything in it has been marked, and a
 * scheduled assessment appears the moment a teacher creates it, which is what
 * makes the table answer "what is coming" as well as "what has happened".
 *
 * MARKS THAT CHANGE
 * -----------------
 * Nothing here caches. The rows are rebuilt from the ledger on every load, so a
 * corrected mark appears in the same cell it always occupied, with the new
 * number — there is no separate "revised marks" surface to keep in step, by
 * design. `assessments.js` holds the reading rules, shared with the dashboard.
 */

import {
  ASSESSMENT_COLUMNS, byColumn, readAssessment, gradeTone,
  subjectStanding, formatMarks,
} from './assessments';
import { INK, MUTED, FAINT, BORDER, CANVAS } from './parentTheme';

const th = (align = 'left') => ({
  padding: '0.6rem 0.85rem',
  textAlign: align,
  color: MUTED,
  fontWeight: 600,
  fontSize: '0.72rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
});

const td = (align = 'left') => ({
  padding: '0.7rem 0.85rem',
  textAlign: align,
  verticalAlign: 'top',
  fontSize: '0.84rem',
  color: INK,
});

/** The sittings of one type for one course, stacked in a single cell. */
function AssessmentCell({ items }) {
  if (!items.length) {
    return <span style={{ color: FAINT }}>—</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {items.map((a) => {
        const read = readAssessment(a);
        return (
          <div
            key={a.examId}
            title={read.title}
            style={{
              display: 'flex', alignItems: 'baseline', gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            {/* The label is a fixed width so several sittings in one cell line
                their numbers up rather than stepping right as the labels get
                longer. */}
            <span style={{
              minWidth: '20px', fontSize: '0.7rem', fontWeight: 600,
              color: FAINT, letterSpacing: '0.02em',
            }}>
              {a.label}
            </span>
            <span style={{ color: read.tone, fontWeight: read.tone === INK ? 600 : 500 }}>
              {read.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AssessmentTable({ courses }) {

  const rows = courses || [];

  /*
   * Which columns to draw.
   *
   * The four an institute always runs — coursework, quizzes, and the two
   * papers — are drawn whether or not this child has one, because an empty
   * Assignments column is itself the answer to "has anything been set". The two
   * that many programmes never use are drawn only when a sitting exists, so a
   * course with neither does not pay two dead columns of width for them.
   */
  const columns = ASSESSMENT_COLUMNS.filter((c) => {
    if (c.type !== 'Practical' && c.type !== 'Viva') return true;
    return rows.some((r) => (r.assessments || []).some((a) => a.examType === c.type));
  });

  if (rows.length === 0) {
    return (
      <div style={{ padding: '2rem 1.25rem', textAlign: 'center' }}>
        <p style={{ fontSize: '0.85rem', color: MUTED, margin: 0 }}>
          No registered courses to report on yet.
        </p>
      </div>
    );
  }

  return (
    /*
     * `minWidth: 0` is not decoration.
     *
     * A flex item's default min-width is `auto`, which is its MIN-CONTENT
     * width — and the min-content width of this container is the table's
     * `minWidth` below. Without the override the eight-column table pushes its
     * own scroll container wide, then the column it sits in, then the whole
     * portal layout, and the phone-width page scrolls sideways as a document
     * instead of the table scrolling inside its card. Measured at 390px: 1471px
     * of document before, the viewport's own 390 after.
     */
    <div style={{ overflowX: 'auto', minWidth: 0 }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
        minWidth: `${360 + columns.length * 108 + 150}px`,
      }}>
        <thead>
          <tr style={{ backgroundColor: CANVAS, borderBottom: `1px solid ${BORDER}` }}>
            <th style={th('left')}>Course</th>
            {columns.map((c) => (
              <th key={c.type} style={th('left')}>{c.heading}</th>
            ))}
            <th style={th('right')}>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((course) => {
            const buckets = byColumn(course.assessments);
            const standing = subjectStanding(course);
            const scored = course.score !== null && course.score !== undefined;

            return (
              <tr
                key={course.id ?? `${course.subjectId}-${course.semesterId}`}
                style={{ borderBottom: `1px solid ${BORDER}` }}
              >
                <td style={td('left')}>
                  <div style={{ fontWeight: 600, color: INK }}>{course.name}</div>
                  <div style={{ fontSize: '0.76rem', color: MUTED, marginTop: '2px' }}>
                    {course.code}
                    {course.credits !== null && course.credits !== undefined
                      ? ` · ${course.credits} cr`
                      : ''}
                  </div>
                </td>

                {columns.map((c) => (
                  <td key={c.type} style={td('left')}>
                    <AssessmentCell items={buckets.get(c.type) || []} />
                  </td>
                ))}

                {/* The course's own standing, from the sittings to its left.
                    Obtained and total are printed alongside the percentage
                    because a parent's next question about "60%" is always
                    "out of what". */}
                <td style={td('right')}>
                  <div style={{
                    fontWeight: 600, color: scored ? INK : FAINT,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {scored ? `${course.score}%` : '—'}
                    {course.grade
                      ? (
                        <span style={{ color: gradeTone(course.grade), marginLeft: '8px' }}>
                          {course.grade}
                        </span>
                      )
                      : null}
                  </div>
                  {scored && course.assessedTotal > 0 ? (
                    <div style={{ fontSize: '0.75rem', color: MUTED, marginTop: '2px' }}>
                      {formatMarks(course.assessedObtained)} / {course.assessedTotal} marks
                    </div>
                  ) : null}
                  <div style={{ fontSize: '0.75rem', color: standing.tone, marginTop: '2px' }}>
                    {standing.label}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
