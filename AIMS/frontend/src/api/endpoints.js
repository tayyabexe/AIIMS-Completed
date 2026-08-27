// Named functions for every backend route the frontend uses.
//
// Every path here was read off backend/src/routes/*.js — nothing is invented.
// Screens import from this file so no component ever hardcodes a URL, and a
// backend path change is a one-line fix here.

import { get, post, put, patch, del, query } from './client';

// ------------------------------------------------------------------- auth
export const auth = {
  /*
   * `portal` is the sign-in screen this attempt came from, and it is sent so
   * the SERVER can refuse an account that belongs elsewhere.
   *
   * It used to be checked only here in the browser, after a successful call:
   * the API returned 200 with a working token and AuthContext threw it away.
   * The user was stopped, but the 200 had already confirmed the password to
   * anyone reading the network tab. Optional on the backend, so an older
   * client still works.
   */
  login: (email, password, portal) =>
    post('/api/auth/login', { email, password, ...(portal ? { portal } : {}) }),
  register: (payload) => post('/api/auth/register', payload),
  logout: () => post('/api/auth/logout'),
  profile: () => get('/api/auth/profile'),
  changePassword: (currentPassword, newPassword) =>
    put('/api/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (email) => post('/api/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) =>
    post('/api/auth/reset-password', { token, newPassword }),
};

// Parents authenticate through their own endpoint, which returns the parent
// record alongside the token instead of a users row.
export const parentAuth = {
  login: (email, password) => post('/api/parent/login', { email, password }),
};

// ------------------------------------------------------------------ users
export const users = {
  // --- own account (every portal's Profile screen) ---
  // These resolve the account from the token, so they are the only user
  // routes a student, teacher or parent can call; /api/users/:id is Admin-only.
  me: () => get('/api/users/me'),
  // Accepts email and phone only. Role and active flags stay administrative.
  updateMe: (payload) => put('/api/users/me', payload),
  // --- settings ---
  // One JSON document of preferences per account, self-scoped by the token.
  // Only settings the app can actually honour are stored; see
  // backend/src/services/userPreferenceService.js.
  preferences: () => get('/api/users/me/preferences'),
  // Partial documents are merged server-side, so a card can save itself alone.
  updatePreferences: (payload) => put('/api/users/me/preferences', payload),

  // multipart/form-data with the file under the field name "profile_picture".
  // Max 1MB, JPEG/PNG/WEBP/GIF. Returns the stored public path.
  // The same 1MB is enforced in the browser by AvatarUploader, before the
  // crop stage, so an oversized file never reaches this call.
  uploadProfilePicture: (file) => {
    const form = new FormData();
    form.append('profile_picture', file);
    return post('/api/users/me/profile-picture', form);
  },
  deleteProfilePicture: () => del('/api/users/me/profile-picture'),

  // --- administrative ---
  // Filters: role_id, is_active, email (partial), page, limit.
  list: (filters) => get(`/api/users${query(filters)}`),
  byId: (id) => get(`/api/users/${id}`),
  create: (payload) => post('/api/users', payload),
  update: (id, payload) => put(`/api/users/${id}`, payload),
  remove: (id) => del(`/api/users/${id}`),
  // Lifts a lockout imposed by five failed sign-ins. Admin-only, and the only
  // way such an account gets back in — there is no timer.
  unlock: (id) => post(`/api/users/${id}/unlock`),
};

// --------------------------------------------------------------- students
export const students = {
  /*
   * What a student is taking this term, who teaches each class, and where and
   * when it meets. The server pins a student caller to their own record, so
   * the id in the URL cannot be used to read a classmate's.
   */
  classes: (studentId, filters) =>
    get(`/api/students/${studentId}/classes${query(filters)}`),
  // The signed-in student's own record, resolved from the token.
  me: () => get('/api/students/me'),
  // Self-service contact-detail edit from the student portal.
  updateMe: (payload) => put('/api/students/me', payload),
  list: (filters) => get(`/api/students${query(filters)}`),
  search: (filters) => get(`/api/students/search${query(filters)}`),
  byId: (id) => get(`/api/students/${id}`),
  documents: (studentId) => get(`/api/students/documents/${studentId}`),
  guardians: (studentId) => get(`/api/students/guardians/${studentId}`),
  register: (payload) => post('/api/students/register', payload),
  uploadDocument: (formData) => post('/api/students/upload-document', formData),
  enroll: (id, payload) => put(`/api/students/${id}/enroll`, payload),
  // Admin edit. Only the keys present in `payload` are written, so a form that
  // shows six fields cannot blank a seventh it never rendered. Accepts
  // first/last name, phone, dob, gender, address, nationality, blood_group,
  // program_id, batch_id, section_id, current_semester_id, academic_status.
  update: (id, payload) => put(`/api/students/${id}`, payload),
  removeDocument: (documentId) => del(`/api/students/documents/${documentId}`),
  remove: (id) => del(`/api/students/${id}`),
  /*
   * Undoes a soft delete. The student comes back with the academic_status they
   * had when they were removed — reinstating somebody and deciding what they
   * are now are two acts, and each leaves its own audit entry.
   *
   * The deleted students themselves are listed by
   * admin.students({ deleted: 'only' }).
   */
  restore: (id) => post(`/api/students/${id}/restore`),
};

