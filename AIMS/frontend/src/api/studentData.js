// Loads the signed-in student's own data for the student portal.
//
// Everything here is scoped to the caller by the backend: /api/students/me
// resolves the record from the JWT, and the finance/result/marks endpoints are
// filtered to the student's own rows by selfScope.middleware, so a student
// cannot read anyone else's data even by changing the request.
//
// WHAT IS REAL and WHAT IS NOT
// ----------------------------
// Real: name, registration number, email, phone, DOB, gender, CNIC/B-Form,
//       address, nationality, blood group, academic status, program, batch,
//       section, semester, CGPA/GPA, attendance, fees, marks, timetable,
//       guardian name and contact (students.guardians), and the profile
//       picture (users.profile_picture).
//
// Deliberately absent: religion, achievements and skills. Those have no column
// in aims_db and are not part of the record this system keeps, so the profile
// no longer claims to hold them.
//
// Nothing in this module invents a figure. Where the database has no answer the
// field is null and the screen renders its empty state rather than a number.

import {
  students as studentsApi,
  programs as programsApi,
  batches as batchesApi,
  sections as sectionsApi,
  subjects as subjectsApi,
  timetables as timetablesApi,
  enrollments as enrollmentsApi,
  attendance as attendanceApi,
  marks as marksApi,
  results as resultsApi,
  studentResults,
  feeVouchers as feeVouchersApi,
} from './endpoints';
import { assetUrl, fetchBlobUrl } from './client';

/*
 * The avatar for an account whose picture is stored in the database.
 *
 * `profile_picture_size` is selected by the API purely as a "has an avatar"
 * flag — the bytes themselves are never included in a student read. Asking for
 * the image only when that flag is set is what keeps this from firing a
 * request per student that turns out to have no photograph.
 *
 * Returns null on any failure. A missing portrait is a normal state and the
 * portal already renders initials for it; it must never be able to fail a
 * profile load.
 */
const resolveAvatar = async (account) => {
  if (!account?.user_id || !account?.profile_picture_size) return null;

  try {
    return await fetchBlobUrl(`/api/users/${account.user_id}/avatar`);
  } catch {
    return null;
  }
};

const listOf = (body, ...keys) => {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  return Array.isArray(body?.data) ? body.data : [];
};

const settled = (result, fallback = null) =>
  result.status === 'fulfilled' ? result.value : fallback;

const shortTime = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  return `${Number(h)}:${m}`;
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sum = (rows, pick) =>
  rows.reduce((total, row) => total + (num(pick(row)) ?? 0), 0);

/* ======================================================================
 * Attendance
 *
 * `attendance` holds one row per student per timetable slot per day:
 * (student_id, subject_id, timetable_id, att_date, status). It carries no
 * subject code or name and no totals, so every figure the attendance screen
 * shows — per-subject counts, the monthly trend, the calendar — is derived
 * from those rows here rather than being read off a field that does not exist.
 * ==================================================================== */

/*
 * The institute's minimum attendance rule.
 *
 * aims_db has no settings or policy table, so this threshold is not a stored
 * value and is stated here once instead of being retyped on each screen. It is
 * the only number in this module that does not come from the database.
 */
export const ATTENDANCE_MIN_PCT = 80;

/* A late arrival is still an attended session; Absent and Leave are not.
   `Holiday` is not a session at all, so it leaves the denominator entirely. */
const ATTENDED_STATUSES = new Set(['Present', 'Late']);
const NON_SESSION_STATUSES = new Set(['Holiday']);

export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Leave', 'Holiday'];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Worst status wins for a day that has several classes: one absence is not
   hidden by the three lectures either side of it. */
const DAY_SEVERITY = { Absent: 0, Leave: 1, Late: 2, Present: 3, Holiday: 4 };

/**
 * `att_date` is a DATEONLY column, which the API serialises as 'YYYY-MM-DD'.
 * A Date or full ISO string is accepted too and read in the viewer's own
 * timezone, so a session never shifts to the previous day on the calendar.
 */
const dateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && !value.includes('T')) return value.slice(0, 10);

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const emptyTally = () => ({
  total: 0, counted: 0, attended: 0,
  Present: 0, Absent: 0, Late: 0, Leave: 0, Holiday: 0,
});

const addToTally = (bucket, status) => {
  bucket.total += 1;
  if (bucket[status] !== undefined) bucket[status] += 1;
  if (NON_SESSION_STATUSES.has(status)) return;
  bucket.counted += 1;
  if (ATTENDED_STATUSES.has(status)) bucket.attended += 1;
};

const percentOf = (attended, counted) =>
  counted > 0 ? Math.round((attended / counted) * 100) : null;

/** Consecutive future sessions that must be attended to reach `threshold`%. */
export const classesNeededForThreshold = (attended, counted, threshold = ATTENDANCE_MIN_PCT) => {
  const target = threshold / 100;
  if (counted === 0 || attended / counted >= target) return 0;

  let n = 0;
  while ((attended + n) / (counted + n) < target) {
    n += 1;
    if (n > 500) break;
  }
  return n;
};

