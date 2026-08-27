// Single source of truth for what each role may search, over which tables, and
// on which columns.
//
// WHY THIS FILE EXISTS
// The only search endpoints before this were GET /api/students/search,
// /api/subjects/search and /api/programs/search. All three are Admin/Teacher
// (and, for subjects, Student) routes with no per-row scoping, so a teacher
// searching students got all 2,001 rows regardless of what they teach, and a
// parent had no search at all. Rather than bolt a role check onto each of
// them, every searchable resource is declared here once with:
//
//   - the tables it reads and the columns it returns
//   - the columns free text (?q=) matches on
//   - the attributes that may be filtered exactly (?field=value)
//   - a per-role scope that narrows rows to what that role may see
//
// SAFETY
// Nothing in a request is ever concatenated into SQL. Table and column names
// come only from the constants below; every value the caller sends is bound as
// a named replacement. A field name that is not in `fields` is rejected, so an
// unknown or crafted column name cannot reach the query at all.

const { ROLES } = require("./roles");

// Rows belonging to a Super Admin are hidden from everyone below that level.
// Applied to any resource that resolves to a login account - without it an
// Admin searching faculty would find the Super Admin's employee record
// (employee "System" is exactly that row on the live database).
const HIDE_SUPER_ADMIN = `u.role_id <> ${ROLES.SUPER_ADMIN}`;

// ---------------------------------------------------------------------
// Scope helpers
//
// Each returns a SQL fragment ANDed onto the WHERE clause. `ctx` carries the
// caller's resolved identity (see searchService.resolveContext): own_student_id,
// own_section_id, teacher_id, parent_id, child_ids, child_section_ids.
// Returning DENY blocks the resource for that caller entirely.
// ---------------------------------------------------------------------

const DENY = "1 = 0";

// A parent or teacher with nothing linked must match no rows rather than all
// rows - an empty IN () list is a SQL syntax error, so it is caught here.
//
// The ids come from the database via resolveContext, never from the request,
// but they are still coerced to integers before being written into SQL: that
// way a non-numeric value can only ever become "no rows", never a fragment.
const inList = (column, values) => {

    const ids = (values || [])
        .map(Number)
        .filter(Number.isInteger);

    return ids.length ? `${column} IN (${ids.join(",")})` : DENY;
};

// Same guarantee for the single-id scopes.
const asId = (value) => (Number.isInteger(Number(value)) ? Number(value) : 0);

