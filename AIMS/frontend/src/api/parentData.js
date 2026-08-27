// Loads the signed-in parent's data from the dedicated /api/parent/* endpoints.
//
// Those endpoints are all parent-self: the backend resolves the parent from the
// JWT, so a parent can only ever see their own children.
//
// The result is mapped into the same `students` / `parents` shape the parent
// dashboard already consumes, so that screen did not need rewriting.

import {
  parents as parentApi,
  programs as programsApi,
  batches as batchesApi,
  sections as sectionsApi,
  subjects as subjectsApi,
  semesters as semestersApi,
  enrollments as enrollmentsApi,
  marks as marksApi,
  results as resultsApi,
} from './endpoints';
// The grading ladder reader is shared with the student portal so both derive
// letters from the same `grades` table rather than two private tables.
import { makeGrader } from './studentData';

const listOf = (body, ...keys) => {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  return Array.isArray(body?.data) ? body.data : [];
};

const settled = (r, fallback = null) => (r.status === 'fulfilled' ? r.value : fallback);

const avatarColors = [
  '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
  '#0891B2', '#EA580C', '#4F46E5', '#BE123C', '#0D9488', '#9333EA',
];

// `Partial` and `Cancelled` are new: the old schema's status column could
// not express a part-paid voucher at all, so 791 of them were being
// reported as either fully paid or fully unpaid.
const FEE_STATUS_LABEL = {
  Paid: 'Paid',
  Partial: 'Partial',
  Unpaid: 'Pending',
  Overdue: 'Overdue',
  Cancelled: 'Cancelled',
};
const feeColorFor = (s) => (s === 'Paid' ? '#059669' : s === 'Overdue' ? '#DC2626' : '#D97706');

const shortTime = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  return `${Number(h)}:${m}`;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One row per registered subject, with the score and letter the child actually
 * earned in it.
 *
 * `enrollments` is the roster and the only authoritative answer to "what is
 * this child taking": a section timetable carries subjects the child is not
 * registered for, and a list built from marks alone hides any course that has
 * not been examined yet. `marks` holds one row per sitting (Quiz, Mid-Term,
 * Final, ...), so the sittings are collected under their subject and the
 * obtained/total pairs summed to get a percentage with a real denominator.
 *
 * A subject with no graded sitting keeps `percent: null` rather than 0 — the
 * screens render an em dash for that, which is the truth. A zero would read as
 * "sat the exam and scored nothing".
 */
const buildCourseRows = (enrollmentRows, markRows, gradeFor, ledgerRows) => {
  /*
   * The assessment ledger for this child, keyed by subject.
   *
   * GET /api/marks/student/:id/assessments answers the question the marks
   * endpoint cannot: what sittings does each registered course CARRY, whether
   * or not anyone has marked them. Attached to the course row so the results
   * table can print one column per assessment type with a real state behind
   * every cell.
   */
  const ledgerBySubject = new Map(
    (ledgerRows || []).map((s) => [s.subjectId, s]),
  );

  const scoreBySubject = new Map();

  for (const m of markRows) {
    const subjectId = m.subject_id;
    if (subjectId === null || subjectId === undefined) continue;

    const got = num(m.obtained_marks);
    const max = num(m.total_marks);
    if (got === null || max === null || max <= 0) continue;

    const acc = scoreBySubject.get(subjectId) || { obtained: 0, total: 0 };
    acc.obtained += got;
    acc.total += max;
    scoreBySubject.set(subjectId, acc);
  }

  return enrollmentRows
    // A dropped registration is not a course the child is taking.
    .filter((e) => e.status !== 'Dropped')
    .map((e) => {
      const tally = scoreBySubject.get(e.subject_id);
      const percent = tally && tally.total > 0
        ? Math.round((tally.obtained / tally.total) * 100)
        : null;

      const ledger = ledgerBySubject.get(e.subject_id) || null;

      return {
        id: e.enrollment_id,
        subjectId: e.subject_id,
        code: e.subject_code || '—',
        name: e.subject_name || '—',
        credits: num(e.credit_hours),
        semesterId: e.semester_id ?? null,
        semesterNumber: e.semester_number ?? null,
        status: e.status || null,
        score: percent,
        grade: percent === null ? null : gradeFor(percent).letter,

        /*
         * Every sitting this course carries, each already labelled ("Q1",
         * "MT") and stated ("graded" / "pending" / "scheduled") by the server.
         * An empty array means a registered course with no assessment filed
         * against it yet — which is a different thing from a course whose
         * assessments are all unmarked, and the screens say so.
         */
        assessments: ledger?.assessments || [],
        /*
         * The server's own percentage for this subject, over its graded
         * sittings only. It agrees with `score` above whenever both are
         * present — same numerator, same denominator, computed either side of
         * the wire — and is kept because it is the figure the assessment table
         * is actually a breakdown OF. `score` stays the field every existing
         * screen reads, so nothing had to be rewritten to take this.
         */
        assessedObtained: ledger ? ledger.obtained : null,
        assessedTotal: ledger ? ledger.total : null,
      };
    });
};

