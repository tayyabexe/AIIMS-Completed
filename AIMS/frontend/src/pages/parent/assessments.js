/*
 * Reading an assessment ledger, shared by the parent portal's results table and
 * its dashboard's course card.
 *
 * The rows come from GET /api/marks/student/:id/assessments, already labelled
 * ("Q1", "MT") and stated by the server. Nothing here recomputes a score — the
 * point of this module is presentation: which column a sitting belongs in, what
 * a cell says when there is no score behind it, and what colour that is.
 *
 * WHY THE STATE MATTERS MORE THAN THE SCORE
 * -----------------------------------------
 * The screens this feeds used to have two states, a number or an em dash, and
 * the dash covered three unrelated situations: the course has no final exam,
 * the final is next month, and the final was sat and is still unmarked. A
 * parent cannot act on any of those without being told which one it is, and the
 * middle one is the one they most often ask about. Every cell below therefore
 * says which of the three it is, in words.
 */

import { OK, WARN, MUTED, INK, BAD, FAINT } from './parentTheme';

/*
 * One column per exam_type, in the order the enum declares them and the order
 * a term actually runs: coursework, then the two papers, then the practical
 * assessments.
 *
 * All six are given a column of their own rather than folded into four. A viva
 * printed under a "Quizzes" heading is a small lie, and the columns for types
 * a course does not use collapse to a single muted dash — which costs one
 * narrow column and tells the parent something true.
 */
export const ASSESSMENT_COLUMNS = [
  { type: 'Assignment', heading: 'Assignments' },
  { type: 'Quiz', heading: 'Quizzes' },
  { type: 'Mid-Term', heading: 'Mid-Term' },
  { type: 'Final', heading: 'Final' },
  { type: 'Practical', heading: 'Practical' },
  { type: 'Viva', heading: 'Viva' },
];

/** The sittings of one course, bucketed by the column they belong in. */
export function byColumn(assessments) {
  const buckets = new Map(ASSESSMENT_COLUMNS.map((c) => [c.type, []]));
  for (const a of assessments || []) {
    const bucket = buckets.get(a.examType);
    // An exam_type the enum gains later must not vanish silently, but it also
    // has no column to go in. Dropping it here is visible in the totals row,
    // which counts what the server sent rather than what was rendered.
    if (bucket) bucket.push(a);
  }
  return buckets;
}

/** Every sitting across every course of a child, flattened. */
export function allAssessments(courses) {
  return (courses || []).flatMap((c) => c.assessments || []);
}

/** How many sittings sit in each state, across whatever is passed in. */
export function countStates(assessments) {
  const tally = { graded: 0, pending: 0, scheduled: 0 };
  for (const a of assessments || []) {
    if (tally[a.state] !== undefined) tally[a.state] += 1;
  }
  return tally;
}

/*
 * A short date for a sitting that has not happened yet — "15 Dec".
 *
 * The year is deliberately absent: every assessment on this screen belongs to
 * the semester the child is sitting, so the year is the same on all of them and
 * printing it four times per row buys nothing.
 */
export function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/*
 * Every sitting still outstanding, soonest first — the "what is coming"
 * question, which no screen in the portal could answer before.
 *
 * Pending sittings sort ahead of scheduled ones on an equal date because a
 * result the family is waiting for is more actionable than a paper that has
 * not been sat. A sitting with no date sorts last rather than first, which is
 * where an empty string would otherwise put it.
 */
export function outstanding(courses) {
  const rows = [];
  for (const c of courses || []) {
    for (const a of c.assessments || []) {
      if (a.state === 'graded') continue;
      rows.push({ ...a, courseCode: c.code, courseName: c.name });
    }
  }
  return rows.sort((a, b) => {
    const da = a.examDate || '9999-99-99';
    const db = b.examDate || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    if (a.state !== b.state) return a.state === 'pending' ? -1 : 1;
    return 0;
  });
}

