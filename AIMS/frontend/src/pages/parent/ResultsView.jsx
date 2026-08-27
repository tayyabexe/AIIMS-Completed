/*
 * The parent portal's results screen.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * This page used to be a summary of a summary. Every course collapsed to one
 * percentage, and that percentage was the sum of whatever sittings happened to
 * have been released — so "60%" could mean a strong quiz pulled down by a weak
 * mid-term, or a single paper, and a parent had no way to tell which. The
 * assessment table now carries the individual sittings: what was set, what was
 * marked, what is still outstanding, and what is on the calendar. That is the
 * whole point of the screen and it is now the largest thing on it.
 *
 * The chrome went the other way. What was here — a navy panel with a red blur
 * behind it, seven saturated grade colours, weight-900 numerals, a radar chart
 * that needed three subjects and drew nothing for the two most children have,
 * emoji verdicts, and a progress bar drawn next to every score it duplicated —
 * was decoration competing with the figures. The palette is now the portal's
 * own (parentTheme.js, which every other parent screen already uses), colour is
 * reserved for the three states that mean something, and nothing on the page is
 * drawn twice.
 *
 * ONE WORD IN PARTICULAR
 * ----------------------
 * The old header stamped "⚠ Failed — CGPA 2.00" across the top of any child
 * under 2.5. 2.5 is the institute's real threshold — the admin portal counts
 * against it in a dozen places — but it calls the result "low CGPA" and "at
 * risk" there, never "failed". A child below it has not failed anything; they
 * are below the standing they need. The wording here now matches the wording
 * the institute uses about the same number.
 */

import UserAvatar from '../../components/common/UserAvatar';
import AssessmentTable from './AssessmentTable';
import {
  allAssessments, countStates, gradeTone, outstanding, released,
  shortDate, formatMarks,
} from './assessments';
import {
  RED, INK, MUTED, FAINT, BORDER, CANVAS, OK, WARN,
  sectionStyle, panelHeaderStyle, panelTitleStyle,
  tileStyle, tileLabelStyle, tileValueStyle, tileNoteStyle,
} from './parentTheme';

// The institute's standing threshold, the same figure the admin portal counts
// "passed", "low CGPA" and "at risk" against.
const STANDING_CGPA = 2.5;

/** A metric tile. Four of these make the strip under the child's name. */
function Tile({ label, value, note, noteColor = MUTED }) {
  return (
    <div style={tileStyle}>
      <p style={tileLabelStyle}>{label}</p>
      <p style={tileValueStyle}>{value}</p>
      <p style={{ ...tileNoteStyle, color: noteColor }}>{note}</p>
    </div>
  );
}

/*
 * One sitting, as a line in the two ledger panels beside the table.
 *
 * Deliberately the same three facts in the same order in both panels — course,
 * what it was, when — so the eye does not have to relearn the shape when it
 * moves from one column to the other. Only the trailing value differs, because
 * that is the only thing that actually differs.
 */