// ---------------------------------------------------------------- parents
export const parents = {
  // Admin-facing list with each parent's linked children.
  // Filters: first_name, last_name, phone, page, limit.
  list: (filters) => get(`/api/parents${query(filters)}`),

  profile: () => get('/api/parent/profile'),
  children: () => get('/api/parent/children'),
  attendance: () => get('/api/parent/attendance'),
  // One settled fee position per child. Replaces feeStatus/challan/receipt,
  // which were three partial views of two unlinked billing tables.
  fees: () => get('/api/parent/fees'),
  timetable: () => get('/api/parent/timetable'),
  results: () => get('/api/parent/results'),
  gpaCgpa: () => get('/api/parent/gpa-cgpa'),
  notifications: () => get('/api/parent/notifications'),
};

// ---------------------------------------------------------- announcements
// Non-admin callers only receive announcements addressed to their own role or
// to everyone; that filtering happens on the server.
export const announcements = {
  // Filters: target_role (admin only), page, limit.
  list: (filters) => get(`/api/announcements${query(filters)}`),
  byId: (id) => get(`/api/announcements/${id}`),
  create: (payload) => post('/api/announcements', payload),
  update: (id, payload) => put(`/api/announcements/${id}`, payload),
  remove: (id) => del(`/api/announcements/${id}`),
};

// ------------------------------------------------------------- searching
// One role-scoped endpoint for every portal. `resources()` reports what the
// signed-in role may search, so a portal builds its filters from the same
// registry the queries use instead of a hardcoded list.
export const search = {
  // params: q, type, page, limit, plus any exact field filter the resource
  // declares (e.g. program_id, status, registration_number).
  run: (params) => get(`/api/search${query(params)}`),
  resources: () => get('/api/search/resources'),
};

// ---------------------------------------------------------- notifications
// Self-scoped by the token: each portal sees only its own user's rows.
export const notifications = {
  // Filters: is_read ('true'|'false'), type, limit.
  list: (filters) => get(`/api/notifications${query(filters)}`),
  markRead: (id) => put(`/api/notifications/${id}/read`),
  markAllRead: () => put('/api/notifications/read-all'),
};

// --------------------------------------------------------------- teachers
export const teachers = {
  list: () => get('/api/teachers'),
  byId: (id) => get(`/api/teachers/${id}`),
  create: (payload) => post('/api/teachers', payload),
  update: (id, payload) => put(`/api/teachers/${id}`, payload),
  remove: (id) => del(`/api/teachers/${id}`),
};

export const teacherProfiles = {
  list: () => get('/api/teacher-profiles'),
  byId: (id) => get(`/api/teacher-profiles/${id}`),
  create: (payload) => post('/api/teacher-profiles', payload),
  update: (id, payload) => put(`/api/teacher-profiles/${id}`, payload),
  remove: (id) => del(`/api/teacher-profiles/${id}`),
};

export const teacherDashboard = {
  byId: (teacherId) => get(`/api/teacher-dashboard/${teacherId}`),
};

/*
 * ----------------------------------------------------------- teacher portal
 *
 * The faculty portal's own surface. Every route resolves the teacher from the
 * token, so none of them takes an id — the one optional filter is
 * `teacher_id`, which only an Admin may use to open a named teacher's portal.
 *
 * These replace what the Dashboard, My Classes and Attendance screens used to
 * do: pull /api/timetables, /api/students, /api/subjects and /api/sections in
 * full and work the teacher's own classes out in the browser.
 */
export const faculty = {
  // Today's lectures, headline counts, per-class attendance rates, the grade
  // distribution over this teacher's subjects, and the students below the
  // attendance threshold — all counted in SQL.
  dashboard: (filters) => get(`/api/faculty/dashboard${query(filters)}`),

  // Own notification rows merged with the announcements addressed to this
  // role, so the card is populated by the notices board even before any
  // per-user notification has been generated.
  notifications: (filters) => get(`/api/faculty/notifications${query(filters)}`),

  // Registers marked, marks entered, exams on this teacher's subjects and
  // announcements they posted — reconstructed from `attendance.marked_by`,
  // `marks.entered_by`, `exams` and `announcements.posted_by`.
  activity: (filters) => get(`/api/faculty/activity${query(filters)}`),

  // One entry per subject+section taught, with its weekly slots, room and
  // roster size.
  classes: (filters) => get(`/api/faculty/classes${query(filters)}`),

  // A class with its students, each carrying their real attendance rate and
  // marks total for that subject.
  classRoster: (subjectId, sectionId, filters) =>
    get(`/api/faculty/classes/${subjectId}/${sectionId}${query(filters)}`),

  // The register for one class on one date. Students with nothing recorded
  // come back with status null — "not marked yet", not "absent".
  attendanceSheet: (filters) => get(`/api/faculty/attendance${query(filters)}`),

  // Saves a whole register at once; re-submitting the same day updates the
  // existing rows rather than failing on the duplicate key.
  saveAttendance: (payload) => post('/api/faculty/attendance', payload),

  // Day-by-day counts over a date range, for the attendance trend chart.
  attendanceTrend: (filters) => get(`/api/faculty/attendance/trend${query(filters)}`),

  // --- marks ---
  // Exams on this teacher's subjects, each with how many marks are entered and
  // which of their sections take the subject.
  exams: (filters) => get(`/api/faculty/exams${query(filters)}`),
  // Scoped create: /api/exams takes any subject_id, this one checks the
  // subject is the caller's before writing.
  createExam: (payload) => post('/api/faculty/exams', payload),
  // One exam's sheet for one section. A student with nothing entered comes
  // back with obtained_marks null — not zero.
  marksSheet: (filters) => get(`/api/faculty/marks${query(filters)}`),
  // Bulk upsert on the (exam_id, student_id) unique key, as Draft or Published.
  saveMarks: (payload) => post('/api/faculty/marks', payload),

  // --- students ---
  // The teacher's own students with programme, department, semester, email,
  // CGPA, attendance and marks, plus totals and the filter option lists.
  students: (filters) => get(`/api/faculty/students${query(filters)}`),

  // --- reports ---
  // type: attendance | marks | grades | assignments | student-performance |
  // class-summary. Generated in SQL so the screen and the export agree.
  report: (filters) => get(`/api/faculty/reports${query(filters)}`),

  // --- profile ---
  // The signed-in teacher's record: identity from employees/users, teaching
  // load from their own timetable, and the semester currently running on the
  // programmes they teach.
  profile: (filters) => get(`/api/faculty/profile${query(filters)}`),
  // Contact details and specialization only. Name, designation and department
  // are HR data and are refused here.
  updateProfile: (payload) => put('/api/faculty/profile', payload),

  // --- sidebar bubbles ---
  // { notifications, assignments, latest_assignment_id }. `assignments` counts
  // what has appeared since the watermark in the user's preferences, which the
  // Assignments screen advances when it opens.
  badges: (filters) => get(`/api/faculty/badges${query(filters)}`),
};