/*
 * Every released sitting, most recent first.
 *
 * This is what makes a corrected mark visible as an event rather than only as
 * a number that quietly changed inside a table cell — a parent who checks the
 * portal weekly wants to know what has landed since they last looked, and the
 * date of the sitting is the closest thing the schema records to that.
 */
export function released(courses) {
  const rows = [];
  for (const c of courses || []) {
    for (const a of c.assessments || []) {
      if (a.state !== 'graded') continue;
      rows.push({ ...a, courseCode: c.code, courseName: c.name });
    }
  }
  return rows.sort((a, b) => {
    const da = a.examDate || '';
    const db = b.examDate || '';
    if (da !== db) return da < db ? 1 : -1;
    return 0;
  });
}

/**
 * What one cell says, and in what colour.
 *
 * Returns { text, tone, title } — `title` is the tooltip, which carries the
 * exam's real name and date so the compressed label in the cell ("Q1") is
 * always resolvable to the thing the teacher actually set.
 */
export function readAssessment(a) {
  const dated = a.examDate ? shortDate(a.examDate) : null;
  const name = a.examName || a.examType;

  if (a.state === 'graded') {
    return {
      text: `${formatMarks(a.obtained)}/${a.totalMarks}`,
      tone: INK,
      title: dated ? `${name} — ${dated}` : name,
    };
  }

  if (a.state === 'scheduled') {
    return {
      /*
       * "Due 15 Dec", never a bare "15 Dec".
       *
       * A date sitting in a marks column, in the same cell shape as "22/50"
       * one column to its left, reads as a score to anyone skimming — the
       * legend under the table explains it, and nobody reads the legend
       * first. The word carries the meaning without depending on the colour
       * or the reader's patience.
       */
      text: dated ? `Due ${dated}` : 'Scheduled',
      tone: MUTED,
      title: `${name} — scheduled${dated ? ` for ${dated}` : ''}, not sat yet`,
    };
  }

  return {
    text: 'Pending',
    tone: WARN,
    title: `${name}${dated ? ` — sat ${dated}` : ''}, awaiting a result`,
  };
}

/*
 * Marks as the teacher entered them, without the decimal noise.
 *
 * obtained_marks is DECIMAL(6,2), so a whole number arrives as 20 and renders
 * as "20.00/20" untouched. Half marks are real and are kept; ".00" is not.
 */
export function formatMarks(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/*
 * The colour a grade letter is printed in.
 *
 * Deliberately three tones and not seven. The screen this replaces gave every
 * letter its own saturated hue — emerald, lime, amber, yellow, purple, red —
 * so a row of ordinary passes lit up like a warning panel and nothing stood
 * out because everything did. A grade only needs to answer one question at a
 * glance: is this fine, is it marginal, or is it a fail. The letter itself
 * carries the rest.
 */
export function gradeTone(grade) {
  if (!grade) return FAINT;
  const g = String(grade).toUpperCase();
  if (g === 'F') return BAD;
  if (g === 'D') return WARN;
  return OK;
}

/*
 * A subject's standing, in the same three states the individual sittings use.
 *
 * `percent === null` is not a fail. It means nothing in this course has been
 * released yet, which the old screen rendered as a red "Fail" badge because
 * `null >= 40` is false.
 */
export function subjectStanding(course) {
  const graded = (course.assessments || []).filter((a) => a.state === 'graded');
  const outstanding = (course.assessments || []).length - graded.length;

  if (course.score === null || course.score === undefined) {
    return {
      label: (course.assessments || []).length === 0
        ? 'No assessments set'
        : 'Awaiting first result',
      tone: MUTED,
      outstanding,
    };
  }

  if (course.score < 40) {
    return { label: 'Below pass mark', tone: BAD, outstanding };
  }

  return {
    label: outstanding > 0 ? 'On track' : 'Passed',
    tone: OK,
    outstanding,
  };
}