function LedgerLine({ row, trailing, trailingColor, last }) {
  const dated = shortDate(row.examDate);
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: '0.75rem', padding: '0.5rem 0',
      // A rule under the last row is a line to nothing — the panel's own edge
      // is already there, and the two panels rarely hold the same number of
      // rows, so the stray rules did not even line up with each other.
      borderBottom: last ? 'none' : `1px solid ${BORDER}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: '0.82rem', color: INK, fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {row.examName}
        </div>
        <div style={{ fontSize: '0.75rem', color: MUTED, marginTop: '1px' }}>
          {row.courseCode}
          {dated ? ` · ${dated}` : ''}
        </div>
      </div>
      <span style={{
        fontSize: '0.82rem', fontWeight: 600, color: trailingColor,
        whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
      }}>
        {trailing}
      </span>
    </div>
  );
}

/** One entry in the legend under the assessment table. */
function LegendItem({ swatch, term, meaning }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
      <span style={{ color: swatch, fontWeight: 600, fontSize: '0.8rem' }}>{term}</span>
      <span style={{ color: MUTED, fontSize: '0.8rem' }}>{meaning}</span>
    </div>
  );
}

export default function ParentResultsView({ wards, selectedChildId }) {

  const child = wards.find((c) => c.id === selectedChildId) || wards[0];
  if (!child) return null;

  const courses = child.enrolledCourses || [];

  // Released subjects only. Averaging an unmarked course as a zero drags the
  // reported figure down by every result that simply is not out yet.
  const scored = courses.filter((c) => c.score !== null && c.score !== undefined);
  const awaiting = courses.length - scored.length;

  const avgScore = scored.length
    ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length)
    : null;

  const cgpa = Number.isFinite(child.cgpa) ? child.cgpa : null;
  const maxCgpa = child.maxCgpa || 4.0;
  const inStanding = cgpa === null ? null : cgpa >= STANDING_CGPA;

  const totalCredits = courses.reduce((s, c) => s + (c.credits || 0), 0);

  // Across every course: how much of this term has actually been assessed.
  const sittings = allAssessments(courses);
  const states = countStates(sittings);

  // The two ledgers beside the table: what is still to come, and what has
  // already landed. Capped, because both are read at a glance and the table
  // below holds the complete picture either way.
  const upcoming = outstanding(courses).slice(0, 6);
  const recent = released(courses).slice(0, 6);

  // Only worth drawing when there is something to compare. With one released
  // course the old screen printed the same subject as both the best and the
  // weakest, side by side.
  const comparable = scored.length >= 2;
  const strongest = comparable
    ? scored.reduce((a, b) => (b.score > a.score ? b : a))
    : null;
  const weakest = comparable
    ? scored.reduce((a, b) => (b.score < a.score ? b : a))
    : null;

  const metaLine = [
    child.regNo,
    child.program,
    child.semester,
    child.batch && child.batch !== '—' ? `${child.batch} batch` : null,
    child.section && child.section !== '—' ? `Section ${child.section}` : null,
  ].filter((part) => part && part !== '—').join(' · ');

  return (
    // minWidth: 0 for the same reason it is on the table's scroll container —
    // a flex item sized by its min-content would be sized by the widest table
    // inside it, and carry that width all the way out to the page.
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>

      {/* ---------------------------------------------------------- header -- */}
      <div>
        <h2 style={{
          fontSize: '1.35rem', fontWeight: 600, color: INK,
          letterSpacing: '-0.01em', margin: 0, fontFamily: "'Outfit', sans-serif",
        }}>
          Results
        </h2>
        <span style={{ fontSize: '0.8rem', color: MUTED }}>
          Parent Portal / <span style={{ color: FAINT }}>Results</span>
        </span>
      </div>

      {/* --------------------------------------------------- child summary -- */}
      {/* Flat and bordered, like every other panel on the portal. The navy
          gradient and the red blur that used to sit here made this the loudest
          object on a page whose subject is a table of numbers. */}
      <div style={{
        ...sectionStyle,
        display: 'flex', alignItems: 'center', gap: '0.9rem',
        padding: '1rem 1.25rem', flexWrap: 'wrap',
      }}>
        <UserAvatar
          userId={child.userId}
          hasPhoto={child.hasPhoto}
          version={child.avatarVersion}
          name={child.name}
          initials={child.initials}
          size={44}
          shape="rounded"
          style={{ backgroundColor: RED }}
        />
        <div style={{ flex: 1, minWidth: '200px' }}>
          <h3 style={{
            fontSize: '1rem', fontWeight: 600, color: INK, margin: 0,
            fontFamily: "'Outfit', sans-serif",
          }}>
            {child.name}
          </h3>
          <p style={{ fontSize: '0.78rem', color: MUTED, margin: '2px 0 0' }}>
            {metaLine || '—'}
          </p>
        </div>

        {/* The standing statement, or an honest silence. A child with no
            published result has no CGPA, and the old screen printed that as
            "Failed — CGPA 0.00". */}
        {cgpa === null ? (
          <span style={{ fontSize: '0.8rem', color: MUTED }}>
            No semester result published yet
          </span>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: '0.82rem', fontWeight: 600,
              color: inStanding ? OK : WARN,
            }}>
              {inStanding ? 'Good standing' : `Below the ${STANDING_CGPA.toFixed(2)} threshold`}
            </div>
            <div style={{ fontSize: '0.76rem', color: MUTED, marginTop: '1px' }}>
              CGPA {cgpa.toFixed(2)} of {maxCgpa.toFixed(1)}
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- metrics -- */}
      <div style={{
        display: 'grid', gap: '0.75rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      }}>
        <Tile
          label="Average across released"
          value={avgScore === null ? '—' : `${avgScore}%`}
          note={scored.length
            ? `${scored.length} of ${courses.length} course${courses.length === 1 ? '' : 's'}`
            : 'Nothing released yet'}
        />
        <Tile
          label="CGPA"
          value={cgpa === null ? '—' : cgpa.toFixed(2)}
          note={cgpa === null ? 'Awaiting a published semester' : `Out of ${maxCgpa.toFixed(1)}`}
          noteColor={MUTED}
        />
        <Tile
          label="Registered"
          value={`${courses.length}`}
          note={`${totalCredits} credit hour${totalCredits === 1 ? '' : 's'}`}
        />
        {/* The figure this page previously had no way to state at all: how much
            of the term has actually been assessed. */}
        <Tile
          label="Assessments marked"
          value={sittings.length ? `${states.graded}/${sittings.length}` : '—'}
          note={sittings.length
            ? [
              states.pending ? `${states.pending} pending` : null,
              states.scheduled ? `${states.scheduled} upcoming` : null,
            ].filter(Boolean).join(' · ') || 'All results in'
            : 'None set yet'}
          noteColor={states.pending ? WARN : MUTED}
        />
      </div>

      {/* ------------------------------------------------ assessment table -- */}
      <div style={sectionStyle}>
        <div style={panelHeaderStyle}>
          <h3 style={panelTitleStyle}>Assessment breakdown — {child.name}</h3>
          <span style={{ fontSize: '0.76rem', color: MUTED }}>
            {child.semester || 'Current semester'}
          </span>
        </div>

        <AssessmentTable courses={courses} />

        {/* The legend belongs under the table, not in a paragraph above it: the
            three words it explains are the three words in the cells. */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.5rem',
          padding: '0.75rem 1.1rem', borderTop: `1px solid ${BORDER}`,
          backgroundColor: CANVAS,
        }}>
          <LegendItem swatch={INK} term="20/20" meaning="marked and released" />
          <LegendItem swatch={WARN} term="Pending" meaning="sat, no result released yet" />
          <LegendItem swatch={MUTED} term="Due 15 Dec" meaning="scheduled, not sat yet" />
          <LegendItem swatch={FAINT} term="—" meaning="none of this kind set" />
        </div>
      </div>

      {/* --------------------------------------------------- the two ledgers -- */}
      {/* The page used to end at the table, which on a two-course term left
          most of the screen empty. These are not filler: neither question they
          answer — what is still to come, and what has just been released — was
          answerable anywhere in the portal before. */}
      <div style={{
        display: 'grid', gap: '0.75rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        // Each panel is as tall as its own contents. Stretched to match, the
        // shorter of the two is a white box with a heading and a lot of nothing
        // under it, and the two lists rarely hold the same number of rows.
        alignItems: 'start',
      }}>
        <div style={sectionStyle}>
          <div style={panelHeaderStyle}>
            <h3 style={panelTitleStyle}>Still to come</h3>
            <span style={{ fontSize: '0.76rem', color: MUTED }}>
              {states.pending + states.scheduled || 'None'}
            </span>
          </div>
          <div style={{ padding: '0.25rem 1.1rem 0.85rem' }}>
            {upcoming.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: MUTED, margin: '0.75rem 0' }}>
                Every assessment set so far has been marked and released.
              </p>
            ) : upcoming.map((row, i) => (
              <LedgerLine
                key={row.examId}
                row={row}
                last={i === upcoming.length - 1}
                trailing={row.state === 'pending' ? 'Pending' : `out of ${row.totalMarks}`}
                trailingColor={row.state === 'pending' ? WARN : MUTED}
              />
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={panelHeaderStyle}>
            <h3 style={panelTitleStyle}>Recently released</h3>
            <span style={{ fontSize: '0.76rem', color: MUTED }}>
              {states.graded || 'None'}
            </span>
          </div>
          <div style={{ padding: '0.25rem 1.1rem 0.85rem' }}>
            {recent.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: MUTED, margin: '0.75rem 0' }}>
                Nothing has been released for {child.name} yet.
              </p>
            ) : recent.map((row, i) => (
              <LedgerLine
                key={row.examId}
                row={row}
                last={i === recent.length - 1}
                trailing={`${formatMarks(row.obtained)}/${row.totalMarks}`}
                trailingColor={INK}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- strong and weak -- */}
      {comparable && (
        <div style={{
          display: 'grid', gap: '0.75rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}>
          <div style={{ ...sectionStyle, padding: '0.9rem 1.1rem' }}>
            <p style={tileLabelStyle}>Strongest subject</p>
            <p style={{ ...tileValueStyle, fontSize: '1rem' }}>{strongest.name}</p>
            <p style={{ ...tileNoteStyle, color: MUTED }}>
              {strongest.score}%
              {strongest.grade ? (
                <span style={{ color: gradeTone(strongest.grade), marginLeft: '6px' }}>
                  {strongest.grade}
                </span>
              ) : null}
            </p>
          </div>
          <div style={{ ...sectionStyle, padding: '0.9rem 1.1rem' }}>
            <p style={tileLabelStyle}>Needs the most attention</p>
            <p style={{ ...tileValueStyle, fontSize: '1rem' }}>{weakest.name}</p>
            <p style={{ ...tileNoteStyle, color: MUTED }}>
              {weakest.score}%
              {weakest.grade ? (
                <span style={{ color: gradeTone(weakest.grade), marginLeft: '6px' }}>
                  {weakest.grade}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- what is here -- */}
      {/* The claim the system actually keeps. An earlier version of this note
          promised these figures matched the admin portal exactly, which was not
          true while drafts were reaching this page. */}
      <p style={{
        fontSize: '0.78rem', color: MUTED, margin: 0,
        padding: '0.7rem 1.1rem', backgroundColor: CANVAS,
        border: `1px solid ${BORDER}`, borderRadius: '10px', lineHeight: 1.5,
      }}>
        Every score above has been released by the examination office. A mark a
        teacher has entered but not had released is shown as
        {' '}<span style={{ color: WARN, fontWeight: 600 }}>Pending</span>, not as a
        score, and a corrected mark replaces the one it corrects in the same
        place.
        {awaiting > 0
          ? ` ${awaiting} course${awaiting === 1 ? '' : 's'} `
            + `${awaiting === 1 ? 'has' : 'have'} no released result yet, and `
            + `${awaiting === 1 ? 'is' : 'are'} left out of the average and the CGPA.`
          : ''}
      </p>
    </div>
  );
}