/*
 * ------------------------------------------------------------- admin portal
 *
 * One endpoint per admin screen, mirroring what /api/faculty does for the
 * teachers' portal.
 *
 * These replace the ten general-purpose list calls the portal used to fire in
 * parallel the moment an admin signed in — 3.04 MB and about 6.5 seconds of
 * database work before a single screen had rendered, paid whether the admin
 * went on to open Students or Settings. Each function below returns only its
 * own screen's columns, filtered and paginated by the server.
 *
 * Shared filters: page, limit (max 200), plus q / program_id / batch_id /
 * section_id / semester_id / status where the screen offers them. Every list
 * response is { rows, pagination: { page, limit, total, pages } }.
 */
export const admin = {
  // Stat tiles only — SQL aggregates, a few hundred bytes.
  dashboard: () => get('/api/admin/dashboard'),

  /*
   * The dashboard activity feed, newest first. Two kinds of row merged into
   * one list:
   *   - audit entries (`type: 'audit'`) — a named person did something, already
   *     phrased server-side so the feed and the audit page cannot disagree;
   *   - system events — announcements, verified payments, published results and
   *     new enrolments.
   */
  activity: (filters) => get(`/api/admin/activity${query(filters)}`),

  // Students list. Also returns `options` (programs/batches/sections) for the
  // filter bar, so the screen does not need three more requests to draw it.
  // `deleted: 'only'` lists soft-deleted students instead of live ones — the
  // one way to reach a student who can be restored.
  students: (filters) => get(`/api/admin/students${query(filters)}`),

  // Every student matching the CURRENT filters, for CSV / PDF / ID cards.
  // Deliberately bulk, and only ever called from an explicit Export click.
  exportStudents: (filters) => get(`/api/admin/students/export${query(filters)}`),

  // One student's full profile: contact, guardian, fee position, attendance,
  // academic standing, documents and enrolled courses.
  student: (id) => get(`/api/admin/students/${id}`),

  // Attendance register. Extra filters: risk=low|good, sort=attendance.
  // `summary` carries the institute-wide buckets, independent of the page.
  attendance: (filters) => get(`/api/admin/attendance${query(filters)}`),

  // Fee table plus totals, category distribution and monthly collection.
  // Extra filters: fee_status=Paid|Partial|Unpaid|Overdue, sort=due.
  fees: (filters) => get(`/api/admin/fees${query(filters)}`),

  // Exam standing plus grade distribution, per-programme aggregates and the
  // institute's grading ladder.
  examination: (filters) => get(`/api/admin/examination${query(filters)}`),

  // Parents with their linked children. Filter: q.
  parents: (filters) => get(`/api/admin/parents${query(filters)}`),

  // Teacher directory with real weekly load. Filters: q, department_id.
  teachers: (filters) => get(`/api/admin/teachers${query(filters)}`),

  // Risk cohorts counted institute-wide, plus the named at-risk students.
  aiAnalytics: (filters) => get(`/api/admin/ai-analytics${query(filters)}`),

  // Institute-wide reporting aggregates. No student rows cross the wire.
  reports: () => get('/api/admin/reports'),

  /*
   * The audit trail: who created which account, who issued which password, who
   * approved which payment.
   *
   * Filters: q (free text over actor, entity and both snapshots), module,
   * action, user_id, from, to, page, limit.
   *
   * Each row arrives with `label`, `subject` and `count` already worked out
   * server-side, plus the raw `action`/`before`/`after` for the detail view.
   * `options.modules` and `options.actions` list what the table actually
   * contains, so a filter cannot offer a value that matches nothing.
   *
   * There is deliberately no write counterpart — entries are produced by the
   * services performing the acts, and nothing in the API can amend or delete
   * one. A log an administrator can edit answers no question worth asking.
   */
  auditLogs: (filters) => get(`/api/admin/audit-logs${query(filters)}`),

  /*
   * ---------------------------------------------------------- provisioning
   *
   * These three create people AND their logins in one transaction, and each
   * returns a generated password EXACTLY ONCE — in this response and nowhere
   * else. The stored value is a bcrypt hash, so no later request can read it
   * back. Show it to the admin immediately; if they lose it, `reissue` is the
   * only remedy.
   */

  /*
   * Admit a student. Generates the registration number and the student's login,
   * and creates OR LINKS the parent.
   *
   * payload: { first_name, last_name, cnic_bform, program_id, batch_id,
   *            section_id?, current_semester_id?, gender?, phone?, dob?,
   *            address?, nationality?, blood_group?, registration_number?,
   *            parent?: { first_name, last_name, email, phone?, relationship? } }
   *
   * `registration_number` is optional and exists for bulk import: an institute
   * migrating records already knows each student's number, and having one
   * generated over the top would break every document issued against it. Left
   * out — which is what the single-admission form does — the next number in the
   * institute's own sequence is allocated. A supplied number is checked for
   * uniqueness inside the transaction and refused with 409 if it is taken.
   *
   * The parent is matched by email. An email already belonging to a parent is
   * LINKED to the new student — no second account, and their existing password
   * keeps working. `parent.created` in the response says which happened, so the
   * screen knows whether there is a parent password to hand over.
   */
  admitStudent: (payload) => post('/api/admin/students/admit', payload),

  /*
   * Onboard a teacher: writes the users, employees and teachers rows plus any
   * class assignments, and returns the teacher's credentials.
   *
   * payload: { first_name, last_name, email?, phone?, department_id?,
   *            designation?, specialization?, basic_salary?, hire_date?,
   *            assignments?: [{ subject_id, batch_id, section_id? }] }
   *
   * `email` is optional — one is generated in the institute's own format when
   * it is left out.
   */
  onboardTeacher: (payload) => post('/api/admin/teachers/onboard', payload),

  // Issue a NEW password for an existing account, for when the one-time popup
  // was closed before anyone wrote it down. The old one cannot be recovered.
  reissueCredentials: (userId) => post(`/api/admin/credentials/${userId}/reissue`),

  /*
   * Enrolment counts at every level — department, programme, batch, section,
   * semester — in ONE response, so the levels cannot disagree with each other.
   * Filters: department_id, program_id, batch_id, section_id, semester_id.
   *
   * TWO DIFFERENT NUMBERS LIVE IN HERE AND THEY ARE NOT THE SAME THING.
   * A student count is people; a course-enrolment count is registrations. The
   * ~2,000 students in this database carry ~10,000 course registrations between
   * them, so a screen that shows one under the other's label is out by a factor
   * of five. The roster behind any figure comes from `students` below with the
   * same filters.
   */
  enrollment: (filters) => get(`/api/admin/enrollment${query(filters)}`),

  /*
   * -------------------------------------------------------- people (CRUD)
   *
   * Staff accounts and parents — the two kinds of person nothing could amend or
   * remove until now. See backend/src/services/peopleAdminService.js.
   *
   * Three rules the server enforces and the screens must surface rather than
   * hide: nobody may delete or deactivate their own account, only a Super Admin
   * may touch a Super Admin row or grant that role, and a parent who is still
   * the guardian of a student cannot be deleted (409 with `blockedBy` naming
   * the children).
   *
   * `admins` covers every staff role — Super Admin, Admin, HR, Accountant and
   * Library Staff — not just the two called "admin". Filters: q, role_id,
   * is_active.
   */
  admins: (filters) => get(`/api/admin/admins${query(filters)}`),

  // Returns the one-time password in `credentials`, exactly like the
  // provisioning routes above. It cannot be read back afterwards.
  createAdmin: (payload) => post('/api/admin/admins', payload),
  updateAdmin: (userId, payload) => put(`/api/admin/admins/${userId}`, payload),

  // Soft-deletes the row AND disables the login — both, so a "deleted" person
  // cannot still sign in.
  removeAdmin: (userId) => del(`/api/admin/admins/${userId}`),

  // The parent list is `admin.parents` above; these are the writes it never had.
  createParent: (payload) => post('/api/admin/parents', payload),
  updateParent: (parentId, payload) => put(`/api/admin/parents/${parentId}`, payload),
  removeParent: (parentId) => del(`/api/admin/parents/${parentId}`),

  /*
   * The guardian link itself: `student_guardians`, written once by an admission
   * and, until now, never correctable. relationship is Father | Mother |
   * Guardian. A student may have more than one guardian and a guardian more
   * than one student, so linking adds a row rather than replacing one.
   */
  linkChild: (parentId, payload) => post(`/api/admin/parents/${parentId}/children`, payload),
  unlinkChild: (parentId, studentId) =>
    del(`/api/admin/parents/${parentId}/children/${studentId}`),
};