const RESOURCES = {

    // ================= STUDENTS =================
    students: {
        label: "Students",
        table: `students s
                LEFT JOIN programs pr ON pr.program_id = s.program_id
                LEFT JOIN batches   b  ON b.batch_id    = s.batch_id
                LEFT JOIN sections  sec ON sec.section_id = s.section_id
                LEFT JOIN users     u  ON u.user_id     = s.user_id`,
        select: `s.student_id, s.registration_number, s.first_name, s.last_name,
                 s.phone, s.gender, s.dob, s.academic_status,
                 s.program_id, pr.program_name,
                 s.batch_id, b.batch_name,
                 s.section_id, sec.section_name,
                 s.current_semester_id, u.email, u.profile_picture`,
        base: "s.is_deleted = 0",
        text: ["s.first_name", "s.last_name", "s.registration_number",
               "s.cnic_bform", "s.phone", "u.email"],
        fields: {
            student_id: "s.student_id",
            registration_number: "s.registration_number",
            first_name: "s.first_name",
            last_name: "s.last_name",
            cnic_bform: "s.cnic_bform",
            phone: "s.phone",
            gender: "s.gender",
            academic_status: "s.academic_status",
            program_id: "s.program_id",
            batch_id: "s.batch_id",
            section_id: "s.section_id",
            current_semester_id: "s.current_semester_id",
            email: "u.email"
        },
        order: "s.first_name, s.last_name",
        scope: {
            // A student searching students finds exactly one row: themselves.
            [ROLES.STUDENT]: (ctx) => `s.student_id = ${asId(ctx.own_student_id)}`,
            // A teacher sees only the sections and batches assigned to them.
            [ROLES.TEACHER]: (ctx) => ctx.teacher_id
                ? `(${inList("s.section_id", ctx.teacher_section_ids)}
                    OR ${inList("s.batch_id", ctx.teacher_batch_ids)})`
                : DENY,
            [ROLES.PARENT]: (ctx) => inList("s.student_id", ctx.child_ids)
        }
    },

    // ================= FACULTY =================
    faculty: {
        label: "Faculty",
        table: `teachers t
                JOIN employees e     ON e.employee_id = t.employee_id
                LEFT JOIN departments d ON d.department_id = e.department_id
                LEFT JOIN users u    ON u.user_id = e.user_id`,
        select: `t.teacher_id, t.specialization,
                 e.employee_id, e.employee_code, e.first_name, e.last_name,
                 e.designation, e.employment_status,
                 e.department_id, d.department_name,
                 u.email, u.phone, u.profile_picture`,
        // The Super Admin guard is part of the base clause, not an add-on, so
        // it cannot be skipped by any role that reaches this resource.
        base: `t.is_deleted = 0 AND e.is_deleted = 0 AND ${HIDE_SUPER_ADMIN}`,
        text: ["e.first_name", "e.last_name", "e.employee_code",
               "e.designation", "t.specialization", "u.email"],
        fields: {
            teacher_id: "t.teacher_id",
            employee_id: "e.employee_id",
            employee_code: "e.employee_code",
            first_name: "e.first_name",
            last_name: "e.last_name",
            designation: "e.designation",
            specialization: "t.specialization",
            department_id: "e.department_id",
            employment_status: "e.employment_status",
            email: "u.email"
        },
        order: "e.first_name, e.last_name"
    },

    // ================= PARENTS =================
    parents: {
        label: "Parents",
        table: `parents p
                LEFT JOIN users u ON u.user_id = p.user_id`,
        select: `p.parent_id, p.first_name, p.last_name, p.phone, p.occupation,
                 u.email, u.profile_picture,
                 (SELECT COUNT(*) FROM student_guardians sg
                   WHERE sg.parent_id = p.parent_id) AS children_count`,
        base: `p.is_deleted = 0 AND (u.user_id IS NULL OR ${HIDE_SUPER_ADMIN})`,
        text: ["p.first_name", "p.last_name", "p.phone", "p.occupation", "u.email"],
        fields: {
            parent_id: "p.parent_id",
            first_name: "p.first_name",
            last_name: "p.last_name",
            phone: "p.phone",
            occupation: "p.occupation",
            email: "u.email"
        },
        order: "p.first_name, p.last_name"
    },

    // ================= DEPARTMENTS =================
    departments: {
        label: "Departments",
        table: `departments d
                LEFT JOIN employees he ON he.employee_id = d.head_employee_id`,
        select: `d.department_id, d.department_name, d.head_employee_id,
                 CONCAT_WS(' ', he.first_name, he.last_name) AS head_name,
                 (SELECT COUNT(*) FROM programs pg
                   WHERE pg.department_id = d.department_id
                     AND pg.is_deleted = 0) AS program_count`,
        base: "d.is_deleted = 0",
        text: ["d.department_name", "he.first_name", "he.last_name"],
        fields: {
            department_id: "d.department_id",
            department_name: "d.department_name",
            head_employee_id: "d.head_employee_id"
        },
        order: "d.department_name"
    },

    // ================= COURSES (DEGREE PROGRAMS) =================
    courses: {
        label: "Courses",
        table: `programs pr
                LEFT JOIN departments d ON d.department_id = pr.department_id`,
        select: `pr.program_id, pr.program_name, pr.duration_semesters,
                 pr.department_id, d.department_name,
                 (SELECT COUNT(*) FROM students st
                   WHERE st.program_id = pr.program_id
                     AND st.is_deleted = 0) AS student_count`,
        base: "pr.is_deleted = 0",
        text: ["pr.program_name", "d.department_name"],
        fields: {
            program_id: "pr.program_id",
            program_name: "pr.program_name",
            department_id: "pr.department_id",
            duration_semesters: "pr.duration_semesters"
        },
        order: "pr.program_name",
        scope: {
            // The programs a teacher's assigned batches belong to.
            [ROLES.TEACHER]: (ctx) => inList("pr.program_id", ctx.teacher_program_ids)
        }
    },

    // ================= SUBJECTS =================
    subjects: {
        label: "Subjects",
        table: `subjects sub
                LEFT JOIN semesters sem ON sem.semester_id = sub.semester_id`,
        select: `sub.subject_id, sub.subject_code, sub.subject_name,
                 sub.credit_hours, sub.semester_id, sem.semester_number,
                 sub.prerequisite_subject_id`,
        base: "sub.is_deleted = 0",
        text: ["sub.subject_code", "sub.subject_name"],
        fields: {
            subject_id: "sub.subject_id",
            subject_code: "sub.subject_code",
            subject_name: "sub.subject_name",
            credit_hours: "sub.credit_hours",
            semester_id: "sub.semester_id"
        },
        order: "sub.subject_code",
        scope: {
            // Only what the student is enrolled in.
            [ROLES.STUDENT]: (ctx) => ctx.own_student_id
                ? `sub.subject_id IN (SELECT en.subject_id FROM enrollments en
                                       WHERE en.student_id = ${asId(ctx.own_student_id)})`
                : DENY,
            [ROLES.TEACHER]: (ctx) => inList("sub.subject_id", ctx.teacher_subject_ids)
        }
    },

    // ================= ATTENDANCE =================
    attendance: {
        label: "Attendance",
        table: `attendance a
                JOIN students s  ON s.student_id  = a.student_id
                JOIN subjects sub ON sub.subject_id = a.subject_id`,
        select: `a.attendance_id, a.student_id, s.registration_number,
                 CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
                 a.subject_id, sub.subject_code, sub.subject_name,
                 a.timetable_id, a.att_date, a.status`,
        base: "s.is_deleted = 0",
        text: ["s.first_name", "s.last_name", "s.registration_number",
               "sub.subject_code", "sub.subject_name", "a.status"],
        fields: {
            attendance_id: "a.attendance_id",
            student_id: "a.student_id",
            subject_id: "a.subject_id",
            timetable_id: "a.timetable_id",
            att_date: "a.att_date",
            status: "a.status",
            registration_number: "s.registration_number",
            section_id: "s.section_id"
        },
        // Inclusive date window, useful on every portal's attendance screen.
        ranges: { att_date: "a.att_date" },
        order: "a.att_date DESC",
        scope: {
            [ROLES.STUDENT]: (ctx) => `a.student_id = ${asId(ctx.own_student_id)}`,
            [ROLES.TEACHER]: (ctx) => inList("a.subject_id", ctx.teacher_subject_ids),
            [ROLES.PARENT]: (ctx) => inList("a.student_id", ctx.child_ids)
        }
    },

    // ================= RESULTS / GRADES =================
    results: {
        label: "Results",
        table: `results r
                JOIN students s   ON s.student_id  = r.student_id
                LEFT JOIN semesters sem ON sem.semester_id = r.semester_id`,
        select: `r.result_id, r.student_id, s.registration_number,
                 CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
                 r.semester_id, sem.semester_number,
                 r.gpa, r.cgpa, r.status, r.published_at`,
        base: "s.is_deleted = 0",
        text: ["s.first_name", "s.last_name", "s.registration_number", "r.status"],
        fields: {
            result_id: "r.result_id",
            student_id: "r.student_id",
            semester_id: "r.semester_id",
            status: "r.status",
            gpa: "r.gpa",
            cgpa: "r.cgpa",
            registration_number: "s.registration_number",
            section_id: "s.section_id"
        },
        order: "r.semester_id DESC",
        scope: {
            [ROLES.STUDENT]: (ctx) => `r.student_id = ${asId(ctx.own_student_id)}`,
            [ROLES.TEACHER]: (ctx) => ctx.teacher_id
                ? `(${inList("s.section_id", ctx.teacher_section_ids)}
                    OR ${inList("s.batch_id", ctx.teacher_batch_ids)})`
                : DENY,
            // A parent sees a result only once it has been published.
            [ROLES.PARENT]: (ctx) =>
                `${inList("r.student_id", ctx.child_ids)} AND r.status = 'Published'`
        }
    },

    // ================= FEES =================
    fees: {
        label: "Fees",
        // Amounts are PKR. See config/currency.js - the response carries the
        // currency explicitly so no portal has to assume a symbol.
        money: ["total_payable", "amount_paid", "balance"],
        // fee_vouchers carries amount_paid and remaining_balance on the row,
        // maintained by feeService whenever an instalment is recorded, so the
        // correlated sub-selects this used to run against `payments` are gone.
        // Those sub-selects also only saw one of the two old payment tables.
        table: `fee_vouchers sf
                JOIN students s ON s.student_id = sf.student_id
                LEFT JOIN fee_structures fs ON fs.fee_structure_id = sf.fee_structure_id`,
        select: `sf.fee_voucher_id, sf.student_id, s.registration_number,
                 CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
                 sf.voucher_number, sf.total_payable, sf.due_date, sf.status,
                 sf.fee_structure_id, fs.fee_category,
                 sf.amount_paid,
                 sf.remaining_balance AS balance`,
        base: "s.is_deleted = 0",
        text: ["sf.voucher_number", "s.first_name", "s.last_name",
               "s.registration_number", "sf.status", "fs.fee_category"],
        fields: {
            fee_voucher_id: "sf.fee_voucher_id",
            student_id: "sf.student_id",
            voucher_number: "sf.voucher_number",
            status: "sf.status",
            fee_structure_id: "sf.fee_structure_id",
            due_date: "sf.due_date",
            registration_number: "s.registration_number"
        },
        ranges: { due_date: "sf.due_date" },
        order: "sf.due_date DESC",
        scope: {
            [ROLES.STUDENT]: (ctx) => `sf.student_id = ${asId(ctx.own_student_id)}`,
            [ROLES.PARENT]: (ctx) => inList("sf.student_id", ctx.child_ids)
        }
    },

    // ================= DOCUMENTS =================
    documents: {
        label: "Documents",
        table: `student_documents sd
                JOIN students s ON s.student_id = sd.student_id`,
        select: `sd.doc_id, sd.student_id, s.registration_number,
                 CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
                 sd.doc_type, sd.file_url, sd.verified, sd.uploaded_at`,
        base: "s.is_deleted = 0",
        text: ["sd.doc_type", "s.first_name", "s.last_name", "s.registration_number"],
        fields: {
            doc_id: "sd.doc_id",
            student_id: "sd.student_id",
            doc_type: "sd.doc_type",
            verified: "sd.verified",
            registration_number: "s.registration_number"
        },
        order: "sd.uploaded_at DESC",
        scope: {
            [ROLES.STUDENT]: (ctx) => `sd.student_id = ${asId(ctx.own_student_id)}`
        }
    },

    // ================= TIMETABLE =================
    timetable: {
        label: "Timetable",
        table: "vw_student_timetable v",
        select: `v.timetable_id, v.section_id, v.subject_id, v.subject_code,
                 v.subject_name, v.teacher_id,
                 CONCAT_WS(' ', v.teacher_first_name, v.teacher_last_name) AS teacher_name,
                 v.classroom_id, v.room_name, v.building,
                 v.day_of_week, v.start_time, v.end_time`,
        base: "1 = 1",
        text: ["v.subject_code", "v.subject_name", "v.room_name", "v.building",
               "v.teacher_first_name", "v.teacher_last_name", "v.day_of_week"],
        fields: {
            timetable_id: "v.timetable_id",
            section_id: "v.section_id",
            subject_id: "v.subject_id",
            teacher_id: "v.teacher_id",
            classroom_id: "v.classroom_id",
            day_of_week: "v.day_of_week"
        },
        order: `FIELD(v.day_of_week,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'), v.start_time`,
        scope: {
            [ROLES.STUDENT]: (ctx) => `v.section_id = ${asId(ctx.own_section_id)}`,
            [ROLES.TEACHER]: (ctx) => `v.teacher_id = ${asId(ctx.teacher_id)}`,
            [ROLES.PARENT]: (ctx) => inList("v.section_id", ctx.child_section_ids)
        }
    },

    // ================= NOTICES =================
    // notifications rows are per-account, so this is always self-scoped - for
    // every role, including Admin. There is no cross-user read here.
    notices: {
        label: "Notices",
        table: "notifications n",
        select: `n.notification_id, n.message, n.type, n.is_read, n.created_at`,
        base: "1 = 1",
        text: ["n.message", "n.type"],
        fields: {
            notification_id: "n.notification_id",
            type: "n.type",
            is_read: "n.is_read"
        },
        ranges: { created_at: "n.created_at" },
        order: "n.created_at DESC",
        selfScoped: "n.user_id"
    }
};

