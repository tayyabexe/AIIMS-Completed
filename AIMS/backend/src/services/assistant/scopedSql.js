/*
 * Scoped SQL for teachers.
 *
 * THE PROBLEM
 * -----------
 * Admins can be given a general SQL channel safely, because there is no scope
 * predicate for the generated statement to omit — an admin is entitled to the
 * whole dataset already. A teacher is not. The obvious approach, appending
 * "AND student_id IN (...)" to whatever the model produced, is the one that
 * must not be used: it has to be applied correctly to every subquery, every
 * join, every UNION branch, every time, and one miss silently returns another
 * teacher's students.
 *
 * THE APPROACH
 * ------------
 * Do not filter the query. Change what the table names mean.
 *
 * MySQL 8 resolves a CTE name in preference to a base table of the same name,
 * so a statement prefixed with
 *
 *     WITH students AS (SELECT ... WHERE student_id IN (<their roster>))
 *
 * has `SELECT * FROM students` read the roster, not the students table. The
 * model cannot forget the filter because the model never writes the filter. It
 * writes an ordinary query against names that are already restricted.
 *
 * Three things have to hold for that to be airtight, and all three are enforced
 * in sqlGuard.validateScoped():
 *
 *   1. Every table the query names must be on the allowlist, and every
 *      allowlisted name must have a scoped CTE. A name with no CTE would
 *      resolve to the real base table.
 *
 *   2. No schema-qualified references. `aims_db.students` bypasses the CTE and
 *      reaches the real table.
 *
 *   3. No WITH clause of their own. Besides colliding with this prelude, a
 *      teacher-supplied `WITH students AS (SELECT * FROM ...)` would redefine
 *      the very name being relied on.
 *
 * Underneath all of it the read-only account still applies, so password
 * hashes, CNICs, salaries and payroll remain unreadable regardless.
 */

const { idList } = require("./tools/teacher.tools");

/*
 * The only names a teacher's SQL may reference.
 *
 * Each maps to a CTE below. Anything else is refused rather than silently
 * resolving to a base table — that is the whole security property, so the two
 * lists must never drift. buildPrelude() asserts they match.
 */
const ALLOWED_TABLES = [
    "students",
    "subjects",
    "sections",
    "enrollments",
    "exams",
    "marks",
    "attendance",
    "timetables",
    "class_roster",
    "attendance_summary",
    "student_marks",
    "grades"
];

/**
 * Builds the CTE prelude that redefines every allowlisted name in terms of the
 * teacher's own roster.
 *
 * A teacher with no timetable rows produces `IN (NULL)` throughout, so every
 * CTE is empty and their queries return nothing. That is the correct outcome:
 * they teach nobody, so they may see nobody.
 */