export const teacherSchedules = {
  list: (filters) => get(`/api/teacher-schedules${query(filters)}`),
  byId: (id) => get(`/api/teacher-schedules/${id}`),
  create: (payload) => post('/api/teacher-schedules', payload),
  update: (id, payload) => put(`/api/teacher-schedules/${id}`, payload),
  remove: (id) => del(`/api/teacher-schedules/${id}`),
};

export const teacherAssignments = {
  list: (filters) => get(`/api/teacher-assignments${query(filters)}`),
  byId: (id) => get(`/api/teacher-assignments/${id}`),
  create: (payload) => post('/api/teacher-assignments', payload),
  update: (id, payload) => put(`/api/teacher-assignments/${id}`, payload),
  remove: (id) => del(`/api/teacher-assignments/${id}`),
};

/*
 * The qualification registry: which subjects each teacher MAY teach.
 *
 * Not the same thing as who teaches what — that is `offerings`, where a class
 * is one section studying one subject with one teacher in one term. This
 * registry has no term, no section and no batch; it is a standing fact about a
 * person, and it is what sorts the staffing shortlist.
 *
 * `list` returns one row per teacher with their subjects nested, because the
 * editor saves a teacher's whole set at once. Filters: teacher_id,
 * department_id, q, unqualified_only=1.
 */
