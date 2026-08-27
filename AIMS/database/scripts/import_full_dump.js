/**
 * Full reload of aims_db from AIMS_Database_2000_Students_Full_Dump.csv.xls
 *
 * WHAT THIS DOES (destructive, by explicit instruction):
 *   1. TRUNCATEs every data table and resets AUTO_INCREMENT to 1.
 *      SequelizeMeta / SequelizeData are NOT touched (migration tracking).
 *   2. Re-seeds the LIVE role set (8 roles) rather than the dump's 6, and
 *      remaps every dump role_id onto the matching live role.
 *   3. Loads all dump tables using the dump's own IDs verbatim (safe now that
 *      the database is empty and the dump is internally FK-consistent).
 *   4. Generates users + employees for the live roles the dump has no data for
 *      (Super Admin, HR, Accountant, Library Staff).
 *   5. Replaces the dump's fake password placeholders with real bcrypt hashes.
 *   6. Creates 1,000 clearly-marked PLACEHOLDER parent rows so the 1,000
 *      student_guardians links can be loaded (the dump ships no parents table).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const DUMP = path.resolve(__dirname, 'AIMS_Database_2000_Students_Full_Dump.csv.xls');

// The institute's period grid. The dump carries whatever times it was exported
// with (09:00, 14:00, ...), which do not correspond to the slots the API and
// the portals work in - a subject imported at 09:00 rendered at a time no slot
// column matched. Every timetable row is snapped onto this grid on the way in.
const { SLOTS } = require('../../backend/src/config/timetableSlots');

// ---------------------------------------------------------------- helpers
const bool = (v) => (String(v).toLowerCase() === 'true' ? 1 : 0);
const nz = (v) => (v === '' || v === undefined || v === null ? null : v);

const timeToSeconds = (time) => {
  const [h, m, s] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) ? (h * 3600) + ((m || 0) * 60) + (s || 0) : 0;
};

// The slot whose start is nearest to where the dump put the class, so an
// imported row keeps roughly its place in the day instead of collapsing into
// the first period.
const snapToSlot = (startTime) => {
  const target = timeToSeconds(startTime);
  return SLOTS.reduce((best, slot) =>
    Math.abs(timeToSeconds(slot.start_time) - target) < Math.abs(timeToSeconds(best.start_time) - target)
      ? slot
      : best
  );
};

function parseDump() {
  const content = fs.readFileSync(DUMP, 'utf8').replace(/^﻿/, '');
  const lines = content.split(/\r?\n/);
  const sections = {};
  let cur = null, buf = [];
  for (const ln of lines) {
    const m = ln.match(/^=== TABLE: (\w+) ===\s*$/);
    if (m) {
      if (cur) sections[cur] = buf;
      cur = m[1]; buf = [];
    } else if (cur !== null) buf.push(ln);
  }
  if (cur) sections[cur] = buf;

  // The dump contains no quoted fields (verified), so a plain comma split is
  // both safe and exact here.
  const out = {};
  for (const [name, blines] of Object.entries(sections)) {
    const rows = blines.filter((b) => b.trim());
    if (!rows.length) { out[name] = []; continue; }
    const header = rows[0].split(',');
    out[name] = rows.slice(1).map((line) => {
      const vals = line.split(',');
      const obj = {};
      header.forEach((h, i) => { obj[h] = vals[i] === undefined ? '' : vals[i]; });
      return obj;
    });
  }
  return out;
}

async function insertBatch(conn, table, cols, rows, batchSize = 500) {
  if (!rows.length) return 0;
  let total = 0;
  const colList = cols.map((c) => '`' + c + '`').join(',');
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const placeholders = chunk.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
    const flat = [];
    for (const r of chunk) for (const c of cols) flat.push(r[c]);
    const [res] = await conn.query(
      `INSERT INTO \`${table}\` (${colList}) VALUES ${placeholders}`, flat
    );
    total += res.affectedRows;
  }
  return total;
}

// Every data table, ordered child -> parent so truncation is clean.
const ALL_TABLES = [
  'audit_logs', 'dashboard_widgets', 'reports', 'prediction_history', 'ai_predictions',
  'prediction_models', 'book_issues', 'books', 'notifications', 'announcements',
  'meeting_requests', 'student_guardians', 'parents', 'scholarships', 'payments',
  'student_fees', 'fee_structures', 'results', 'grades', 'marks', 'exams', 'attendance',
  'enrollments', 'student_documents', 'students', 'leave_requests',
  'performance_evaluations', 'employee_documents', 'payroll', 'teacher_attendance',
  'teacher_subjects', 'timetables', 'teachers', 'employees', 'classrooms', 'subjects',
  'semesters', 'sections', 'batches', 'programs', 'departments', 'users',
  'role_permissions', 'permissions', 'roles',
];

// The live role set we are preserving (order defines role_id 1..8).
const LIVE_ROLES = [
  ['Super Admin', 'Full access across the entire system'],
  ['Admin', 'General administrative operations'],
  ['Teacher', 'Academic operations and marking'],
  ['Student', 'Portal access and course view'],
  ['Parent', 'View dependent progress and fees'],
  ['HR', 'Manages employee records and payroll'],
  ['Accountant', 'Manages fees, payments, and financial records'],
  ['Library Staff', 'Manages book inventory and issues'],
];

// Live permission set (ids 1..15), then the 3 the dump adds (16..18).
const LIVE_PERMISSIONS = [
  ['manage_users', 'Identity'], ['manage_students', 'Academic'], ['manage_teachers', 'HR'],
  ['manage_departments', 'Academic'], ['manage_courses', 'Academic'],
  ['manage_timetable', 'Academic'], ['mark_attendance', 'Academics'],
  ['enter_marks', 'Exams'], ['manage_fees', 'Finance'], ['view_fee_vouchers', 'Finance'],
  ['manage_payroll', 'HR'], ['manage_library', 'Library'],
  ['manage_ai_predictions', 'AI'], ['view_reports', 'Reporting'],
  ['manage_notifications', 'Communication'],
  // present in the dump but missing from the live set:
  ['view_attendance', 'Academic'], ['view_grades', 'Exam'], ['issue_books', 'Library'],
];

// dump role_id -> live role_id
const ROLE_MAP = { '1': 2, '2': 3, '3': 4, '4': 5, '5': 7, '6': 8 };

// Default passwords per live role (real bcrypt hashes are generated from these).
const ROLE_PASSWORDS = {
  1: 'SuperAdmin@1234', 2: 'Admin@1234', 3: 'Teacher@1234', 4: 'Student@1234',
  5: 'Parent@1234', 6: 'Hr@1234', 7: 'Accountant@1234', 8: 'Library@1234',
};

(async () => {
  const t0 = Date.now();
  console.log('Parsing dump...');
  const D = parseDump();
  console.log('  parsed', Object.keys(D).length, 'table sections\n');

  console.log('Generating bcrypt hashes (one per role)...');
  const HASH = {};
  for (const [rid, pw] of Object.entries(ROLE_PASSWORDS)) {
    HASH[rid] = await bcrypt.hash(pw, 10);
  }
  console.log('  done\n');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000, multipleStatements: false,
  });

  const report = [];
  const log = (t, n) => { report.push([t, n]); console.log(`  ${t.padEnd(22)} ${String(n).padStart(6)} rows`); };

  try {
    // ------------------------------------------------ 1. WIPE
    console.log('STEP 1 - Wiping all data tables and resetting AUTO_INCREMENT...');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ALL_TABLES) {
      await conn.query('TRUNCATE TABLE `' + t + '`');
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`  ${ALL_TABLES.length} tables truncated, IDs reset to 1\n`);

    // ------------------------------------------------ 2. ROLES / PERMISSIONS
    console.log('STEP 2 - Seeding live role + permission set...');
    log('roles', await insertBatch(conn, 'roles', ['role_name', 'description'],
      LIVE_ROLES.map(([n, d]) => ({ role_name: n, description: d }))));
    log('permissions', await insertBatch(conn, 'permissions', ['permission_name', 'module'],
      LIVE_PERMISSIONS.map(([n, m]) => ({ permission_name: n, module: m }))));

    // role_permissions: dump's 17 mappings, remapped onto live role ids.
    const permByName = {};
    const [permRows] = await conn.query('SELECT permission_id, permission_name FROM permissions');
    for (const p of permRows) permByName[p.permission_name] = p.permission_id;
    const dumpPermName = {};
    for (const p of D.permissions) dumpPermName[p.permission_id] = p.permission_name;

    const rpSet = new Set();
    for (const rp of D.role_permissions) {
      const liveRole = ROLE_MAP[rp.role_id];
      const pname = dumpPermName[rp.permission_id];
      const livePerm = permByName[pname];
      if (liveRole && livePerm) rpSet.add(`${liveRole}|${livePerm}`);
    }
    // Super Admin (live role 1) gets every permission.
    for (const p of permRows) rpSet.add(`1|${p.permission_id}`);
    const rpRows = [...rpSet].map((s) => {
      const [r, p] = s.split('|');
      return { role_id: +r, permission_id: +p };
    });
    log('role_permissions', await insertBatch(conn, 'role_permissions', ['role_id', 'permission_id'], rpRows));
    console.log();

    // ------------------------------------------------ 3. USERS
    console.log('STEP 3 - Loading users (real bcrypt hashes, remapped roles)...');
    const userRows = D.users.map((u) => {
      const liveRole = ROLE_MAP[u.role_id];
      return {
        user_id: +u.user_id,
        email: u.email,
        password_hash: HASH[liveRole],
        role_id: liveRole,
        phone: nz(u.phone),
        profile_picture: null,               // dump shipped non-existent file names
        is_active: bool(u.is_active),
        email_verified: bool(u.email_verified),
        failed_login_attempts: +u.failed_login_attempts,
        last_login: nz(u.last_login),
        last_password_change: nz(u.last_password_change),
        is_deleted: bool(u.is_deleted),
        created_at: u.created_at,
        updated_at: u.updated_at,
      };
    });
    log('users (from dump)', await insertBatch(conn, 'users',
      ['user_id', 'email', 'password_hash', 'role_id', 'phone', 'profile_picture', 'is_active',
        'email_verified', 'failed_login_attempts', 'last_login', 'last_password_change',
        'is_deleted', 'created_at', 'updated_at'], userRows, 300));

    // Generated staff for live roles the dump has no users for.
    const GENERATED_STAFF = [
      { role: 1, code: 'EMP-9001', first: 'System', last: 'Administrator', desig: 'System Administrator', dept: 1, salary: 250000 },
      { role: 6, code: 'EMP-9002', first: 'Nadia', last: 'Rehman', desig: 'HR Manager', dept: 1, salary: 180000 },
      { role: 6, code: 'EMP-9003', first: 'Faisal', last: 'Iqbal', desig: 'HR Officer', dept: 2, salary: 140000 },
      { role: 7, code: 'EMP-9004', first: 'Saima', last: 'Akhtar', desig: 'Chief Accountant', dept: 3, salary: 190000 },
      { role: 7, code: 'EMP-9005', first: 'Bilal', last: 'Hussain', desig: 'Accounts Officer', dept: 3, salary: 135000 },
      { role: 8, code: 'EMP-9006', first: 'Rabia', last: 'Nawaz', desig: 'Head Librarian', dept: 4, salary: 150000 },
      { role: 8, code: 'EMP-9007', first: 'Tariq', last: 'Mehmood', desig: 'Library Assistant', dept: 4, salary: 110000 },
    ];
    let nextUserId = 3026;
    const genUserRows = GENERATED_STAFF.map((s, i) => {
      s._userId = nextUserId + i;
      return {
        user_id: s._userId,
        email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@aims.edu.pk`,
        password_hash: HASH[s.role],
        role_id: s.role,
        phone: `+92-300-90000${i + 1}`,
        profile_picture: null,
        is_active: 1, email_verified: 1, failed_login_attempts: 0,
        last_login: null, last_password_change: null, is_deleted: 0,
        created_at: '2023-01-01 00:00:00', updated_at: '2023-01-01 00:00:00',
      };
    });
    log('users (generated staff)', await insertBatch(conn, 'users',
      ['user_id', 'email', 'password_hash', 'role_id', 'phone', 'profile_picture', 'is_active',
        'email_verified', 'failed_login_attempts', 'last_login', 'last_password_change',
        'is_deleted', 'created_at', 'updated_at'], genUserRows));
    console.log();

    // ------------------------------------------------ 4. ACADEMIC STRUCTURE
    console.log('STEP 4 - Loading academic structure...');
    // departments: head_employee_id set to NULL first (employees do not exist yet)
    log('departments', await insertBatch(conn, 'departments',
      ['department_id', 'department_name', 'head_employee_id', 'is_deleted'],
      D.departments.map((d) => ({
        department_id: +d.department_id, department_name: d.department_name,
        head_employee_id: null, is_deleted: bool(d.is_deleted),
      }))));

    log('programs', await insertBatch(conn, 'programs',
      ['program_id', 'department_id', 'program_name', 'duration_semesters', 'is_deleted'],
      D.programs.map((p) => ({
        program_id: +p.program_id, department_id: +p.department_id,
        program_name: p.program_name, duration_semesters: +p.duration_semesters,
        is_deleted: bool(p.is_deleted),
      }))));

    log('batches', await insertBatch(conn, 'batches',
      ['batch_id', 'program_id', 'batch_name', 'start_year', 'end_year', 'is_deleted'],
      D.batches.map((b) => ({
        batch_id: +b.batch_id, program_id: +b.program_id, batch_name: b.batch_name,
        start_year: +b.start_year, end_year: +b.end_year, is_deleted: bool(b.is_deleted),
      }))));

    log('sections', await insertBatch(conn, 'sections',
      ['section_id', 'batch_id', 'section_name', 'capacity', 'is_deleted'],
      D.sections.map((s) => ({
        section_id: +s.section_id, batch_id: +s.batch_id, section_name: s.section_name,
        capacity: +s.capacity, is_deleted: bool(s.is_deleted),
      }))));

    log('semesters', await insertBatch(conn, 'semesters',
      ['semester_id', 'program_id', 'semester_number', 'start_date', 'end_date', 'is_archived'],
      D.semesters.map((s) => ({
        semester_id: +s.semester_id, program_id: +s.program_id,
        semester_number: +s.semester_number, start_date: s.start_date,
        end_date: s.end_date, is_archived: bool(s.is_archived),
      }))));

    // subjects: self-referencing prerequisite; dump always points to a lower id,
    // so plain ascending insert order resolves cleanly.
    log('subjects', await insertBatch(conn, 'subjects',
      ['subject_id', 'subject_code', 'subject_name', 'credit_hours', 'semester_id',
        'prerequisite_subject_id', 'is_deleted'],
      D.subjects.map((s) => ({
        subject_id: +s.subject_id, subject_code: s.subject_code,
        subject_name: s.subject_name, credit_hours: +s.credit_hours,
        semester_id: +s.semester_id,
        prerequisite_subject_id: nz(s.prerequisite_subject_id),
        is_deleted: bool(s.is_deleted),
      }))));

    log('classrooms', await insertBatch(conn, 'classrooms',
      ['classroom_id', 'room_name', 'building', 'capacity', 'is_deleted'],
      D.classrooms.map((c) => ({
        classroom_id: +c.classroom_id, room_name: c.room_name, building: c.building,
        capacity: +c.capacity, is_deleted: bool(c.is_deleted),
      }))));
    console.log();

    // ------------------------------------------------ 5. STAFF
    console.log('STEP 5 - Loading staff...');
    log('employees (from dump)', await insertBatch(conn, 'employees',
      ['employee_id', 'user_id', 'employee_code', 'first_name', 'last_name', 'department_id',
        'designation', 'basic_salary', 'hire_date', 'employment_status', 'is_deleted'],
      D.employees.map((e) => ({
        employee_id: +e.employee_id, user_id: +e.user_id, employee_code: e.employee_code,
        first_name: e.first_name, last_name: e.last_name, department_id: +e.department_id,
        designation: nz(e.designation), basic_salary: e.basic_salary, hire_date: e.hire_date,
        employment_status: e.employment_status, is_deleted: bool(e.is_deleted),
      }))));

    let nextEmpId = 21;
    log('employees (generated)', await insertBatch(conn, 'employees',
      ['employee_id', 'user_id', 'employee_code', 'first_name', 'last_name', 'department_id',
        'designation', 'basic_salary', 'hire_date', 'employment_status', 'is_deleted'],
      GENERATED_STAFF.map((s, i) => ({
        employee_id: nextEmpId + i, user_id: s._userId, employee_code: s.code,
        first_name: s.first, last_name: s.last, department_id: s.dept,
        designation: s.desig, basic_salary: s.salary, hire_date: '2022-08-01',
        employment_status: 'Active', is_deleted: 0,
      }))));

    // now that employees exist, restore department heads
    for (const d of D.departments) {
      if (nz(d.head_employee_id)) {
        await conn.query('UPDATE departments SET head_employee_id = ? WHERE department_id = ?',
          [+d.head_employee_id, +d.department_id]);
      }
    }
    console.log('  departments.head_employee_id restored');

    log('teachers', await insertBatch(conn, 'teachers',
      ['teacher_id', 'employee_id', 'specialization', 'is_deleted'],
      D.teachers.map((t) => ({
        teacher_id: +t.teacher_id, employee_id: +t.employee_id,
        specialization: nz(t.specialization), is_deleted: bool(t.is_deleted),
      }))));

    // Snap onto the period grid, then drop rows that collide once snapped: a
    // section, a teacher and a room can each only be in one place per period,
    // and the unique indexes on timetables enforce exactly that. Keeping the
    // first occurrence is arbitrary but deterministic (the dump is ordered by
    // timetable_id), and beats having the whole import fail on a duplicate key.
    const claimed = new Set();
    const ttRows = [];
    let ttDropped = 0;

    for (const t of D.timetables) {
      const slot = snapToSlot(t.start_time);
      const row = {
        timetable_id: +t.timetable_id, subject_id: +t.subject_id, section_id: +t.section_id,
        teacher_id: +t.teacher_id, classroom_id: +t.classroom_id,
        day_of_week: t.day_of_week,
        start_time: slot.start_time, end_time: slot.end_time,
      };

      const keys = [
        `S${row.section_id}|${row.day_of_week}|${row.start_time}`,
        `T${row.teacher_id}|${row.day_of_week}|${row.start_time}`,
        `C${row.classroom_id}|${row.day_of_week}|${row.start_time}`,
      ];

      if (keys.some((k) => claimed.has(k))) { ttDropped++; continue; }

      keys.forEach((k) => claimed.add(k));
      ttRows.push(row);
    }

    if (ttDropped) {
      console.log(`  [!] ${ttDropped} timetable row(s) dropped: collided once snapped onto the slot grid`);
    }

    log('timetables', await insertBatch(conn, 'timetables',
      ['timetable_id', 'subject_id', 'section_id', 'teacher_id', 'classroom_id',
        'day_of_week', 'start_time', 'end_time'],
      ttRows));
    console.log();

    // ------------------------------------------------ 6. STUDENTS
    console.log('STEP 6 - Loading students...');
    log('students', await insertBatch(conn, 'students',
      ['student_id', 'user_id', 'registration_number', 'first_name', 'last_name', 'cnic_bform',
        'phone', 'dob', 'gender', 'program_id', 'batch_id', 'section_id', 'current_semester_id',
        'academic_status', 'is_deleted', 'created_at', 'updated_at'],
      D.students.map((s) => ({
        student_id: +s.student_id, user_id: nz(s.user_id), registration_number: s.registration_number,
        first_name: s.first_name, last_name: s.last_name, cnic_bform: s.cnic_bform,
        phone: nz(s.phone), dob: nz(s.dob), gender: nz(s.gender), program_id: +s.program_id,
        batch_id: +s.batch_id, section_id: nz(s.section_id),
        current_semester_id: nz(s.current_semester_id), academic_status: s.academic_status,
        is_deleted: bool(s.is_deleted), created_at: s.created_at, updated_at: s.updated_at,
      })), 300));
    console.log();

    // ------------------------------------------------ 7. PARENTS (placeholders)
    console.log('STEP 7 - Creating PLACEHOLDER parents + guardian links...');
    // The 1,000 dump users with role Parent (user_id 2026..3025) become parent rows
    // 1..1000, matching the parent_id range student_guardians references.
    const parentUsers = D.users.filter((u) => u.role_id === '4')
      .sort((a, b) => +a.user_id - +b.user_id);
    const parentRows = parentUsers.map((u, i) => ({
      parent_id: i + 1,
      user_id: +u.user_id,
      first_name: 'PLACEHOLDER',
      last_name: `Parent-${String(i + 1).padStart(4, '0')}`,
      phone: nz(u.phone),
      occupation: null,
      is_deleted: 0,
    }));
    log('parents (PLACEHOLDER)', await insertBatch(conn, 'parents',
      ['parent_id', 'user_id', 'first_name', 'last_name', 'phone', 'occupation', 'is_deleted'],
      parentRows, 300));

    log('student_guardians', await insertBatch(conn, 'student_guardians',
      ['student_id', 'parent_id', 'relationship'],
      D.student_guardians.map((g) => ({
        student_id: +g.student_id, parent_id: +g.parent_id, relationship: g.relationship,
      })), 300));
    console.log();

    // ------------------------------------------------ 8. ACADEMIC RECORDS
    console.log('STEP 8 - Loading academic records...');
    log('enrollments', await insertBatch(conn, 'enrollments',
      ['enrollment_id', 'student_id', 'subject_id', 'semester_id', 'enrollment_date', 'status'],
      D.enrollments.map((e) => ({
        enrollment_id: +e.enrollment_id, student_id: +e.student_id, subject_id: +e.subject_id,
        semester_id: +e.semester_id, enrollment_date: e.enrollment_date, status: e.status,
      })), 500));

    log('attendance', await insertBatch(conn, 'attendance',
      ['attendance_id', 'student_id', 'subject_id', 'timetable_id', 'att_date', 'status',
        'marked_by', 'created_at'],
      D.attendance.map((a) => ({
        attendance_id: +a.attendance_id, student_id: +a.student_id, subject_id: +a.subject_id,
        timetable_id: +a.timetable_id, att_date: a.att_date, status: a.status,
        marked_by: +a.marked_by, created_at: a.created_at,
      })), 500));

    log('exams', await insertBatch(conn, 'exams',
      ['exam_id', 'exam_name', 'exam_type', 'semester_id', 'subject_id', 'exam_date',
        'total_marks', 'classroom_id', 'invigilator_id'],
      D.exams.map((e) => ({
        exam_id: +e.exam_id, exam_name: e.exam_name, exam_type: e.exam_type,
        semester_id: +e.semester_id, subject_id: +e.subject_id, exam_date: e.exam_date,
        total_marks: +e.total_marks, classroom_id: nz(e.classroom_id),
        invigilator_id: nz(e.invigilator_id),
      }))));

    log('marks', await insertBatch(conn, 'marks',
      ['mark_id', 'exam_id', 'student_id', 'obtained_marks', 'entered_by', 'verified_by', 'status'],
      D.marks.map((m) => ({
        mark_id: +m.mark_id, exam_id: +m.exam_id, student_id: +m.student_id,
        obtained_marks: m.obtained_marks, entered_by: +m.entered_by,
        verified_by: nz(m.verified_by), status: m.status,
      })), 500));

    log('grades', await insertBatch(conn, 'grades',
      ['grade_id', 'grade_letter', 'min_percentage', 'max_percentage', 'grade_point'],
      D.grades.map((g) => ({
        grade_id: +g.grade_id, grade_letter: g.grade_letter,
        min_percentage: g.min_percentage, max_percentage: g.max_percentage,
        grade_point: g.grade_point,
      }))));

    log('results', await insertBatch(conn, 'results',
      ['result_id', 'student_id', 'semester_id', 'gpa', 'cgpa', 'published_at', 'status'],
      D.results.map((r) => ({
        result_id: +r.result_id, student_id: +r.student_id, semester_id: +r.semester_id,
        gpa: nz(r.gpa), cgpa: nz(r.cgpa), published_at: nz(r.published_at), status: r.status,
      })), 500));
    console.log();

    // ------------------------------------------------ 9. FINANCE
    console.log('STEP 9 - Loading finance records...');
    log('fee_structures', await insertBatch(conn, 'fee_structures',
      ['fee_structure_id', 'program_id', 'semester_id', 'fee_category', 'amount'],
      D.fee_structures.map((f) => ({
        fee_structure_id: +f.fee_structure_id, program_id: +f.program_id,
        semester_id: +f.semester_id, fee_category: f.fee_category, amount: f.amount,
      }))));

    log('student_fees', await insertBatch(conn, 'student_fees',
      ['student_fee_id', 'student_id', 'fee_structure_id', 'voucher_number', 'total_payable',
        'due_date', 'status'],
      D.student_fees.map((f) => ({
        student_fee_id: +f.student_fee_id, student_id: +f.student_id,
        fee_structure_id: +f.fee_structure_id, voucher_number: f.voucher_number,
        total_payable: f.total_payable, due_date: f.due_date, status: f.status,
      })), 500));

    log('payments', await insertBatch(conn, 'payments',
      ['payment_id', 'student_fee_id', 'amount_paid', 'payment_method', 'payment_date',
        'is_late', 'receipt_number', 'recorded_by'],
      D.payments.map((p) => ({
        payment_id: +p.payment_id, student_fee_id: +p.student_fee_id,
        amount_paid: p.amount_paid, payment_method: p.payment_method,
        payment_date: p.payment_date, is_late: bool(p.is_late),
        receipt_number: p.receipt_number, recorded_by: +p.recorded_by,
      })), 500));

    console.log('\n' + '='.repeat(60));
    console.log('IMPORT COMPLETE in', ((Date.now() - t0) / 1000).toFixed(1), 'seconds');
    console.log('='.repeat(60));
    const grand = report.reduce((a, [, n]) => a + n, 0);
    console.log('Total rows inserted:', grand);
  } catch (err) {
    console.error('\n*** IMPORT FAILED ***');
    console.error(err.message);
    if (err.sql) console.error('SQL:', String(err.sql).slice(0, 300));
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