const buildPrelude = (scope) => {

    if (scope.kind !== "teacher") {
        throw new Error("scoped SQL is only for teacher scope");
    }

    const students = idList([...scope.studentIds]);
    const subjects = idList(scope.subjectIds);
    const sections = idList(scope.sectionIds);
    const teacherId = Number(scope.teacherId);

    /*
     * Column lists are spelled out rather than SELECT *, for two reasons: the
     * read-only account would refuse `SELECT *` on students anyway (cnic_bform
     * is withheld at column level), and naming them means a new column added
     * to a base table cannot appear here without someone deciding it should.
     */
    /*
     * THE ID LISTS, ONCE.
     *
     * The roster used to be pasted into six separate CTEs. For a teacher with
     * 707 students that is six copies of a 4,000-character IN list in every
     * statement - a measured 22,197 characters of SQL to compute four subject
     * averages, growing linearly with the roster until it starts pressing on
     * max_allowed_packet.
     *
     * Naming each list once and referring to it by subquery is exactly the
     * same filter and exactly the same security boundary: `student_id IN
     * (SELECT student_id FROM scope_students)` restricts precisely what the
     * literal list restricted. MySQL materialises these two small derived
     * tables once per statement, so the plan does not suffer and the
     * statement shrinks to roughly a third of its former size.
     *
     * WHY THESE TWO MUST BE EMITTED FIRST. `scope_students` reads `FROM
     * students`, and there is a CTE called `students` in the same WITH. A
     * non-recursive CTE may only reference CTEs declared BEFORE it, so with
     * these two first the name unambiguously resolves to the base table -
     * which is what we want, since the point is to define the roster the
     * `students` CTE is itself filtered by. Reordering them would silently
     * turn this into a self-reference, so the assembly below is explicit
     * about putting them at the front.
     *
     * They are deliberately NOT on ALLOWED_TABLES. A teacher's own SQL naming
     * `scope_students` is refused by the guard like any other unlisted name;
     * they exist for the prelude to reference, not for the planner to see.
     */
    const scopeCtes = {
        scope_students:
            `SELECT student_id FROM students WHERE student_id IN (${students})`,
        scope_subjects:
            `SELECT subject_id FROM subjects WHERE subject_id IN (${subjects})`
    };

    const IN_STUDENTS = "IN (SELECT student_id FROM scope_students)";
    const IN_SUBJECTS = "IN (SELECT subject_id FROM scope_subjects)";

    const ctes = {
        students: `
            SELECT student_id, registration_number, first_name, last_name,
                   CONCAT(first_name, ' ', last_name) AS full_name,
                   gender, program_id, batch_id, section_id,
                   current_semester_id, academic_status
              FROM students
             WHERE is_deleted = 0 AND student_id ${IN_STUDENTS}`,

        subjects: `
            SELECT subject_id, subject_code, subject_name, credit_hours,
                   semester_id, prerequisite_subject_id
              FROM subjects
             WHERE is_deleted = 0 AND subject_id ${IN_SUBJECTS}`,

        sections: `
            SELECT section_id, batch_id, section_name, capacity
              FROM sections
             WHERE is_deleted = 0 AND section_id IN (${sections})`,

        enrollments: `
            SELECT enrollment_id, student_id, subject_id, semester_id,
                   enrollment_date, status
              FROM enrollments
             WHERE student_id ${IN_STUDENTS} AND subject_id ${IN_SUBJECTS}`,

        exams: `
            SELECT exam_id, exam_name, exam_type, semester_id, subject_id,
                   exam_date, total_marks, classroom_id, invigilator_id
              FROM exams
             WHERE subject_id ${IN_SUBJECTS}`,

        /*
         * Published marks only, matching what get_class_marks and the views
         * expose. A teacher can see draft marks for their own classes through
         * the marks screen, where the workflow state is visible; a bare SQL
         * result would present an unpublished figure as a fact.
         */
        marks: `
            SELECT m.mark_id, m.exam_id, m.student_id, m.obtained_marks,
                   m.status, e.subject_id, e.total_marks, e.exam_type, e.exam_date
              FROM marks m
              JOIN exams e ON e.exam_id = m.exam_id
             WHERE m.status = 'Published'
               AND m.student_id ${IN_STUDENTS}
               AND e.subject_id ${IN_SUBJECTS}`,

        attendance: `
            SELECT attendance_id, student_id, subject_id, timetable_id,
                   att_date, status, marked_by
              FROM attendance
             WHERE student_id ${IN_STUDENTS} AND subject_id ${IN_SUBJECTS}`,

        timetables: `
            SELECT timetable_id, subject_id, section_id, teacher_id,
                   classroom_id, day_of_week, start_time, end_time
              FROM timetables
             WHERE teacher_id = ${teacherId}`,

        class_roster: `
            SELECT teacher_id, subject_id, subject_code, subject_name,
                   section_id, section_name, batch_id, semester_id,
                   student_id, registration_number,
                   student_first_name, student_last_name, enrollment_status
              FROM vw_teacher_class_roster
             WHERE teacher_id = ${teacherId}`,

        attendance_summary: `
            SELECT student_id, subject_id, subject_code, subject_name,
                   semester_id, total_sessions, present_count, absent_count,
                   late_count, leave_count, attendance_percentage,
                   strict_attendance_percentage
              FROM vw_student_attendance_summary
             WHERE student_id ${IN_STUDENTS} AND subject_id ${IN_SUBJECTS}`,

        student_marks: `
            SELECT student_id, exam_id, exam_name, exam_type, exam_date,
                   subject_id, subject_code, subject_name, semester_id,
                   obtained_marks, total_marks, percentage,
                   grade_letter, grade_point
              FROM vw_student_subject_marks
             WHERE student_id ${IN_STUDENTS} AND subject_id ${IN_SUBJECTS}`,

        /*
         * The grading policy carries no personal data — it is five rows of
         * thresholds — so it is passed through unfiltered. It still needs a
         * CTE rather than being left off the allowlist, because a query
         * joining to it must be able to name it.
         */
        grades: `
            SELECT grade_id, grade_letter, min_percentage, max_percentage,
                   grade_point
              FROM grades`
    };

    // The allowlist and the CTE set are the same security boundary expressed
    // twice. If they ever diverge, an allowlisted name would fall through to
    // the real table, so this fails loudly rather than at runtime.
    const missing = ALLOWED_TABLES.filter((name) => !ctes[name]);

    if (missing.length) {
        throw new Error(
            `scoped SQL is missing CTEs for allowlisted tables: ${missing.join(", ")}`
        );
    }

    const clauses = Object.entries({ ...scopeCtes, ...ctes })
        .map(([name, body]) => `${name} AS (${body.trim()})`)
        .join(",\n");

    return `WITH ${clauses}\n`;
};