export const teacherSubjects = {
  list: (filters) => get(`/api/teacher-subjects${query(filters)}`),
  // The registry read from the staffing direction: who may teach this subject.
  forSubject: (subjectId) => get(`/api/teacher-subjects/subject/${subjectId}`),
  // Idempotent — answers { outcome: 'added' | 'already_recorded' }.
  assign: (payload) => post('/api/teacher-subjects', payload),
  // The whole set for one teacher, replaced in one transaction.
  setForTeacher: (teacherId, subjectIds) =>
    put(`/api/teacher-subjects/teacher/${teacherId}`, { subject_ids: subjectIds }),
  /*
   * No batch id: qualification is not batch-scoped. Refuses with 409 while the
   * teacher still holds a live class in the subject, and the response names
   * those classes in `details.classes`.
   */
  remove: (teacherId, subjectId) =>
    del(`/api/teacher-subjects/${teacherId}/${subjectId}`),
};

// -------------------------------------------------------- academic setup
/*
 * The academic structure — departments, programmes, batches, sections, ROOMS
 * and semesters — is one module on the server, so the six groups below share
 * one contract:
 *
 *   - every list row carries live counts from the tables pointing at it, which
 *     is what makes "can I delete this?" answerable before the attempt;
 *   - every delete refuses with 409 while the row is still referenced, and the
 *     response carries a `blockedBy` array naming each blocker. The screens
 *     render that text; it is never swallowed into a generic failure message.
 *
 * "Rooms" is what the UI calls `classrooms`: the table is the umbrella for
 * every teaching space, labs and halls included. A *section* is the cohort
 * (BSCS-2022-CS-4A), which is a different thing entirely.
 */
export const departments = {
  list: (filters) => get(`/api/departments${query(filters)}`),
  byId: (id) => get(`/api/departments/${id}`),
  create: (payload) => post('/api/departments', payload),
  update: (id, payload) => put(`/api/departments/${id}`, payload),
  remove: (id) => del(`/api/departments/${id}`),
};

// The rooms. This table had no endpoint at all until the structure module
// landed, which is why no screen could ever add one.
export const classrooms = {
  list: (filters) => get(`/api/classrooms${query(filters)}`),
  byId: (id) => get(`/api/classrooms/${id}`),
  create: (payload) => post('/api/classrooms', payload),
  update: (id, payload) => put(`/api/classrooms/${id}`, payload),
  remove: (id) => del(`/api/classrooms/${id}`),
};

/*
 * The whole structure in ONE request: departments, programmes, batches,
 * sections, semesters, rooms and institute-wide totals, each with its counts.
 *
 * Six small tables, so one call rather than six — and, more importantly, one
 * snapshot: six separate requests can disagree with each other about how many
 * students a batch has if a write lands between them.
 */
export const academics = {
  overview: () => get('/api/academics/overview'),
};

export const subjects = {
  list: (filters) => get(`/api/subjects${query(filters)}`),
  search: (filters) => get(`/api/subjects/search${query(filters)}`),
  byId: (id) => get(`/api/subjects/${id}`),
  create: (payload) => post('/api/subjects', payload),
  update: (id, payload) => put(`/api/subjects/${id}`, payload),
  remove: (id) => del(`/api/subjects/${id}`),
};

// Filters: department_id, q.
export const programs = {
  list: (filters) => get(`/api/programs${query(filters)}`),
  search: (filters) => get(`/api/programs/search${query(filters)}`),
  byId: (id) => get(`/api/programs/${id}`),
  create: (payload) => post('/api/programs', payload),
  update: (id, payload) => put(`/api/programs/${id}`, payload),
  remove: (id) => del(`/api/programs/${id}`),
};

// Filters: program_id, department_id, semester_id, q. `semester_id` means
// "the batches whose students are sitting in that semester right now" — a batch
// belongs to a programme, not to a term.
export const batches = {
  list: (filters) => get(`/api/batches${query(filters)}`),
  byId: (id) => get(`/api/batches/${id}`),
  create: (payload) => post('/api/batches', payload),
  update: (id, payload) => put(`/api/batches/${id}`, payload),
  remove: (id) => del(`/api/batches/${id}`),
};

// Filters: batch_id, program_id, department_id, q.
export const sections = {
  list: (filters) => get(`/api/sections${query(filters)}`),
  byId: (id) => get(`/api/sections/${id}`),
  create: (payload) => post('/api/sections', payload),
  update: (id, payload) => put(`/api/sections/${id}`, payload),
  remove: (id) => del(`/api/sections/${id}`),
};

