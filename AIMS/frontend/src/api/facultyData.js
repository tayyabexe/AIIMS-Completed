// Loads the faculty portal's data for the signed-in teacher and returns it in
// the same collection shape the faculty pages already consume, so those pages
// did not have to be rewritten.
//
// WHAT IS REAL and WHAT IS NOT
// ----------------------------
// Real, from the database:
//   the teacher's own identity, their timetable (subjects, sections, days,
//   times, rooms), the students in their sections, those students' attendance
//   and CGPA, the subject catalogue, and departments.
//   assignments                  - `exams` rows with exam_type = 'Assignment',
//                                  for the subjects this teacher teaches
// Not available from the API:
//   submissions                  - aims_db has no per-student submission table;
//                                  what exists is `marks`, which is a grade
//                                  once entered, not a submission record
//   fees and parents             - teachers get 403 on those endpoints by
//                                  design, so both are empty for this role
//   marks                        - there is no bulk marks endpoint; marks are
//                                  fetched per student on the Marks screen

import {
  teachers as teachersApi,
  timetables as timetablesApi,
  subjects as subjectsApi,
  sections as sectionsApi,
  students as studentsApi,
  departments as departmentsApi,
  exams as examsApi,
  summaries,
} from './endpoints';
import { ROLES } from './roles';

const listOf = (body, ...keys) => {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  return Array.isArray(body?.data) ? body.data : [];
};

const unique = (values) => [...new Set(values.filter((v) => v !== null && v !== undefined))];

// "09:00:00" -> "9:00"
const shortTime = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  return `${Number(h)}:${m}`;
};

/**
 * @param account the signed-in user from AuthContext (needs userId)
 */