/**
 * The schema shown to a teacher.
 *
 * Describes the scoped names, not the real database. A teacher must not be
 * told that `users` or `payroll` exist — both because they cannot query them
 * and because the schema itself is information.
 */
const describeForTeacher = () => [
    "You may query ONLY these names. They are already restricted to the",
    "students and subjects you teach - do not add your own filters for that.",
    "",
    "  students(student_id, registration_number, first_name, last_name, full_name,",
    "           gender, program_id, batch_id, section_id, current_semester_id,",
    "           academic_status)",
    "  subjects(subject_id, subject_code, subject_name, credit_hours, semester_id,",
    "           prerequisite_subject_id)",
    "  sections(section_id, batch_id, section_name, capacity)",
    "  enrollments(enrollment_id, student_id, subject_id, semester_id,",
    "              enrollment_date, status)",
    "  exams(exam_id, exam_name, exam_type, semester_id, subject_id, exam_date,",
    "        total_marks, classroom_id, invigilator_id)",
    "  marks(mark_id, exam_id, student_id, obtained_marks, status, subject_id,",
    "        total_marks, exam_type, exam_date)   -- published marks only",
    "  attendance(attendance_id, student_id, subject_id, timetable_id, att_date,",
    "             status, marked_by)",
    "  timetables(timetable_id, subject_id, section_id, teacher_id, classroom_id,",
    "             day_of_week, start_time, end_time)",
    "  class_roster(teacher_id, subject_id, subject_code, subject_name, section_id,",
    "               section_name, batch_id, semester_id, student_id,",
    "               registration_number, student_first_name, student_last_name,",
    "               enrollment_status)",
    "  attendance_summary(student_id, subject_id, subject_code, subject_name,",
    "                     semester_id, total_sessions, present_count, absent_count,",
    "                     late_count, leave_count, attendance_percentage,",
    "                     strict_attendance_percentage)",
    "  student_marks(student_id, exam_id, exam_name, exam_type, exam_date,",
    "                subject_id, subject_code, subject_name, semester_id,",
    "                obtained_marks, total_marks, percentage, grade_letter,",
    "                grade_point)",
    "  grades(grade_id, grade_letter, min_percentage, max_percentage, grade_point)",
    "",
    "Write a plain SELECT. Do not use WITH, and do not qualify names with a",
    "database prefix - both are refused."
].join("\n");

module.exports = { ALLOWED_TABLES, buildPrelude, describeForTeacher };