/*
 * Semester 4 exists once per programme, so each row carries its programme.
 *
 * `semesters` has no is_deleted column — it has is_archived — so `remove` here
 * is a REAL delete, and the server refuses it while any subject, enrolment,
 * voucher or currently-enrolled student still points at the row. Archiving
 * (update with is_archived) is the reversible alternative and is what the
 * structure screen leads with.
 *
 * Archived terms are hidden from the list unless include_archived=1, because
 * every dropdown in the portal reads this endpoint and should not offer a term
 * that has been closed.
 */
export const semesters = {
  list: (filters) => get(`/api/semesters${query(filters)}`),
  byId: (id) => get(`/api/semesters/${id}`),
  create: (payload) => post('/api/semesters', payload),
  update: (id, payload) => put(`/api/semesters/${id}`, payload),
  remove: (id) => del(`/api/semesters/${id}`),
};

export const timetables = {
  list: (filters) => get(`/api/timetables${query(filters)}`),
  // Live, role-scoped schedule: resolves the caller's section (student) or
  // teacher id from the token and returns the whole week plus which entry is
  // running right now, evaluated in the institute's timezone on the server.
  current: (params) => get(`/api/timetables/current${query(params)}`),
  byId: (id) => get(`/api/timetables/${id}`),
  create: (payload) => post('/api/timetables', payload),
  update: (id, payload) => put(`/api/timetables/${id}`, payload),
  remove: (id) => del(`/api/timetables/${id}`),
};

// ------------------------------------------------- timetable management
/*
 * The scheduling module: terms, classes, staffing, cohort enrolment and
 * placement.
 *
 * `timetables` above is still the raw grid — it reads and writes rows. These
 * are the layer over it. The distinction that matters:
 *
 *   a TERM     is a year ("Fall 2026"). `semesters` is the curriculum stage a
 *              subject belongs to, shared by every batch that passes through
 *              it, so it could never say *when*.
 *   an OFFERING is one class — this section studies this subject with this
 *              teacher, this term. It is what makes "who teaches this student"
 *              a join instead of a guess.
 *   a SESSION  is one weekly meeting of an offering, on the period grid.
 */
export const terms = {
  list: (filters) => get(`/api/terms${query(filters)}`),
  // The term everything defaults to: Active, else the nearest Planned.
  current: () => get('/api/terms/current'),
  create: (payload) => post('/api/terms', payload),
  // Its own endpoint, not a field on an update: Active and Closed cascade over
  // every class and enrolment in the term.
  setStatus: (id, status) => patch(`/api/terms/${id}/status`, { status }),
};

export const offerings = {
  // Filters: term_id, section_id, subject_id, teacher_id, batch_id,
  // program_id, status, unstaffed. Term defaults to the current one.
  list: (filters) => get(`/api/offerings${query(filters)}`),
  byId: (id) => get(`/api/offerings/${id}`),
  create: (payload) => post('/api/offerings', payload),
  update: (id, payload) => patch(`/api/offerings/${id}`, payload),
  // Answers with { outcome: 'deleted' | 'cancelled' } — a class with
  // enrolments or attendance behind it is cancelled, never deleted.
  remove: (id) => del(`/api/offerings/${id}`),

  // Every class a section needs for one curriculum semester, in one call.
  createForSection: (payload) => post('/api/offerings/section', payload),
  enrolSection: (payload) => post('/api/offerings/section/enrol', payload),

  // Who *could* teach this: the whole faculty, with the ones recorded in
  // teacher_subjects flagged is_qualified, plus each one's current load.
  eligibleTeachers: (id) => get(`/api/offerings/${id}/teachers`),
  assignTeacher: (id, teacherId) =>
    put(`/api/offerings/${id}/teacher`, { teacher_id: teacherId }),

  enrol: (id) => post(`/api/offerings/${id}/enrol`),
  roster: (id) => get(`/api/offerings/${id}/roster`),

  /*
   * The whole placement answer for one class: every day, every period, and
   * either the reasons it is blocked or the rooms that would work in it. The
   * grid renders straight from this — the admin picks from what is offered
   * rather than guessing and being refused.
   */
  placement: (id, params) => get(`/api/offerings/${id}/placement${query(params)}`),
  placeSession: (id, payload) => post(`/api/offerings/${id}/sessions`, payload),
};

export const scheduling = {
  // The admin's worklist: what is unstaffed, half-placed, or done.
  status: (filters) => get(`/api/scheduling/status${query(filters)}`),
  // The estate's week — which rooms are free when, and which stand empty.
  rooms: (filters) => get(`/api/scheduling/rooms${query(filters)}`),
  moveSession: (timetableId, payload) =>
    put(`/api/scheduling/sessions/${timetableId}`, payload),
  removeSession: (timetableId) => del(`/api/scheduling/sessions/${timetableId}`),
};

// ------------------------------------------------------------ enrollments
// The courses a student is registered for (`enrollments`), with the subject
// and semester joined in. This is the roster the portal reads: a section
// timetable includes subjects a given student is not taking, and a course list
// built from attendance rows silently drops a course nobody has marked yet.
export const enrollments = {
  // Filters: student_id (staff only), semester_id, subject_id, status.
  // A student caller is scoped to their own rows by the server.
  list: (filters) => get(`/api/enrollments${query(filters)}`),
  forStudent: (studentId, filters) =>
    get(`/api/enrollments/student/${studentId}${query(filters)}`),
};

