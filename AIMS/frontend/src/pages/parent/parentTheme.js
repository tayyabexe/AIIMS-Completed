/*
 * The parent portal's shared style constants.
 *
 * These were declared inside the single 1,400-line component that used to be
 * the whole portal, so every screen shared them by accident of scope. Splitting
 * the portal into a route per module would have meant either passing them down
 * as props or — far more likely — each new page file redeclaring its own
 * slightly different card radius and muted grey. They are lifted here so the
 * split cannot start that drift.
 *
 * Nothing about the values has changed. This is the same palette and the same
 * chrome the portal already draws, moved so more than one file can reach it.
 */

export const RED = '#991b1b';
export const DARK_RED = '#7f1d1d';
export const NAVY = '#0B132B';

export const INK = '#0F172A';
export const MUTED = '#64748B';
export const FAINT = '#94A3B8';
export const BORDER = '#E2E8F0';
export const CANVAS = '#F8FAFC';

export const OK = '#047857';
export const WARN = '#B45309';
export const BAD = '#B91C1C';

/** Card chrome, shared by every panel on the portal. */
export const sectionStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: '16px',
  border: `1px solid ${BORDER}`,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  overflow: 'hidden',
};

/*
 * One tile shape for the whole metric strip, so four cards cannot drift into
 * four different paddings, radii and shadows. Deliberately tight: three lines
 * of text do not need 1.1rem of padding on every side.
 */
export const tileStyle = {
  padding: '0.8rem 0.95rem',
  borderRadius: '12px',
  backgroundColor: '#FFFFFF',
  border: `1px solid ${BORDER}`,
};

export const tileLabelStyle = {
  fontSize: '0.76rem', color: MUTED, fontWeight: 600, margin: 0,
};

export const tileValueStyle = {
  fontSize: '1.3rem', fontWeight: 700, color: INK,
  margin: '2px 0 0', lineHeight: 1.15, fontFamily: "'Outfit', sans-serif",
};

export const tileNoteStyle = { fontSize: '0.75rem', margin: '2px 0 0' };

/** Panel chrome, shared by the attendance and fee breakdowns. */
export const panelHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0.7rem 1.1rem', borderBottom: `1px solid ${BORDER}`,
};

export const panelTitleStyle = {
  fontSize: '0.88rem', fontWeight: 600, color: INK, margin: 0,
  fontFamily: "'Outfit', sans-serif",
};

/** Label/value pair inside the detail panels. */
export const rowStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0.6rem 0.75rem', backgroundColor: CANVAS, borderRadius: '8px',
};

export const rowLabelStyle = { fontSize: '0.82rem', color: MUTED, fontWeight: 500 };
export const rowValueStyle = { fontSize: '0.88rem', fontWeight: 600, color: INK };

export const sectionHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '1.25rem 1.5rem', cursor: 'pointer',
  userSelect: 'none',
  transition: 'background-color 0.2s',
};

/*
 * The per-child figures, and the `has…` flags that keep a missing figure from
 * being rendered as a confident statement.
 *
 * Every one of these is nullable, and each null used to be rendered as fact:
 *
 *  - attendance came through as a "93%" string, so `parseFloat(null)` gave
 *    NaN; `NaN < 75` is false, and a child with no attendance record at all
 *    was shown the green "Above 75% — on track" verdict.
 *  - `feeStatus !== 'Paid'` is true when feeStatus is null, so a child with
 *    no fee record was asserted to be "Pending payment".
 *  - cgpa arrived as NaN from Number(null) and printed as "NaN".
 *  - examScore `|| 0` turned "nothing graded yet" into a reported 0/100 and an
 *    "At risk" verdict.
 *
 * Derived in one place now rather than inside the component, because two
 * screens read them and a second copy is a second chance to reintroduce one of
 * the four bugs above.
 */
export function childFigures(child) {
  const attendanceVal = child?.attendancePercent ?? null;
  const hasAttendance = attendanceVal !== null;

  const feeStatus = child?.feeStatus ?? null;
  const hasFee = feeStatus !== null;
  const feeDue = hasFee && feeStatus !== 'Paid';

  const cgpa = Number.isFinite(child?.cgpa) ? child.cgpa : null;
  const hasCgpa = cgpa !== null;

  const examScore = child?.examScore ?? null;
  const hasExamScore = examScore !== null;

  const gradeColor = !hasExamScore ? MUTED
    : examScore >= 80 ? OK
      : examScore >= 40 ? WARN : BAD;

  const attendanceColor = !hasAttendance ? MUTED : attendanceVal < 75 ? BAD : OK;

  return {
    attendanceVal, hasAttendance, attendanceColor,
    feeStatus, hasFee, feeDue,
    cgpa, hasCgpa,
    examScore, hasExamScore, gradeColor,
    courses: child?.enrolledCourses ?? [],
  };
}