/**
 * Attendance rows in the shape the screens read, with the subject resolved.
 *
 * GET /api/attendance/student/:id returns subject_id only, so the code and
 * title come from GET /api/subjects. A subject that could not be resolved keeps
 * a null code rather than being labelled with a guess.
 *
 * THE PERIOD. The endpoint now joins `timetables` and returns the slot's day,
 * start, end and room alongside the row. It matters because a class can meet
 * more than once on the same day — CS-101 CS-A meets at 08:30 AND 10:00 on
 * Mondays — and without the time, two rows for one date were "CS-101: Present"
 * and "CS-101: Absent" with nothing to say which lecture was which. The fields
 * are optional: a row whose slot has been deleted keeps a null time rather
 * than being dropped.
 */
export const normalizeAttendanceRows = (rawRows, subjectById = new Map()) =>
  rawRows
    .map((r) => {
      const subject = subjectById.get(r.subject_id);
      return {
        id: r.attendance_id,
        date: dateOnly(r.att_date),
        status: r.status,
        subjectId: r.subject_id ?? null,
        code: subject?.subject_code || null,
        title: subject?.subject_name || null,
        credits: subject?.credit_hours ?? null,
        semesterId: subject?.semester_id ?? null,
        timetableId: r.timetable_id ?? null,
        // The slot this register entry belongs to. Null when the timetable row
        // it pointed at is gone.
        dayOfWeek: r.day_of_week ?? null,
        startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
        endTime: r.end_time ? String(r.end_time).slice(0, 5) : null,
        room: r.room_name ?? null,
      };
    })
    .filter((r) => r.date && r.status)
    // Newest day first, and within a day the periods in the order they were
    // taught — two lectures on one Monday should read 08:30 then 10:00.
    .sort((a, b) => (
      b.date.localeCompare(a.date)
      || String(a.startTime || '').localeCompare(String(b.startTime || ''))
    ));

/**
 * Every figure the attendance screen draws, computed from a set of normalized
 * rows. Called again with a filtered set when the student picks one course, so
 * the whole page — ring, summary, trend, table, chart, calendar — describes
 * the same scope instead of only the table narrowing.
 *
 * `enrolled` is the student's courses from their timetable. Listing them up
 * front is what keeps a course the student is taking but has no marked session
 * for on the page: building the subject list out of the attendance rows alone
 * silently dropped it, so a student enrolled in five courses saw four and had
 * no way to tell whether the fifth was missing or simply never marked.
 */
export const summarizeAttendance = (rows, enrolled = []) => {
  const overall = emptyTally();
  const bySubjectId = new Map();
  const byMonth = new Map();
  const byDate = new Map();

  for (const subject of enrolled) {
    const key = subject.subject_id ?? `code:${subject.subject_code ?? 'unknown'}`;
    if (bySubjectId.has(key)) continue;
    bySubjectId.set(key, {
      key,
      subjectId: subject.subject_id ?? null,
      code: subject.subject_code || null,
      title: subject.subject_name || null,
      credits: subject.credit_hours ?? null,
      ...emptyTally(),
    });
  }

  for (const row of rows) {
    addToTally(overall, row.status);

    // --- per subject ---
    const subjectKey = row.subjectId ?? `code:${row.code ?? 'unknown'}`;
    let subject = bySubjectId.get(subjectKey);
    if (!subject) {
      subject = {
        key: subjectKey,
        subjectId: row.subjectId,
        code: row.code,
        title: row.title,
        credits: row.credits,
        ...emptyTally(),
      };
      bySubjectId.set(subjectKey, subject);
    }
    addToTally(subject, row.status);

    // --- per month, for the trend line ---
    const monthKey = row.date.slice(0, 7);
    let month = byMonth.get(monthKey);
    if (!month) {
      month = { key: monthKey, ...emptyTally() };
      byMonth.set(monthKey, month);
    }
    addToTally(month, row.status);

    // --- per day, for the calendar ---
    let day = byDate.get(row.date);
    if (!day) {
      day = { date: row.date, status: row.status, sessions: [] };
      byDate.set(row.date, day);
    }
    day.sessions.push({
      code: row.code,
      title: row.title,
      status: row.status,
      // Carried so the calendar can tell two periods of the same course on
      // the same day apart. Without it they render identically.
      startTime: row.startTime,
      endTime: row.endTime,
      room: row.room,
      timetableId: row.timetableId,
    });
    if (DAY_SEVERITY[row.status] < DAY_SEVERITY[day.status]) day.status = row.status;
  }

  const bySubject = [...bySubjectId.values()]
    .map((s) => {
      const pct = percentOf(s.attended, s.counted);
      return {
        ...s,
        pct,
        // A course with nothing marked yet has no percentage, and is not a
        // shortage — it is reported as awaiting its first session instead.
        hasSessions: s.counted > 0,
        isLow: pct !== null && pct < ATTENDANCE_MIN_PCT,
        needed: classesNeededForThreshold(s.attended, s.counted),
      };
    })
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));

  const monthly = [...byMonth.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => {
      const [year, month] = m.key.split('-').map(Number);
      return {
        ...m,
        year,
        month: month - 1, // 0-based, as JS Date uses
        label: MONTH_SHORT[month - 1],
        pct: percentOf(m.attended, m.counted),
      };
    });

  // Only months that actually have sessions are offered on the calendar, so
  // paging never lands on an empty grid.
  const months = monthly.map((m) => ({
    key: m.key, year: m.year, month: m.month, label: m.label, total: m.total,
  }));

  const dates = rows.map((r) => r.date).sort();

  return {
    rows,
    enrolled,
    // The page has something to show as soon as the student has a course, even
    // before the first session is marked against it.
    hasData: rows.length > 0 || bySubjectId.size > 0,

    total: overall.total,
    counted: overall.counted,
    attended: overall.attended,
    present: overall.Present,
    absent: overall.Absent,
    late: overall.Late,
    leave: overall.Leave,
    holiday: overall.Holiday,
    percent: percentOf(overall.attended, overall.counted),
    needed: classesNeededForThreshold(overall.attended, overall.counted),

    bySubject,
    monthly,
    months,
    byDate,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    minRequiredPct: ATTENDANCE_MIN_PCT,
  };
};