// ------------------------------------------------------------- attendance
export const attendance = {
  list: (filters) => get(`/api/attendance${query(filters)}`),
  byId: (id) => get(`/api/attendance/${id}`),
  forStudent: (studentId) => get(`/api/attendance/student/${studentId}`),
  report: (studentId) => get(`/api/attendance/report/${studentId}`),
  percentage: (studentId) => get(`/api/attendance/percentage/${studentId}`),
  mark: (payload) => post('/api/attendance', payload),
  update: (id, payload) => put(`/api/attendance/${id}`, payload),
  remove: (id) => del(`/api/attendance/${id}`),
};

// ------------------------------------------------------ exams and results
export const exams = {
  list: (filters) => get(`/api/exams${query(filters)}`),
  byId: (id) => get(`/api/exams/${id}`),
  create: (payload) => post('/api/exams', payload),
  update: (id, payload) => put(`/api/exams/${id}`, payload),
  remove: (id) => del(`/api/exams/${id}`),
};

export const marks = {
  forStudent: (studentId) => get(`/api/marks/student/${studentId}`),

  /*
   * Every assessment the student's registered courses carry, graded or not,
   * grouped by subject.
   *
   * `forStudent` above reads the marks table, so it can only report sittings
   * somebody has already scored — an exam that has been scheduled and not yet
   * marked simply is not in it. This one is built on the enrolment roster with
   * exams and marks LEFT-joined onto it, so an ungraded sitting comes back with
   * `state: "pending"` (its date has passed) or `"scheduled"` (still ahead)
   * rather than disappearing. That distinction is the whole point of the parent
   * portal's assessment table: "no final exam" and "the final is not marked
   * yet" are opposite facts and used to render identically.
   */
  assessmentsForStudent: (studentId) =>
    get(`/api/marks/student/${studentId}/assessments`),
  // One aggregated exam score per student, for staff screens that list many
  // students. Optional filter: semester_id.
  summary: (filters) => get(`/api/marks/summary${query(filters)}`),
  enter: (payload) => post('/api/marks', payload),
  update: (id, payload) => put(`/api/marks/${id}`, payload),
  verify: (id) => put(`/api/marks/verify/${id}`),
};

export const results = {
  // The institute's real grading ladder (grades table), so no screen has to
  // invent its own percentage -> letter -> grade point mapping.
  gradingScale: () => get('/api/results/grades'),
  calculate: (payload) => post('/api/results/calculate', payload),
  cgpa: (studentId) => get(`/api/results/cgpa/${studentId}`),
  publish: (resultId) => put(`/api/results/publish/${resultId}`),
  transcript: (studentId) => get(`/api/results/transcript/${studentId}`),
  examReport: (examId) => get(`/api/results/report/${examId}`),

  /*
   * Semester result publishing — the step that turns marks into GPAs.
   *
   * `publishSemester` is the one to use, not `calculate` above: it runs
   * sp_publish_semester_results, which weights each subject by its credit
   * hours and carries the CGPA across previously published semesters.
   * `calculate` averages exams unweighted, ignores the semester it is given,
   * and sets CGPA equal to GPA.
   */
  publishableSemesters: () => get('/api/results/publishable-semesters'),
  semesterResults: (semesterId) => get(`/api/results/semester/${semesterId}`),
  publishSemester: (semesterId) => post('/api/results/publish-semester', { semester_id: semesterId }),
};

export const studentResults = {
  list: (filters) => get(`/api/student-results${query(filters)}`),
  byId: (id) => get(`/api/student-results/${id}`),
  create: (payload) => post('/api/student-results', payload),
  update: (id, payload) => put(`/api/student-results/${id}`, payload),
  remove: (id) => del(`/api/student-results/${id}`),
};

export const gpa = {
  list: (filters) => get(`/api/gpa${query(filters)}`),
  byId: (id) => get(`/api/gpa/${id}`),
  create: (payload) => post('/api/gpa', payload),
  update: (id, payload) => put(`/api/gpa/${id}`, payload),
  remove: (id) => del(`/api/gpa/${id}`),
};

// -------------------------------------------------------------- finances
export const feeStructures = {
  list: () => get('/api/fee-structures'),
  byId: (id) => get(`/api/fee-structures/${id}`),
  create: (payload) => post('/api/fee-structures', payload),
  update: (id, payload) => put(`/api/fee-structures/${id}`, payload),
  remove: (id) => del(`/api/fee-structures/${id}`),
};

/*
 * ------------------------------------------------------------- fee module
 *
 * Two resources, replacing five. `studentFees`, `challans`, `receipts` and
 * `payments` each addressed a different table recording the same billing
 * events, and the tables were never reconciled: money written to one was
 * invisible to a screen reading another, which is why the student and parent
 * portals reported different balances for the same child.
 *
 * The tables were merged into `fee_vouchers` and `fee_payments`; see
 * backend/src/migrations/20260808090000-consolidate-fee-module.js.
 */