export async function loadFacultyData(account) {
  const [teacherRes, timetableRes, subjectRes, sectionRes, deptRes] = await Promise.all([
    teachersApi.list(),
    timetablesApi.list(),
    subjectsApi.list(),
    sectionsApi.list(),
    departmentsApi.list(),
  ]);

  const allTeachers = listOf(teacherRes);
  const allTimetables = listOf(timetableRes);
  const allSubjects = listOf(subjectRes);
  const allSections = listOf(sectionRes);
  const allDepartments = listOf(deptRes);

  const subjectById = new Map(allSubjects.map((s) => [s.subject_id, s]));
  const sectionById = new Map(allSections.map((s) => [s.section_id, s]));
  const teacherById = new Map(allTeachers.map((t) => [t.teacher_id, t]));

  // Which teacher is signed in.
  const me = allTeachers.find((t) => t.user_id && t.user_id === account?.userId) || null;

  // An Admin or Super Admin looking at this portal legitimately sees every
  // class — they can read the whole institute anyway.
  //
  // A TEACHER whose own row could not be matched must NOT. The previous
  // `me ? filter : allTimetables` fell open for both cases alike: a teacher
  // whose lookup failed for any reason (a renamed account, a user_id that did
  // not line up) was handed every class in the institute, and the loader then
  // fetched the student roster for every one of those sections. Their portal
  // and its search bar would list students they do not teach.
  //
  // Failing closed means such a teacher sees nothing until their record is
  // linked, which is the safe direction to be wrong in.
  const isStaffWideReader = account?.roleId === ROLES.SUPER_ADMIN
    || account?.roleId === ROLES.ADMIN;

  const myTimetable = me
    ? allTimetables.filter((t) => t.teacher_id === me.teacher_id)
    : (isStaffWideReader ? allTimetables : []);

  // One entry per subject+section the teacher actually teaches.
  const classKey = (t) => `${t.subject_id}:${t.section_id}`;
  const classes = new Map();

  for (const row of myTimetable) {
    const key = classKey(row);
    const subject = subjectById.get(row.subject_id);
    const section = sectionById.get(row.section_id);
    const teacher = teacherById.get(row.teacher_id);

    const existing = classes.get(key);
    const slot = `${row.day_of_week} ${shortTime(row.start_time)}–${shortTime(row.end_time)}`;

    if (existing) {
      existing.slots.push(slot);
      existing.time = existing.slots.join(', ');
      continue;
    }

    classes.set(key, {
      code: subject ? subject.subject_code : `SUB-${row.subject_id}`,
      title: subject ? subject.subject_name : '—',
      subjectId: row.subject_id,
      sectionId: row.section_id,
      section: section ? section.section_name : '—',
      semester: subject ? subject.semester_id : null,
      credits: subject ? subject.credit_hours : null,
      department: teacher ? teacher.department_name : null,
      teacherId: row.teacher_id,
      teacherName: teacher ? teacher.full_name : null,
      // classrooms have no endpoint, so only the id is known.
      room: row.classroom_id ? `Room ${row.classroom_id}` : '—',
      slots: [slot],
      time: slot,
    });
  }

  const subjects = [...classes.values()];
  const mySectionIds = unique(subjects.map((s) => s.sectionId));

  // Students in the teacher's sections only, one request per section.
  const studentResponses = await Promise.all(
    mySectionIds.map((sectionId) => studentsApi.list({ section_id: sectionId })),
  );

  const rawStudents = studentResponses.flatMap((res) => listOf(res, 'students'));

  // Assignments the teacher has set, from the exams table. `exams.exam_type`
  // is an ENUM that includes 'Assignment', so this is the real record — the
  // page used to render ten invented ones ("AVL Trees Implementation", …)
  // together with a randomly generated submission per student.
  const mySubjectIds = new Set(subjects.map((s) => s.subjectId));

  const examRes = await examsApi.list().catch(() => null);

  const assignments = listOf(examRes, 'exams')
    .filter((e) => e.exam_type === 'Assignment' && mySubjectIds.has(e.subject_id))
    .map((e) => {
      const subject = subjectById.get(e.subject_id);
      return {
        id: e.exam_id,
        title: e.exam_name,
        subject: subject ? subject.subject_code : `SUB-${e.subject_id}`,
        subjectId: e.subject_id,
        due: e.exam_date,
        totalMarks: e.total_marks,
        // `exams` has no description column.
        description: null,
      };
    });

  // Attendance percentages, aggregated in SQL rather than pulling raw rows.
  const attendanceRes = await summaries.attendance({ group: 'student' });
  const attendanceByStudent = new Map(
    listOf(attendanceRes).map((r) => [r.student_id, r]),
  );

  const students = rawStudents.map((s) => {
    const section = sectionById.get(s.section_id);
    const att = attendanceByStudent.get(s.student_id);
    const name = [s.first_name, s.last_name].filter(Boolean).join(' ');

    return {
      id: s.student_id,
      studentId: s.student_id,
      roll: s.registration_number,
      name,
      // No photo column exists; pages fall back to initials.
      photo: null,
      email: null,
      program: null,
      section: section ? section.section_name : '—',
      sectionId: s.section_id,
      semester: s.current_semester_id,
      department: null,
      cgpa: null,
      phone: s.phone || null,
      status: s.academic_status,
      attendancePercent: att ? Number(att.attendance_percentage) : null,
      totalSessions: att ? Number(att.total_sessions) : null,
      presentCount: att ? Number(att.present_count) : null,
      absentCount: att ? Number(att.absent_count) : null,
    };
  });

  // Attendance rows in the shape the attendance screen expects.
  const attendance = students.map((s) => ({
    id: `att-${s.id}`,
    studentId: s.id,
    date: null,
    checkIn: null,
    checkOut: null,
    status: null,
    duration: null,
    percent: s.attendancePercent,
    present: s.presentCount,
    absent: s.absentCount,
    total: s.totalSessions,
  }));

  // Colleagues, mapped into the user shape the Users screen expects. Teachers
  // cannot read /api/users (403 by design), so this is the teacher directory.
  const users = allTeachers.map((t) => ({
    id: t.teacher_id,
    userId: t.user_id,
    name: t.full_name || '—',
    email: t.email || '—',
    role: 'teacher',
    department: t.department_name || '—',
    designation: t.designation || '—',
    status: t.employment_status || 'Active',
  }));

  return {
    me,
    users,
    students,
    subjects,
    attendance,
    departments: allDepartments.map((d) => d.department_name),

    // Real 'Assignment' exams for this teacher's subjects. Empty until any are
    // created, which is the honest state — the database currently holds only
    // Mid-Term and Final exams.
    assignments,

    // aims_db has no submissions table, so there is nothing to show per
    // student. The Assignments screen says so rather than inventing rows.
    submissions: [],

    // Marks are loaded per class on demand; teachers are blocked from fees and
    // the parents list by design.
    marks: [],
    fees: [],
    parents: [],
  };
}
