/*
 * Every query key in the product, in one file.
 *
 * WHY A FACTORY AND NOT INLINE ARRAYS
 * -----------------------------------
 * A cache key is a contract between two screens that have never heard of each
 * other. Faculty Attendance and Faculty Marks both need the class list for the
 * signed-in teacher; they share one request only if they spell the key
 * identically. Written inline at each call site, `['classes']` in one file and
 * `['faculty-classes']` in another look equally correct and silently defeat the
 * cache — which is the exact failure this whole change exists to remove,
 * reintroduced by a typo.
 *
 * It also makes invalidation possible to reason about. After a write, a screen
 * has to say what is now wrong. Keys are built as tuples that widen from left
 * to right, so `keys.students.all` invalidates every students query including
 * every filtered page of it, while `keys.students.list(params)` invalidates
 * only the one page. Guessing that prefix by hand at each call site is how
 * stale rows survive a save.
 */

/* ── reference data ─────────────────────────────────────────────────────────
   Rarely edited, needed by nearly every screen for its dropdowns. These are
   the keys that carried the most duplicated traffic. */
export const reference = {
  departments: () => ['ref', 'departments'],
  programs: () => ['ref', 'programs'],
  batches: () => ['ref', 'batches'],
  sections: () => ['ref', 'sections'],
  subjects: () => ['ref', 'subjects'],
  semesters: () => ['ref', 'semesters'],
  classrooms: () => ['ref', 'classrooms'],
  terms: () => ['ref', 'terms'],
  academicsOverview: () => ['ref', 'academics-overview'],
  timetableSlots: () => ['ref', 'timetable-slots'],
  all: ['ref'],
};

/* ── the signed-in account ─────────────────────────────────────────────────
   `me` and `preferences` are read by every top bar and every settings screen
   in all four portals, which is why preferences alone went out 20 times in a
   ten-page walk. */
export const account = {
  me: () => ['account', 'me'],
  preferences: () => ['account', 'preferences'],
  all: ['account'],
};

export const notifications = {
  /*
   * Call this with NO arguments. The signed-in user has one notification feed
   * and every surface shares it.
   *
   * It used to be called as `list({ limit })`, which put the page size in the
   * key: the bell asked for 20, the notifications page asked for 50, and the
   * two held separate caches of the same rows. Marking something read on one
   * did not clear the badge on the other. `params` is kept only so the
   * signature matches every other factory in this file; passing anything
   * splits the cache again. See api/notificationsData.js.
   */
  list: (params) => ['notifications', 'list', params ?? {}],
  unreadCount: () => ['notifications', 'unread-count'],
  all: ['notifications'],
};

/* ── admin ─────────────────────────────────────────────────────────────── */
export const students = {
  list: (params) => ['students', 'list', params ?? {}],
  one: (id) => ['students', 'one', id ?? null],
  documents: (id) => ['students', 'documents', id ?? null],
  all: ['students'],
};

export const teachers = {
  list: (params) => ['teachers', 'list', params ?? {}],
  one: (id) => ['teachers', 'one', id ?? null],
  qualifications: () => ['teachers', 'qualifications'],
  all: ['teachers'],
};

export const parents = {
  list: (params) => ['parents', 'list', params ?? {}],
  children: (id) => ['parents', 'children', id ?? null],
  all: ['parents'],
};

export const fees = {
  overview: (params) => ['fees', 'overview', params ?? {}],
  structures: () => ['fees', 'structures'],
  vouchers: (studentId) => ['fees', 'vouchers', studentId ?? null],
  challans: (params) => ['fees', 'challans', params ?? {}],
  all: ['fees'],
};

export const attendance = {
  adminOverview: (params) => ['attendance', 'admin-overview', params ?? {}],
  register: (classKey, date) => ['attendance', 'register', classKey ?? null, date ?? null],
  student: (studentId, params) => ['attendance', 'student', studentId ?? null, params ?? {}],
  trend: (classKey, grain) => ['attendance', 'trend', classKey ?? null, grain ?? 'weekly'],
  all: ['attendance'],
};

export const exams = {
  list: (params) => ['exams', 'list', params ?? {}],
  sheet: (examId, sectionId) => ['exams', 'sheet', examId ?? null, sectionId ?? null],
  results: (params) => ['exams', 'results', params ?? {}],
  all: ['exams'],
};

export const timetable = {
  current: (params) => ['timetable', 'current', params ?? {}],
  forSection: (sectionId) => ['timetable', 'section', sectionId ?? null],
  forTeacher: (teacherId) => ['timetable', 'teacher', teacherId ?? null],
  management: (params) => ['timetable', 'management', params ?? {}],
  all: ['timetable'],
};

export const announcements = {
  list: (params) => ['announcements', 'list', params ?? {}],
  all: ['announcements'],
};

export const users = {
  list: (params) => ['users', 'list', params ?? {}],
  staffAccounts: (params) => ['users', 'staff-accounts', params ?? {}],
  audit: (params) => ['users', 'audit', params ?? {}],
  all: ['users'],
};

export const dashboard = {
  admin: () => ['dashboard', 'admin'],
  faculty: () => ['dashboard', 'faculty'],
  student: () => ['dashboard', 'student'],
  parent: (childId) => ['dashboard', 'parent', childId ?? null],
  all: ['dashboard'],
};

/* ── faculty ───────────────────────────────────────────────────────────── */
export const faculty = {
  /*
   * `data` is the composite document FacultyDataContext loads — timetable,
   * sections, students and their attendance in one call. `classes` is the far
   * smaller GET /api/faculty/classes, which four screens ask for on their own
   * (My Classes, Reports, Attendance, Marks). Two different requests, so two
   * different keys; sharing one would have made every screen that wanted the
   * class dropdown pull the whole composite document.
   */
  data: () => ['faculty', 'data'],
  classes: () => ['faculty', 'classes'],
  exams: () => ['faculty', 'exams'],
  badges: () => ['faculty', 'badges'],
  students: (params) => ['faculty', 'students', params ?? {}],
  assignments: (params) => ['faculty', 'assignments', params ?? {}],
  reports: (params) => ['faculty', 'reports', params ?? {}],
  all: ['faculty'],
};

/* ── student ───────────────────────────────────────────────────────────── */
export const student = {
  profile: () => ['student', 'profile'],
  courses: () => ['student', 'courses'],
  courseDetail: (code) => ['student', 'course', code ?? null],
  attendance: (params) => ['student', 'attendance', params ?? {}],
  result: (params) => ['student', 'result', params ?? {}],
  fees: () => ['student', 'fees'],
  timetable: () => ['student', 'timetable'],
  documents: () => ['student', 'documents'],
  all: ['student'],
};

/* ── parent ────────────────────────────────────────────────────────────── */
export const parent = {
  children: () => ['parent', 'children'],
  childProfile: (childId) => ['parent', 'child', childId ?? null],
  attendance: (childId) => ['parent', 'attendance', childId ?? null],
  results: (childId) => ['parent', 'results', childId ?? null],
  fees: (childId) => ['parent', 'fees', childId ?? null],
  timetable: (childId) => ['parent', 'timetable', childId ?? null],
  all: ['parent'],
};

/*
 * The generic escape hatch, for a screen whose request does not belong to any
 * resource above. Still goes through this file so that every key in the
 * product is discoverable in one place.
 */
export const adhoc = (name, params) => ['adhoc', name, params ?? {}];

export default {
  reference, account, notifications, students, teachers, parents, fees,
  attendance, exams, timetable, announcements, users, dashboard,
  faculty, student, parent, adhoc,
};