export const feeVouchers = {
  // Scoped by the server: a student sees their own, a parent their children's,
  // staff any. Filters: student_id (staff), status, semester_id.
  list: (filters) => get(`/api/fee-vouchers${query(filters)}`),
  byId: (id) => get(`/api/fee-vouchers/${id}`),

  /*
   * A whole fee position in one call: every voucher with its instalments, plus
   * billed / paid / due / advance totals with overpayment already carried
   * forward oldest-voucher-first.
   *
   * The carry-forward used to run on the client, in two separate
   * implementations that had drifted apart. It is computed once on the server
   * now, so no screen can disagree with another.
   */
  position: (studentId) => get(`/api/fee-vouchers/student/${studentId}`),
  myPosition: () => get('/api/fee-vouchers/me'),

  /*
   * Raise one semester's challan for one student. Admin only.
   *
   * payload: { student_id, semester_id?, total_payable?, due_date?,
   *            issue_date?, fee_structure_id?, voucher_number? }
   *
   * `semester_id` falls back to the student's current semester and
   * `total_payable` to the fee structure on record for that programme and
   * semester, so the ordinary case is student + due date. The server refuses a
   * second live voucher for a semester the student already has one for — cancel
   * the first to replace it.
   */
  create: (payload) => post('/api/fee-vouchers', payload),
  update: (id, payload) => put(`/api/fee-vouchers/${id}`, payload),
  remove: (id) => del(`/api/fee-vouchers/${id}`),
};

export const feePayments = {
  // Filters: fee_voucher_id. Scoped the same way as vouchers.
  list: (filters) => get(`/api/fee-payments${query(filters)}`),
  // Recording a payment re-settles its voucher in the same transaction, so
  // amount_paid and status can never drift from the instalments. Admin only.
  create: (payload) => post('/api/fee-payments', payload),
  update: (id, payload) => put(`/api/fee-payments/${id}`, payload),
  remove: (id) => del(`/api/fee-payments/${id}`),

  /*
   * A parent (or student) declaring a payment they have made.
   *
   * This does NOT reduce the balance. The row is written Pending and the
   * voucher is left alone until the accounts office verifies it — otherwise
   * anyone could settle a voucher by typing a number. `totals.pending` on the
   * fee position reports what has been declared and not yet confirmed.
   *
   * payload: { fee_voucher_id, amount_paid, payment_method, payment_date }
   * payment_method is one of Cash | Bank Transfer | Card | Mobile Wallet |
   * Online | Cheque | Other, and payment_date cannot be in the future.
   */
  submit: (payload) => post('/api/fee-payments/submit', payload),

  /*
   * Admin: the approvals queue — everything declared through a portal that
   * nobody has decided on yet.
   *
   * Filters: status (Pending by default; Verified / Rejected give the decision
   * history), student_id, page, limit. Each row carries the student, the
   * voucher it settles and who declared it, so the decision can be made from
   * the list without opening anything else.
   */
  submitted: (filters) => get(`/api/fee-payments/submitted${query(filters)}`),

  // Admin: apply or refuse a declared payment. Verifying issues the receipt
  // number and re-settles the voucher.
  decide: (id, status) => put(`/api/fee-payments/${id}/verify`, { status }),

  /*
   * The payment ledger: every instalment against a student's vouchers, ordered
   * by the date the accounts office APPROVED it, with `totals` computed over
   * the whole filtered set rather than over the page.
   *
   * Filters: student_id, fee_voucher_id, status, from, to, page, limit. The
   * date window applies to the approval date, which is what the list is sorted
   * on. Role-scoped by the server, not by the caller: staff see any student, a
   * parent their wards, a student themselves.
   *
   * THREE MOMENTS, DELIBERATELY NOT CONFLATED, on every row:
   *   claimedPaidOn  what the family says the date was
   *   declaredAt     when they said it
   *   approvedAt     when the institute agreed
   *
   * `approvedAtIsApproximate: true` marks a row whose approval time was
   * BACKFILLED from updated_at by migration 20260812160000 — recognisable
   * because it is Verified but has no approver. Those timestamps are evidence
   * of an edit and only probably of the approval, so a screen must present them
   * as estimated rather than as exact. Pending rows are kept at the top of the
   * list: an undecided claim is the thing on this screen someone has to act on.
   */
  history: (filters) => get(`/api/fee-payments/history${query(filters)}`),
};

export const feeReports = {
  list: (filters) => get(`/api/fee-reports${query(filters)}`),
  byId: (id) => get(`/api/fee-reports/${id}`),
};

// -------------------------------------------------------------- summaries
// Read-only reporting views, aggregated by the database. Prefer these over
// pulling raw rows: summaries.attendance() replaces what would otherwise be a
// 7.7MB download of all 59,394 attendance records.
export const summaries = {
  attendance: (filters) => get(`/api/summaries/attendance${query(filters)}`),
  feeStatus: (filters) => get(`/api/summaries/fee-status${query(filters)}`),
  teacherWorkload: (filters) => get(`/api/summaries/teacher-workload${query(filters)}`),
  classPerformance: (filters) => get(`/api/summaries/class-performance${query(filters)}`),
};

// --------------------------------------------------------------------- ai
// Note: these are the backend's own AI routes. The SambaNova chatbot proxy
// configured in vite.config.js is a separate thing and is left untouched.
export const ai = {
  predictForStudent: (studentId) => get(`/api/ai/predict/${studentId}`),
  health: () => get('/api/ai/health'),
  predict: (payload) => post('/api/ai/predict', payload),
  reports: (filters) => get(`/api/ai/reports${query(filters)}`),
  chat: (payload) => post('/api/ai/chat', payload),
  ocr: (formData) => post('/api/ai/ocr', formData),
};