/**
 * Turns a percentage into the institute's grade using the `grades` table
 * (grade_letter, min_percentage, max_percentage, grade_point).
 *
 * Every screen used to carry its own invented ladder — one of them mapped A+ to
 * 10 points and then multiplied by 0.4 to fake a 4.0 scale. The real scale is
 * read from the API instead, and when it is unavailable no letter is shown at
 * all rather than a guessed one.
 */
export const makeGrader = (scaleRows) => {
  const scale = scaleRows
    .map((g) => ({
      letter: g.grade_letter,
      min: num(g.min_percentage),
      max: num(g.max_percentage),
      point: num(g.grade_point),
    }))
    .filter((g) => g.letter && g.min !== null)
    .sort((a, b) => b.min - a.min);

  return (percentage) => {
    if (percentage === null || !scale.length) return { letter: null, point: null };
    const hit = scale.find(
      (g) => percentage >= g.min && (g.max === null || percentage <= g.max),
    ) || scale[scale.length - 1];
    return { letter: hit.letter, point: hit.point };
  };
};

/**
 * Groups a student's marks into one row per subject per semester.
 *
 * `marks` holds one row per exam sitting; a subject therefore appears several
 * times (Quiz, Assignment, Mid-Term, Final, ...). The portal shows a subject
 * per line, so the components are collected under the subject and the totals
 * added up. Only components the student actually sat are counted — an absent
 * denominator is what produced the "0%" and "null%" the exam screens rendered.
 */
const buildSubjectResults = (markRows, grade) => {
  const bySubject = new Map();

  for (const m of markRows) {
    // A mark with no exam behind it has no denominator and cannot be scored.
    if (m.subjectId === null && m.subjectCode === null) continue;

    const key = `${m.semesterId ?? 'x'}:${m.subjectId ?? m.subjectCode}`;
    let row = bySubject.get(key);

    if (!row) {
      row = {
        key,
        semesterId: m.semesterId ?? null,
        subjectId: m.subjectId ?? null,
        code: m.subjectCode,
        title: m.subjectTitle,
        credits: m.credits,
        components: [],
        obtained: 0,
        total: 0,
      };
      bySubject.set(key, row);
    }

    row.components.push({
      examId: m.examId,
      name: m.examName,
      type: m.examType,
      date: m.examDate,
      obtained: m.obtained,
      total: m.total,
      status: m.status,
    });

    if (m.obtained !== null && m.total !== null) {
      row.obtained += m.obtained;
      row.total += m.total;
    }
  }

  return [...bySubject.values()].map((row) => {
    const percent = row.total > 0 ? (row.obtained / row.total) * 100 : null;
    const { letter, point } = grade(percent);

    return {
      ...row,
      percent: percent === null ? null : Math.round(percent * 10) / 10,
      grade: letter,
      gradePoint: point,
      // "Pass" is a claim about the grading scale, so it is only made when the
      // scale was actually read: a grade carrying no points is a fail.
      passed: point === null ? null : point > 0,
    };
  });
};

/*
 * A weighted GPA computed in the browser used to stand in wherever the results
 * table had nothing published yet. It has been removed rather than left unused:
 *
 * A GPA is a published figure. Computing one here produced a number that looked
 * exactly like the real thing, moved every time a teacher saved a mark, covered
 * only the subjects marked so far, and sat on the same card as a CGPA it
 * disagreed with. There is no such thing as a provisional GPA in this system —
 * `sp_publish_semester_results` is what makes one, and an administrator decides
 * when it runs (Task 9).
 *
 * The grading scale is still read, and is still used per SUBJECT: a released
 * mark shows the grade and grade point it earned. That is a fact about one
 * assessment, not a claim about the semester.
 */