// What each role may search. A resource missing from a role's list is not
// merely empty for them - it is refused with 403, so the portal cannot quietly
// probe for which resources exist.
const ROLE_ACCESS = {
    [ROLES.SUPER_ADMIN]: [
        "students", "faculty", "parents", "departments", "courses", "subjects",
        "attendance", "results", "fees", "documents", "timetable", "notices"
    ],
    [ROLES.ADMIN]: [
        "students", "faculty", "parents", "departments", "courses", "subjects",
        "attendance", "results", "fees", "documents", "timetable", "notices"
    ],
    // Own records only. Every one of these is narrowed to this student by the
    // scope above; "students" returns exactly their own row.
    [ROLES.STUDENT]: [
        "students", "subjects", "attendance", "results", "fees", "documents",
        "timetable", "notices"
    ],
    // Assigned students, courses, subjects, attendance, grades, timetable.
    [ROLES.TEACHER]: [
        "students", "courses", "subjects", "attendance", "results",
        "timetable", "notices"
    ],
    // Their children and nothing else. No access to faculty, other students,
    // departments or documents.
    [ROLES.PARENT]: [
        "students", "attendance", "results", "fees", "timetable", "notices"
    ]
};

module.exports = {
    RESOURCES,
    ROLE_ACCESS,
    DENY
};