export async function loadParentData(account) {
  const [
    profileRes, childrenRes, attendanceRes, feeRes, resultsRes,
    timetableRes, notificationsRes,
    programsRes, batchesRes, sectionsRes, subjectsRes, semestersRes,
  ] = await Promise.allSettled([
    parentApi.profile(),
    parentApi.children(),
    parentApi.attendance(),
    parentApi.fees(),
    parentApi.results(),
    parentApi.timetable(),
    parentApi.notifications(),
    programsApi.list(),
    batchesApi.list(),
    sectionsApi.list(),
    subjectsApi.list(),
    semestersApi.list(),
  ]);

  const programById = new Map(listOf(settled(programsRes)).map((p) => [p.program_id, p]));
  const batchById = new Map(listOf(settled(batchesRes)).map((b) => [b.batch_id, b]));
  const sectionById = new Map(listOf(settled(sectionsRes)).map((s) => [s.section_id, s]));
  const subjectById = new Map(listOf(settled(subjectsRes)).map((s) => [s.subject_id, s]));
  const semesterById = new Map(listOf(settled(semestersRes)).map((s) => [s.semester_id, s]));

  const childLinks = listOf(settled(childrenRes), 'children');
  const attendanceRows = listOf(settled(attendanceRes), 'attendance');
  /*
   * One settled fee position per child, keyed by student_id.
   *
   * GET /api/parent/fees returns each child's vouchers with their instalments
   * and the billed/paid/due/advance totals, with overpayment already carried
   * forward. The three endpoints this replaces (fee-status, challan, receipt)
   * were partial views of two unlinked billing tables, so the portal had to
   * merge and settle them here — and got a different answer from the student
   * portal doing the same thing separately.
   */
  const feePositions = settled(feeRes)?.positions || {};
  const resultRows = listOf(settled(resultsRes), 'results');
  const timetableRows = listOf(settled(timetableRes), 'timetable');
  const notifications = listOf(settled(notificationsRes), 'notifications');

  // Index the per-child data by student_id.
  const attendanceByStudent = new Map();
  for (const row of attendanceRows) {
    const acc = attendanceByStudent.get(row.student_id) || { total: 0, present: 0, absent: 0 };
    acc.total += 1;
    if (row.status === 'Present' || row.status === 'Late') acc.present += 1;
    else acc.absent += 1;
    attendanceByStudent.set(row.student_id, acc);
  }

  /*
   * The individual attendance sittings, kept per child.
   *
   * The aggregate above answers "what percentage", but the attendance screen
   * needs to group by month and by subject, which only the raw rows can do.
   * Each `attendance` row carries att_date, subject_id and status, so the
   * screen can be built from record rather than from a table of invented
   * per-month offsets.
   */
  const recordsByStudent = new Map();
  for (const row of attendanceRows) {
    const list = recordsByStudent.get(row.student_id) || [];
    const subject = subjectById.get(row.subject_id);
    list.push({
      id: row.attendance_id,
      date: row.att_date,
      status: row.status,
      subjectId: row.subject_id ?? null,
      subjectCode: subject ? subject.subject_code : null,
      subjectName: subject ? subject.subject_name : null,
      /*
       * The timetable slot this sitting belongs to.
       *
       * A class can meet more than once on the same day, so date + subject is
       * not enough to identify a sitting: two rows for one Monday, same
       * course, one Present and one Absent, read as a contradiction rather
       * than as two lectures. The endpoint joins these in now.
       */
      timetableId: row.timetable_id ?? null,
      dayOfWeek: row.day_of_week ?? null,
      startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
      endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
      room: row.room_name ?? null,
    });
    recordsByStudent.set(row.student_id, list);
  }

  /*
   * The voucher that best represents each child's headline fee status.
   *
   * An overdue voucher outranks anything else, because that is the thing a
   * parent needs to see first; otherwise the most recent one is used.
   */
  const feeByStudent = new Map();
  for (const [studentId, position] of Object.entries(feePositions)) {
    const vouchers = position?.vouchers || [];
    if (!vouchers.length) continue;
    const headline = vouchers.find((v) => v.status === 'Overdue') || vouchers[0];
    feeByStudent.set(Number(studentId), headline);
  }

  /*
   * The child's latest PUBLISHED result.
   *
   * `results` also holds Pending rows — a semester an administrator has begun
   * and not released — and taking the highest semester regardless of status put
   * an unreleased GPA in front of the parent. The status is the whole point of
   * the column (Task 9/10); this is the read that has to honour it.
   */
  const resultByStudent = new Map();
  for (const r of resultRows) {
    if (r.status !== 'Published') continue;
    const prev = resultByStudent.get(r.student_id);
    if (!prev || (r.semester_id ?? 0) >= (prev.semester_id ?? 0)) {
      resultByStudent.set(r.student_id, r);
    }
  }

  // Children mapped into the same student shape the admin screens use, so the
  // parent dashboard's cards and stats work unchanged.
  /*
   * Each child's real exam percentage.
   *
   * `examScore` was hardcoded to null here and then rendered by the parent
   * screens as `examScore || 0`, so every child was reported as having scored
   * 0/100. There is now a real source: GET /api/marks/student/:id joins the
   * exam behind each mark, so a score has a denominator. The route authorises
   * a parent for their own wards only, so this cannot reach another family's
   * marks.
   *
   * The grading ladder comes from GET /api/results/grades rather than a
   * letter table written into this file.
   */
  const childIds = childLinks
    .map((link) => (link.Student || link.student || {}).student_id ?? link.student_id)
    .filter((id) => id !== undefined && id !== null);

  /*
   * The registered course list, per child.
   *
   * `enrolledCourses` was a hardcoded `[]` here, so the dashboard's "Enrolled
   * Courses" table rendered its five column headings above zero rows for every
   * child, permanently — Code, Course Name, Credits, Score and Grade had no
   * source at all. GET /api/enrollments/student/:id is that source: it joins
   * the subject and the semester, so one request answers what the child is
   * taking, for how many credit hours, in which semester. The route is behind
   * requireStudentAccess, which resolves a PARENT caller to their own wards, so
   * this cannot reach another family's roster.
   */
  const [gradesRes, ...perChildResults] = await Promise.allSettled([
    resultsApi.gradingScale(),
    ...childIds.map((id) => marksApi.forStudent(id)),
    ...childIds.map((id) => enrollmentsApi.forStudent(id)),
    // The per-assessment ledger, so the results screen can show a subject's
    // quizzes and papers individually instead of only their summed percentage.
    ...childIds.map((id) => marksApi.assessmentsForStudent(id)),
  ]);

  const markResults = perChildResults.slice(0, childIds.length);
  const enrollmentResults = perChildResults.slice(childIds.length, childIds.length * 2);
  const ledgerResults = perChildResults.slice(childIds.length * 2);

  const gradeRows = listOf(settled(gradesRes));
  const gradeFor = makeGrader(gradeRows);

  // The top of the institute's own grading ladder, rather than a 4.0 written
  // into this file. Falls back to 4.0 only when the scale could not be read.
  const maxGradePoint = gradeRows.reduce((top, g) => {
    const p = num(g.grade_point);
    return p !== null && p > top ? p : top;
  }, 0) || 4.0;

  const examByStudent = new Map();
  const coursesByStudent = new Map();

  childIds.forEach((id, i) => {
    const rows = listOf(settled(markResults[i]), 'marks');

    coursesByStudent.set(
      id,
      buildCourseRows(
        listOf(settled(enrollmentResults[i])),
        rows,
        gradeFor,
        listOf(settled(ledgerResults[i]), 'subjects'),
      ),
    );

    let obtained = 0;
    let total = 0;

    for (const m of rows) {
      const got = Number(m.obtained_marks);
      const max = Number(m.total_marks);
      if (!Number.isFinite(got) || !Number.isFinite(max) || max <= 0) continue;
      obtained += got;
      total += max;
    }

    // No graded sitting means no score, not a zero.
    if (total <= 0) return;

    const percent = Math.round((obtained / total) * 100);
    examByStudent.set(id, { percent, grade: gradeFor(percent).letter });
  });

  const children = childLinks.map((link) => {
    const s = link.Student || link.student || {};
    const studentId = s.student_id ?? link.student_id;

    const name = [s.first_name, s.last_name].filter(Boolean).join(' ').trim();
    const att = attendanceByStudent.get(studentId);
    const fee = feeByStudent.get(studentId);
    const position = feePositions[studentId] || null;
    const result = resultByStudent.get(studentId);

    const program = programById.get(s.program_id);
    const batch = batchById.get(s.batch_id);
    const section = sectionById.get(s.section_id);

    const feeStatus = fee ? (FEE_STATUS_LABEL[fee.status] || fee.status) : null;

    const courses = coursesByStudent.get(studentId) || [];

    /*
     * "Semester 3" from the semesters table, not from the raw foreign key.
     * current_semester_id is a row id: printing it produced labels like
     * "Semester 14" that correspond to nothing the parent can recognise.
     *
     * And it is nullable, with nothing on the enrollment path maintaining it,
     * so a properly registered child showed no semester at all (Task 7). The
     * roster answers when the column does not: the highest semester the child
     * holds a live registration in is the one they are sitting.
     */
    const rosterSemesterId = courses.reduce(
      (latest, c) => (c.semesterId !== null && (latest === null || c.semesterId > latest)
        ? c.semesterId
        : latest),
      null,
    );

    const effectiveSemesterId = s.current_semester_id ?? rosterSemesterId;
    const semesterRow = semesterById.get(effectiveSemesterId);
    const semesterNumber = semesterRow
      ? semesterRow.semester_number
      : (courses.find((c) => c.semesterId === effectiveSemesterId)?.semesterNumber ?? null);

    return {
      id: studentId,
      studentId,
      regNo: s.registration_number || '—',
      name: name || '—',
      initials: (name || 'S').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase(),
      avatarBg: avatarColors[(studentId || 0) % avatarColors.length],

      /*
       * The child's LOGIN id, which is not the same number as `studentId`.
       *
       * It is here for the avatar: /api/users/:id/avatar is keyed by the users
       * row, and the parent portal previously had no way to name it, so every
       * ward was drawn as initials even when the student had uploaded a
       * photograph. `hasPhoto` is the has-it flag the API sends alongside, so a
       * child with no picture costs no request at all, and `avatarVersion`
       * changes when they upload a new one so the cached blob is replaced.
       */
      userId: s.user_id ?? s.account?.user_id ?? null,
      // Either storage location counts as "has a picture": the bytes in the
      // row, or the legacy path to a file on disk. The avatar route serves
      // both, so treating only the first as real hid every pre-migration
      // portrait behind initials.
      hasPhoto: !!(s.account?.profile_picture_size || s.account?.profile_picture),
      avatarVersion: s.account?.profile_picture_updated_at || null,
      relationship: link.relationship || null,

      gender: (s.gender || '').toLowerCase() || null,
      phone: s.phone || null,
      dob: s.dob || null,
      status: s.academic_status || null,

      program: program ? program.program_name : '—',
      batch: batch ? batch.batch_name : '—',
      section: section ? section.section_name : '—',
      // Needed to pick this child's rows out of the parent's timetable, which
      // covers every child on the account.
      sectionId: s.section_id ?? null,
      semester: semesterNumber !== null ? `Semester ${semesterNumber}` : null,
      semesterId: effectiveSemesterId ?? null,
      semesterNumber,
      // The current semester's own window. The attendance screen reports on the
      // running term rather than a calendar year: two semesters fall inside one
      // year, and each has a different set of courses, so a Jan–Dec axis merges
      // terms that are not comparable.
      semesterStart: semesterRow ? semesterRow.start_date : null,
      semesterEnd: semesterRow ? semesterRow.end_date : null,

      // `cgpa` is a nullable column. Number(null) is 0 and Number(undefined) is
      // NaN, either of which the screens then printed as a real figure — a
      // child with no published result was shown as having a CGPA of 0.00 or
      // NaN. null means "not published yet" and renders as an em dash.
      cgpa: result ? num(result.cgpa) : null,
      gpa: result ? num(result.gpa) : null,
      maxCgpa: maxGradePoint,

      // A number, not a "93%" string: the dashboard needs to compare it against
      // the 75% threshold, and parseFloat(null) gave NaN — which is less than
      // nothing, so `NaN < 75` was false and a child with no attendance record
      // at all was reported as "on track".
      attendancePercent: att && att.total
        ? Math.round((att.present / att.total) * 100)
        : null,
      attendance: att && att.total ? `${Math.round((att.present / att.total) * 100)}%` : null,
      // Every marked sitting for this child, for the screens that group by
      // month or by subject.
      attendanceRecords: recordsByStudent.get(studentId) || [],
      presentDays: att ? att.present : null,
      absentDays: att ? att.absent : null,
      totalClasses: att ? att.total : null,

      feeStatus,
      rawFeeStatus: fee ? fee.status : null,
      feeAmount: fee ? num(fee.total_payable) : null,
      paidAmount: fee ? num(fee.settled_paid ?? fee.amount_paid) ?? 0 : null,
      remainingBalance: fee ? num(fee.settled_due ?? fee.remaining_balance) ?? 0 : null,
      dueDate: fee ? fee.due_date : null,
      feeColor: feeColorFor(feeStatus),

      // Across every voucher for this child, so an overpayment on one shows up
      // as credit rather than disappearing.
      // Straight from GET /api/parent/fees, which settles overpayment
      // server-side. Nothing is recomputed here, so this cannot disagree with
      // the fee screen or with the student portal.
      feeBilled: position ? position.totals.billed : null,
      feePaid: position ? position.totals.paid : null,
      feeOutstanding: position ? position.totals.due : null,
      feeAdvance: position ? position.totals.advance : null,
      // Payments this parent has declared that the accounts office has not
      // confirmed yet. Deliberately not netted off `feeOutstanding`: until it
      // is verified, only the payer has said the money arrived.
      feePending: position ? (position.totals.pending ?? 0) : null,

      feeVouchers: position ? position.vouchers : [],
      // Every instalment across this child's vouchers, newest first, with the
      // voucher it settled attached for display.
      feeTransactions: position
        ? position.vouchers
            .flatMap((v) => (v.payments || []).map((pay) => ({
              ...pay,
              voucherNumber: v.voucher_number,
            })))
            .sort((a, b) => String(b.payment_date || '').localeCompare(String(a.payment_date || '')))
        : [],

      // The child's login address, joined through students.user_id by
      // GET /api/parent/children. It was hardcoded to an em dash here on the
      // belief that the column did not exist; it lives on `users`.
      email: s.account?.email || s.email || null,
      address: s.address || null,

      // Real, from this child's own marks. null when nothing has been graded
      // yet — the screens render an em dash for that rather than 0.
      examScore: examByStudent.get(studentId)?.percent ?? null,
      examGrade: examByStudent.get(studentId)?.grade ?? null,

      // The registered roster, from GET /api/enrollments/student/:id, with each
      // subject's score summed from its own exam sittings.
      enrolledCourses: courses,
      // Filtered on the EFFECTIVE semester, so a child whose
      // current_semester_id was never set still gets their current courses
      // rather than an empty list (Task 7).
      currentCourses: effectiveSemesterId !== null && effectiveSemesterId !== undefined
        ? courses.filter((c) => c.semesterId === effectiveSemesterId)
        : courses,
    };
  });

  const timetable = timetableRows.map((t) => {
    const subject = subjectById.get(t.subject_id);
    const section = sectionById.get(t.section_id);
    return {
      id: t.timetable_id,
      code: subject ? subject.subject_code : null,
      title: subject ? subject.subject_name : '—',
      section: section ? section.section_name : '—',
      sectionId: t.section_id,
      day: t.day_of_week,
      start: shortTime(t.start_time),
      end: shortTime(t.end_time),
      room: t.classroom_id ? `Room ${t.classroom_id}` : '—',
    };
  });

  const profileBody = settled(profileRes);
  const parentRecord = profileBody?.parent || profileBody?.data || {};

  const parent = {
    id: parentRecord.parent_id ?? account?.parentId ?? null,
    parentId: parentRecord.parent_id ?? account?.parentId ?? null,
    name: [parentRecord.first_name, parentRecord.last_name].filter(Boolean).join(' ')
      || account?.name || '—',
    email: account?.email || '—',
    phone: parentRecord.phone || '—',
    occupation: parentRecord.occupation || '—',
    children: children.map((c) => c.id),
  };

  return {
    parent,
    parents: [parent],
    students: children,
    children,
    attendance: attendanceRows,
    // Keyed by student_id; each value is { vouchers, totals }.
    feePositions,
    results: resultRows,
    timetable,
    notifications,
  };
}