export async function loadStudentData() {
  // The student's own record first: everything else keys off student_id.
  const meRes = await studentsApi.me();
  const me = meRes.data || meRes;

  const studentId = me.student_id;

  const [
    programsRes, batchesRes, sectionsRes, subjectsRes, timetableRes,
    attendanceRes, marksRes, feePositionRes, resultsRes,
    guardianRes, gradesRes, enrollmentRes, liveTimetableRes, myClassesRes,
  ] = await Promise.allSettled([
    programsApi.list(),
    batchesApi.list(),
    sectionsApi.list(),
    subjectsApi.list(),
    timetablesApi.list(),
    attendanceApi.forStudent(studentId),
    marksApi.forStudent(studentId),
    // One call for the whole fee position, already settled server-side.
    feeVouchersApi.myPosition(),
    studentResults.list(),
    // Guardian details were previously shown as a dash even though this
    // endpoint has always existed.
    studentsApi.guardians(studentId),
    // The real grading ladder, so no letter or grade point is invented.
    resultsApi.gradingScale(),
    // The courses this student is registered for, with credit hours and the
    // semester they belong to. This is the roll every course-shaped screen
    // reads; nothing else in the schema says what a student is taking.
    enrollmentsApi.forStudent(studentId),
    // The same timetable, resolved by the server, carrying the teacher and
    // room names the raw `timetables` rows only hold ids for.
    timetablesApi.current(),
    // The authoritative answer to "what am I taking, and who teaches it".
    //
    // Everything above infers a student's classes from their *section's*
    // timetable, which is a different question with a different answer: it
    // lists every subject the section sits, including ones this student is
    // not enrolled in, and it cannot tell a dropped course from a current
    // one. It also names a teacher per timetable *row*, so the same subject
    // could report one teacher on Monday and another on Wednesday.
    //
    // `course_offerings` is the join that actually holds it - this section
    // studies this subject with this teacher, this term - and this endpoint
    // walks it from the student's own enrolments. Server-side it is pinned to
    // the caller's own record for a student role, so it needs no trust here.
    studentsApi.classes(studentId),
  ]);

  const programs = listOf(settled(programsRes));
  const batches = listOf(settled(batchesRes));
  const sections = listOf(settled(sectionsRes));
  const subjects = listOf(settled(subjectsRes));
  const timetableRows = listOf(settled(timetableRes));

  // GET /api/students/me now resolves the student's programme, batch and
  // section through their own foreign keys and returns the names on the record.
  // Matching against the full lists is kept only as a fallback, because those
  // list endpoints hide soft-deleted rows: a student placed in a batch or
  // section that was later soft-deleted matched nothing there and the profile
  // showed a dash for a placement that is real on their record.
  const program = programs.find((p) => p.program_id === me.program_id) || null;
  const batch = batches.find((b) => b.batch_id === me.batch_id) || null;
  const section = sections.find((s) => s.section_id === me.section_id) || null;
  const programName = me.program_name || program?.program_name || '—';
  const batchName = me.batch_name || batch?.batch_name || '—';
  const sectionName = me.section_name || section?.section_name || '—';
  const subjectById = new Map(subjects.map((s) => [s.subject_id, s]));

  const grade = makeGrader(listOf(settled(gradesRes)));

  // ---- enrollment -------------------------------------------------------
  // GET /api/enrollments/student/:id — the registered roster, with the subject
  // and semester joined in. Dropped registrations are left out; a completed one
  // is still a course the student took, so only "Dropped" is filtered.
  //
  // Deriving this from the section timetable instead was wrong in both
  // directions: it listed subjects scheduled for the section that this student
  // is not registered for, and it could not see a registered course that has no
  // timetable slot of its own.
  const enrollmentRows = listOf(settled(enrollmentRes))
    .filter((e) => e.status !== 'Dropped');

  /*
   * The semester the student is actually sitting, by number rather than by row
   * id.
   *
   * `students.current_semester_id` is nullable and nothing on the enrollment
   * path maintains it, so matching on it alone returned null for a properly
   * registered student and printed their semester as a dash — the portal half
   * of the "No semester" defect (Task 7). The roster is the fallback, and the
   * authority: the highest semester the student holds a live registration in
   * is the semester they are in. The backend backfills the column and applies
   * the same fallback in SQL (services/currentSemester.js); this keeps the
   * portal honest even against a record that has not been through either.
   */
  const currentSemesterId = me.current_semester_id
    ?? enrollmentRows.reduce(
      (latest, e) => (latest === null || e.semester_id > latest ? e.semester_id : latest),
      null,
    );

  const currentSemesterNumber =
    enrollmentRows.find((e) => e.semester_id === currentSemesterId)?.semester_number
    ?? null;

  const enrolledSubjects = [...new Map(
    enrollmentRows.map((e) => [e.subject_id, {
      subject_id: e.subject_id,
      subject_code: e.subject_code,
      subject_name: e.subject_name,
      credit_hours: e.credit_hours,
      semester_id: e.semester_id,
    }]),
  ).values()];

  // ---- attendance -------------------------------------------------------
  // The rows are joined to the subject list here so every screen reads one
  // attendance model: per-subject counts, the monthly trend and the calendar
  // are all derived from the same rows rather than recomputed per page.
  const attendance = summarizeAttendance(
    normalizeAttendanceRows(listOf(settled(attendanceRes), 'attendance'), subjectById),
    enrolledSubjects,
  );
  const attendancePct = attendance.percent;

  // ---- marks ------------------------------------------------------------
  // GET /api/marks/student/:id joins exams and subjects, so a row now carries
  // its denominator (exams.total_marks) and its subject. Before that join the
  // portal read `marks_obtained` and `total_marks`, neither of which exists on
  // the marks table — which is why every score rendered as null.
  const markRows = listOf(settled(marksRes), 'marks').map((m) => {
    const subject = subjectById.get(m.subject_id);
    return {
      id: m.mark_id ?? `${m.exam_id}-${m.subject_id}`,
      examId: m.exam_id,
      examName: m.exam_name || null,
      examType: m.exam_type || null,
      examDate: m.exam_date || null,
      semesterId: m.semester_id ?? null,
      subjectId: m.subject_id ?? null,
      subjectCode: m.subject_code || subject?.subject_code || null,
      subjectTitle: m.subject_name || subject?.subject_name || '—',
      credits: m.credit_hours ?? subject?.credit_hours ?? null,
      obtained: num(m.obtained_marks),
      total: num(m.total_marks),
      status: m.status ?? null,
    };
  });

  const subjectResults = buildSubjectResults(markRows, grade);

  // ---- results ----------------------------------------------------------
  const resultRows = listOf(settled(resultsRes)).map((r) => ({
    resultId: r.result_id,
    semesterId: r.semester_id ?? null,
    gpa: num(r.gpa),
    cgpa: num(r.cgpa),
    status: r.status ?? null,
    publishedAt: r.published_at ?? null,
  }));

  const semesterOrder = (r) => r.semesterId ?? 0;
  const orderedResults = [...resultRows].sort((a, b) => semesterOrder(a) - semesterOrder(b));

  /*
   * The latest PUBLISHED result. `results` also holds Pending rows — a
   * semester an admin has started but not released — and taking the last row
   * regardless of status put an unreleased GPA on the student's screen.
   */
  const publishedResults = orderedResults.filter((r) => r.status === 'Published');
  const latestResult = publishedResults.length
    ? publishedResults[publishedResults.length - 1]
    : null;

  /*
   * TASK 8 — every enrolled course, whether or not it has been marked yet.
   *
   * The subject rows used to be built from the MARKS: `buildSubjectResults`
   * groups mark rows by subject, so a subject appeared on the Result page only
   * once a score existed for it. A student registered for five courses and
   * marked in two saw a two-row table and no sign of the other three — the
   * page could not distinguish "you are not taking this" from "this has not
   * been marked yet", and showed both as absence.
   *
   * The roster is the spine now. Every not-Dropped enrollment produces a row;
   * the marks are joined onto it where they exist. A row with no released mark
   * carries its code, title and credits with `awaitingResult: true` and null
   * scores, so the student can see the course is there and being counted.
   *
   * This interacts with Task 10 by design: the marks endpoint now returns only
   * Published rows to a student, so an unreleased course lands here as
   * "awaiting" rather than as a half-filled score.
   */
  const bySemesterAndSubject = new Map(
    subjectResults.map((r) => [`${r.semesterId ?? 'x'}:${r.subjectId}`, r]),
  );

  const enrolledRowsFor = (semesterId) => {
    const roster = enrollmentRows.filter((e) => e.semester_id === semesterId);

    return roster.map((e) => {
      const scored = bySemesterAndSubject.get(`${semesterId}:${e.subject_id}`);
      if (scored) return { ...scored, enrollmentStatus: e.status, awaitingResult: false };

      // Registered, nothing released. Everything the student is entitled to
      // know about the course, and nothing invented about their performance.
      return {
        key: `enrol-${e.enrollment_id}`,
        semesterId,
        subjectId: e.subject_id,
        code: e.subject_code || null,
        title: e.subject_name || '—',
        credits: e.credit_hours ?? null,
        components: [],
        obtained: 0,
        total: 0,
        percent: null,
        grade: null,
        gradePoint: null,
        passed: null,
        enrollmentStatus: e.status,
        awaitingResult: true,
      };
    });
  };

  // Semesters the student has something on record for: every semester they are
  // registered in, plus any that exists only on a result or a mark. No fixed
  // "Sem 1..8" strip — a student sees the semesters they have actually sat.
  const semesterIds = [...new Set([
    ...enrollmentRows.map((e) => e.semester_id),
    ...orderedResults.map((r) => r.semesterId),
    ...subjectResults.map((r) => r.semesterId),
  ].filter((id) => id !== null && id !== undefined))].sort((a, b) => a - b);

  const semesterNumberById = new Map(
    enrollmentRows.map((e) => [e.semester_id, e.semester_number]),
  );

  const semesters = semesterIds.map((id) => {
    const published = orderedResults.find(
      (r) => r.semesterId === id && r.status === 'Published',
    ) || null;

    const rows = enrolledRowsFor(id);
    // Semesters known only from a mark or a result, with no enrollment row to
    // build from, still show what they have rather than showing nothing.
    const subjects = rows.length ? rows : subjectResults.filter((r) => r.semesterId === id);

    const number = semesterNumberById.get(id) ?? null;

    return {
      semesterId: id,
      // The semester NUMBER where the roster supplies one. semester_id is a
      // global key running across every programme, so labelling by it told a
      // first-semester student they were in "Semester 23".
      label: number ? `Semester ${number}` : `Semester ${id}`,
      semesterNumber: number,

      /*
       * TASK 9 — a GPA appears only once the result is published.
       *
       * This used to fall back to a GPA computed in the browser from whatever
       * marks were on hand, flagged `gpaIsComputed` and captioned "this
       * semester's result is not published yet". That was a number with the
       * authority of a result and none of the checking: it moved every time a
       * teacher saved a mark, it counted only the subjects marked so far, and
       * it disagreed with the CGPA printed inches away from it.
       *
       * A GPA is what the institute publishes. Until it does, there is no GPA
       * — not a provisional one — and the page says so.
       */
      gpa: published?.gpa ?? null,
      cgpa: published?.cgpa ?? null,
      published: published !== null,
      status: published?.status
        ?? orderedResults.find((r) => r.semesterId === id)?.status
        ?? null,
      publishedAt: published?.publishedAt ?? null,

      subjects,
      // Credits of the courses REGISTERED for, not of the ones marked so far,
      // so the figure does not creep upwards as marks are released.
      credits: sum(subjects, (r) => r.credits),
      // What the student is still waiting on, so the page can say it plainly
      // instead of leaving a table of dashes to be interpreted.
      awaitingCount: subjects.filter((r) => r.awaitingResult).length,
    };
  });

  // ---- fees -------------------------------------------------------------
  /*
   * The whole fee position, settled by the server.
   *
   * What stood here was ~170 lines: two voucher tables merged on
   * voucher_number, receipts applied per challan, then a two-pass settlement
   * that pooled overpayment and spent it oldest-voucher-first. The parent
   * portal carried its own copy of the same idea, and the two had drifted —
   * they reported different balances for the same student.
   *
   * The five fee tables are now two, and the settlement runs once in
   * feeService.getStudentPosition. GET /api/fee-vouchers/me returns each
   * voucher with `settled_paid`, `settled_due` and `carried_in` already
   * applied, plus billed/paid/due/advance totals. Nothing is recomputed here.
   */
  const position = settled(feePositionRes) || {};
  const positionVouchers = Array.isArray(position.vouchers) ? position.vouchers : [];
  const positionTotals = position.totals || {};

  const voucherList = positionVouchers.map((v) => ({
    key: `voucher-${v.fee_voucher_id}`,
    feeVoucherId: v.fee_voucher_id,
    voucherNumber: v.voucher_number,
    amount: num(v.total_payable),
    issueDate: v.issue_date ?? null,
    dueDate: v.due_date ?? null,
    status: v.status ?? null,
    paid: num(v.settled_paid) ?? 0,
    due: num(v.settled_due) ?? 0,
    // How much of `paid` arrived as an overpayment carried over from another
    // voucher rather than as money paid against this one.
    carriedIn: num(v.carried_in) ?? 0,
    /*
     * Declared against this voucher and not yet decided on by the accounts
     * office. The API has always returned it; this mapping dropped it, which
     * is why the student portal could not tell a voucher with a submission
     * pending from one with nothing happening at all.
     *
     * NOT netted off `due`: until it is verified, the institute has been told
     * the money arrived by nobody but the payer.
     */
    pending: num(v.pending_amount) ?? 0,
  }));

  // One transaction per instalment, newest first, each naming the voucher it
  // settled. The screen identifies fee documents by voucher number, so the
  // receipt number is carried but not made the headline.
  const transactions = positionVouchers
    .flatMap((v) => (v.payments || []).map((p) => ({
      id: p.fee_payment_id,
      feeVoucherId: v.fee_voucher_id,
      voucherNumber: v.voucher_number,
      receiptNumber: p.receipt_number ?? null,
      method: p.payment_method ?? null,
      isLate: Boolean(p.is_late),
      amount: num(p.amount_paid) ?? 0,
      date: p.payment_date ?? null,
      /*
       * Pending / Verified / Rejected.
       *
       * This was dropped, so a declaration the student had just submitted
       * appeared in Payment History looking exactly like money the institute
       * had confirmed receiving — the one place the difference matters most.
       * A Pending row has no receipt number for the same reason: a receipt is
       * the institute's acknowledgement, and it has not given one yet.
       */
      status: p.status ?? null,
    })))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const totalBilled = num(positionTotals.billed) ?? 0;
  const totalPaid = num(positionTotals.paid) ?? 0;
  const totalDue = num(positionTotals.due) ?? 0;

  const fees = {
    vouchers: voucherList,
    transactions,
    totalBilled,
    totalPaid,
    totalDue,
    // Overpayment left once every outstanding voucher is covered. Zero in the
    // normal case; non-zero means the student is in credit.
    advance: num(positionTotals.advance) ?? 0,
    /*
     * Money the student has declared and the accounts office has not yet
     * confirmed. Reported on its own and never folded into `totalPaid` or
     * netted off `totalDue` — an unverified claim is not money received, and
     * showing it as either would let anyone clear a balance by typing a
     * number.
     */
    totalPending: num(positionTotals.pending) ?? 0,
    paidPercent: totalBilled > 0
      ? Math.round((Math.min(totalPaid, totalBilled) / totalBilled) * 100)
      : null,
    // Vouchers still carrying a balance, soonest due date first.
    outstanding: voucherList
      .filter((v) => (v.due ?? 0) > 0)
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))),
    hasData: voucherList.length > 0 || transactions.length > 0,
  };

  // ---- timetable --------------------------------------------------------
  // GET /api/timetables/current resolves the caller's own schedule and returns
  // the teacher and room names; the raw `timetables` rows carry only ids, which
  // is why a class used to be located at "Room 7" and taught by nobody. The raw
  // list stays as the fallback for a student whose live schedule is refused.
  const liveWeek = settled(liveTimetableRes)?.week || [];
  const liveEntries = liveWeek.flatMap((d) => d.entries || []);

  const timetable = (liveEntries.length
    ? liveEntries.map((t) => ({
      id: t.timetable_id,
      subjectId: t.subject_id,
      code: t.subject_code || null,
      title: t.subject_name || '—',
      credits: subjectById.get(t.subject_id)?.credit_hours ?? null,
      day: t.day_of_week,
      start: shortTime(t.start_time),
      end: shortTime(t.end_time),
      room: [t.room_name, t.building].filter(Boolean).join(', ') || '—',
      teacherId: t.teacher_id,
      teacher: t.teacher_name || null,
    }))
    : timetableRows
      .filter((t) => t.section_id === me.section_id)
      .map((t) => {
        const subject = subjectById.get(t.subject_id);
        return {
          id: t.timetable_id,
          subjectId: t.subject_id,
          code: subject ? subject.subject_code : null,
          title: subject ? subject.subject_name : '—',
          credits: subject ? subject.credit_hours : null,
          day: t.day_of_week,
          start: shortTime(t.start_time),
          end: shortTime(t.end_time),
          room: t.classroom_id ? `Room ${t.classroom_id}` : '—',
          teacherId: t.teacher_id,
          teacher: null,
        };
      })
  );

  // ---- courses ----------------------------------------------------------
  // One entry per registered course, with everything the course screens show
  // gathered onto it: who teaches it and where, from the timetable; how the
  // student is attending, from the attendance model; and how they are scoring,
  // from their verified marks against the institute's grading scale.
  const slotsBySubject = new Map();
  for (const slot of timetable) {
    if (slot.subjectId === null || slot.subjectId === undefined) continue;
    if (!slotsBySubject.has(slot.subjectId)) slotsBySubject.set(slot.subjectId, []);
    slotsBySubject.get(slot.subjectId).push(slot);
  }

  /*
   * The offering-derived truth for each enrolled course, keyed by subject
   * code (the response identifies subjects by code, not id).
   *
   * This is preferred over the section-timetable inference below wherever it
   * has an answer, and the inference is kept as the fallback for a term that
   * predates offerings or a request the server refuses.
   */
  const myClasses = settled(myClassesRes)?.classes || [];
  const classBySubjectCode = new Map(
    myClasses.filter((c) => c.subject_code).map((c) => [c.subject_code, c]),
  );

  const attendanceBySubject = new Map(
    attendance.bySubject.map((s) => [s.subjectId, s]),
  );
  const resultBySubject = new Map(
    subjectResults.filter((r) => r.subjectId !== null).map((r) => [r.subjectId, r]),
  );

  const courses = enrollmentRows.map((e) => {
    const att = attendanceBySubject.get(e.subject_id) || null;
    const result = resultBySubject.get(e.subject_id) || null;

    const offering = e.subject_code ? classBySubjectCode.get(e.subject_code) : null;

    /*
     * The offering's own meetings, shaped like the timetable slots the course
     * screens already read, so nothing downstream has to know which source
     * answered. One teacher per class here, by construction - that is the
     * whole point of the offering row.
     */
    const offeringSlots = (offering?.sessions || []).map((sn) => ({
      id: null,
      subjectId: e.subject_id,
      code: offering.subject_code,
      title: offering.subject_name,
      credits: num(e.credit_hours),
      day: sn.day_of_week,
      start: shortTime(sn.start_time),
      end: shortTime(sn.end_time),
      room: [sn.room_name, sn.building].filter(Boolean).join(', ') || '—',
      teacherId: offering.teacher?.teacher_id ?? null,
      teacher: offering.teacher?.name || null,
    }));

    const slots = offeringSlots.length
      ? offeringSlots
      : (slotsBySubject.get(e.subject_id) || []);

    const instructors = offering?.teacher?.name
      ? [offering.teacher.name]
      : [...new Set(slots.map((s) => s.teacher).filter(Boolean))];
    const rooms = [...new Set(slots.map((s) => s.room).filter((r) => r && r !== '—'))];

    return {
      enrollmentId: e.enrollment_id,
      subjectId: e.subject_id,
      code: e.subject_code || null,
      title: e.subject_name || '—',
      credits: num(e.credit_hours),
      status: e.status || null,
      enrolledOn: e.enrollment_date || null,

      semesterId: e.semester_id ?? null,
      semesterNumber: e.semester_number ?? null,
      semesterLabel: e.semester_number ? `Semester ${e.semester_number}` : null,
      semesterStart: e.semester_start_date || null,
      semesterEnd: e.semester_end_date || null,

      // subjects.prerequisite_subject_id, resolved by the API. The course
      // screens used to print a paragraph of invented catalogue prose; this is
      // the only descriptive fact the schema actually holds about a subject.
      prerequisite: e.prerequisite_subject_code
        ? {
          subjectId: e.prerequisite_subject_id ?? null,
          code: e.prerequisite_subject_code,
          title: e.prerequisite_subject_name || null,
        }
        : null,

      // Present when this course came from the offerings join, so a screen can
      // ask for the roster or say which term it belongs to.
      offeringId: offering?.offering_id ?? null,
      teacherEmail: offering?.teacher?.email || null,
      sectionName: offering?.section_name || null,

      slots,
      instructors,
      instructor: instructors.length ? instructors.join(', ') : null,
      rooms,
      room: rooms.length ? rooms.join(', ') : '—',
      schedule: slots.length
        ? slots.map((s) => `${s.day} ${s.start}–${s.end}`).join(' · ')
        : null,

      attendance: att,
      result,
    };
  });

  // ---- guardian ----------------------------------------------------------
  // student_guardians links a student to a parents row; the endpoint returns
  // the parent's own columns.
  // The name and phone live on the joined `parents` row, which the API returns
  // nested under `Parent` as well as lifted onto the row. Reading only the top
  // level is what left Guardian Name and Guardian Contact as dashes while the
  // relationship, which is on the link row itself, rendered fine.
  const guardianRows = listOf(settled(guardianRes), 'guardians');

  const flattenGuardian = (row) => ({ ...(row.Parent || {}), ...row });

  const nameOf = (g) => (g
    ? ([g.first_name, g.last_name].filter(Boolean).join(' ') || g.guardian_name || null)
    : null);

  /*
   * EVERY linked guardian, not just the first.
   *
   * A student may have a father AND a mother on `student_guardians`, and the
   * three scalars below can only ever describe one of them — which is why a
   * student with both parents registered could see only one. The array is the
   * shape the profile renders from; the scalars are kept exactly as they were
   * so the dashboard and anything else already reading them is untouched.
   *
   * `email` comes from the parent's login account (users.email), joined on the
   * server — `parents` has no email column.
   */
  const guardians = guardianRows.map((row, i) => {
    const g = flattenGuardian(row);
    return {
      key: `guardian-${g.parent_id ?? i}`,
      parentId: g.parent_id ?? null,
      name: nameOf(g),
      email: g.email || null,
      phone: g.phone || g.contact_number || null,
      relationship: g.relationship || null,
      occupation: g.occupation || null,
    };
  });

  const guardian = guardianRows.length ? flattenGuardian(guardianRows[0]) : null;
  const guardianName = nameOf(guardian);

  const fullName = [me.first_name, me.last_name].filter(Boolean).join(' ');

  const profile = {
    studentId,
    userId: me.user_id,
    firstName: me.first_name,
    lastName: me.last_name,
    fullName,
    initials: fullName.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase(),
    rollNo: me.registration_number,
    program: programName,
    // The department a programme belongs to. This used to repeat the
    // programme name, which is why the dashboard printed "Computer Science"
    // twice under one another.
    department: program?.department_name || '—',
    semesterId: currentSemesterId ?? null,
    // semesters.semester_number, from the enrollment join. students.
    // current_semester_id is a row id, not a semester number — printing it as
    // "Semester 6" told a fourth-semester student they were in their sixth.
    semesterNumber: currentSemesterNumber,
    semester: currentSemesterNumber ? `Semester ${currentSemesterNumber}` : '—',
    batch: batchName,
    section: sectionName,
    // Email lives on the users row, which /api/students/me joins in as
    // `account` and also flattens onto the record.
    email: me.email || me.account?.email || '—',
    phone: me.phone || me.account?.phone || '—',
    dob: me.dob || '—',
    gender: me.gender || '—',
    cnic: me.cnic_bform || '—',
    status: me.academic_status || '—',

    // Personal details the student maintains themselves. Nullable columns, so
    // a student who has not filled them in sees a dash rather than a guess.
    address: me.address || '—',
    nationality: me.nationality || '—',
    bloodGroup: me.blood_group || '—',

    /*
     * Published figures only.
     *
     * The GPA used to fall through to one computed in the browser when no
     * result was published. That produced a figure on the dashboard, the
     * profile and the Result page that no member of staff had approved and
     * that changed whenever a teacher saved a mark. A student with no
     * published result now has no GPA, which is the truth (Task 9).
     */
    cgpa: latestResult?.cgpa ?? null,
    gpa: latestResult?.gpa ?? null,
    cgpaOutOf: 4.0,
    attendancePct,

    // Courses this student is registered for, counted from `enrollments`.
    // There is no "completed courses" figure in the schema — the 32-of-40 the
    // profile used to print was invented — so only the real count is reported.
    enrolledCourses: courses.length,
    creditHours: sum(courses, (c) => c.credits),

    // Guardian, from GET /api/students/guardians/:id.
    guardian: guardianName || '—',
    guardianContact: guardian ? (guardian.phone || guardian.contact_number || '—') : '—',
    guardianRelationship: guardian ? (guardian.relationship || '—') : '—',
    guardianEmail: guardian ? (guardian.email || '—') : '—',

    // Every parent/guardian linked to this student, so the profile can list
    // both rather than silently showing the first.
    guardians,

    /*
     * The avatar.
     *
     * Media now lives as binary in the database and is served by an
     * AUTHENTICATED route, /api/users/:id/avatar. An <img src> issues its own
     * request with no Authorization header, so that URL cannot be handed to
     * one directly — it would 401 and render broken. The bytes are fetched
     * here with the token attached and wrapped in a blob: URL, which every
     * existing `<img src={profile.photoUrl}>` in the student portal then uses
     * unchanged.
     *
     * The legacy path is still honoured first when a row has one, so accounts
     * whose picture predates the move are unaffected and cost no extra request.
     *
     * Resolved once, here, rather than per component: the student profile is
     * loaded into context and read by the dashboard, the top bar and the
     * profile page, and three components each fetching the same portrait would
     * be three downloads of it.
     */
    photoUrl: me.account?.profile_picture
      ? assetUrl(me.account.profile_picture)
      : await resolveAvatar(me.account),
  };

  return {
    profile,
    raw: me,
    courses,
    enrollments: enrollmentRows,
    timetable,
    marks: markRows,
    subjectResults,
    semesters,
    attendance,
    result: latestResult,
    results: orderedResults,
    fees,
  };
}
