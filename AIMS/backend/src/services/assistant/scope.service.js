/*
 * Resolves what the signed-in account is allowed to see, on every request.
 *
 * WHY THIS IS NOT IN THE TOKEN
 * ----------------------------
 * The obvious shortcut is to put department_id, the teacher's subject list and
 * so on into the JWT at login. It is rejected here for two reasons:
 *
 *   1. Access tokens outlive changes. Unassign a teacher from a section and
 *      they keep the old scope until their token expires. For an assistant
 *      that reads student records on request, "revoked ten minutes ago but
 *      still works" is not an acceptable window.
 *
 *   2. A token is a claim the client holds. Everything in it has to be treated
 *      as attacker-influenced eventually; a scope resolved from the database
 *      under the user_id the signature vouches for cannot be.
 *
 * So the token stays `{ user_id, role_id }` — which is all authController
 * signs today — and everything else is looked up here, fresh.
 *
 * WHAT "FACULTY SCOPE" MEANS
 * -------------------------
 * A teacher may see a student if and only if they teach them. That is derived
 * from `vw_teacher_class_roster`, which pairs a teacher to a student only when
 * the timetable puts the teacher in front of that section for that subject AND
 * the student is enrolled in it.
 *
 * This is deliberately stricter than the rest of the backend. The shared
 * helper `mayAccessStudent` in selfScope.middleware.js returns true for ANY
 * teacher against ANY student — every teacher can currently read every
 * student's marks and documents through the REST routes. That is a real gap,
 * but widening the assistant to match it would be the wrong direction: the
 * portal at least requires someone to navigate deliberately to a record,
 * whereas an assistant will happily list two thousand students in response to
 * one sentence. The assistant uses the timetable-derived rule instead, which
 * is the same rule the faculty portal itself applies in
 * facultyPortalService.resolveTeacher / timetableRowsFor.
 */

const { ROLES } = require("../../config/roles");
const { readonlySequelize } = require("../../database/readonlyConnection");

const SELECT = { type: "SELECT" };

const query = async (sql, replacements) =>
    readonlySequelize.query(sql, {
        type: readonlySequelize.QueryTypes.SELECT,
        replacements
    });

/*
 * A short-lived cache, keyed by user.
 *
 * The alternative is four queries on every chat turn, including the roster
 * query, which is the expensive one. Sixty seconds is chosen so that a
 * revoked assignment takes effect within a minute — long enough to absorb the
 * several tool calls a single question produces, short enough that nobody
 * would describe the stale window as a security property being traded away.
 */
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const cached = (key) => {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.value;
};

const remember = (key, value) => {
    cache.set(key, { value, at: Date.now() });
    return value;
};

/** Clears a user's cached scope. Call after an assignment change. */
const invalidate = (userId) => cache.delete(`scope:${userId}`);

// ------------------------------------------------------------------ student

const resolveStudentScope = async (userId) => {

    const rows = await query(
        `SELECT student_id, registration_number, full_name, program_id,
                program_name, department_id, batch_id, section_id,
                current_semester_id, current_semester_number
           FROM vw_student_profile_full
          WHERE user_id = :userId
          LIMIT 1`,
        { userId }
    );

    if (!rows.length) return null;

    const student = rows[0];

    return {
        kind: "student",

        // The single value every student tool filters on. No tool accepts a
        // student_id argument from the model; they all read this.
        studentId: student.student_id,

        registrationNumber: student.registration_number,
        fullName: student.full_name,
        programId: student.program_id,
        programName: student.program_name,
        departmentId: student.department_id,
        batchId: student.batch_id,
        sectionId: student.section_id,
        semesterId: student.current_semester_id,
        semesterNumber: student.current_semester_number
    };
};

// ------------------------------------------------------------------ teacher

const resolveTeacherScope = async (userId) => {

    const rows = await query(
        `SELECT t.teacher_id, e.employee_id, e.first_name, e.last_name,
                e.department_id, d.department_name
           FROM teachers t
           JOIN employees e ON e.employee_id = t.employee_id
      LEFT JOIN departments d ON d.department_id = e.department_id
          WHERE e.user_id = :userId
            AND t.is_deleted = 0
            AND e.is_deleted = 0
          LIMIT 1`,
        { userId }
    );

    if (!rows.length) return null;

    const teacher = rows[0];

    // The classes this teacher actually stands in front of, and the students
    // on them. One query rather than three, because every id set below is a
    // projection of the same roster.
    const roster = await query(
        `SELECT DISTINCT subject_id, section_id, batch_id, semester_id, student_id
           FROM vw_teacher_class_roster
          WHERE teacher_id = :teacherId`,
        { teacherId: teacher.teacher_id }
    );

    const subjectIds = [...new Set(roster.map((r) => r.subject_id))];
    const sectionIds = [...new Set(roster.map((r) => r.section_id))];
    const batchIds = [...new Set(roster.map((r) => r.batch_id).filter(Boolean))];
    const semesterIds = [...new Set(roster.map((r) => r.semester_id).filter(Boolean))];
    const studentIds = new Set(roster.map((r) => r.student_id));

    return {
        kind: "teacher",

        teacherId: teacher.teacher_id,
        employeeId: teacher.employee_id,
        fullName: `${teacher.first_name} ${teacher.last_name}`,
        departmentId: teacher.department_id,
        departmentName: teacher.department_name,

        subjectIds,
        sectionIds,
        batchIds,
        semesterIds,

        // Kept as a Set for the membership test, which is the hot path — it is
        // consulted once per student a tool is about to return.
        studentIds,

        // The (subject, section) pairs, which is what "my classes" means.
        classes: [
            ...new Map(
                roster.map((r) => [`${r.subject_id}:${r.section_id}`, {
                    subjectId: r.subject_id,
                    sectionId: r.section_id
                }])
            ).values()
        ]
    };
};

// -------------------------------------------------------------------- admin

const resolveAdminScope = async (userId, roleId) => {

    /*
     * The one thing an admin scope has to look up.
     *
     * An administrator is a `users` row and nothing else - no student, no
     * employee, no parent record - so unlike the two branches above there is
     * no profile query already happening that a name can ride along on. This
     * is a single indexed primary-key read, and the result is held by the
     * same sixty-second scope cache as everything else, so it costs one query
     * per admin per minute rather than one per chat turn.
     *
     * Worth that much because the alternative is what shipped: no name at all
     * on an admin scope, so the assistant either greeted them by a value the
     * frontend had guessed from their email address, or by nothing.
     *
     * Failure is non-fatal on purpose. A nameless greeting is a small loss; a
     * chatbot that 500s because it could not read a display name is not.
     */
    let fullName = null;

    try {
        const rows = await query(
            `SELECT full_name FROM users WHERE user_id = :userId LIMIT 1`,
            { userId }
        );
        fullName = rows[0]?.full_name || null;
    } catch (error) {
        console.warn(`[scope] admin name lookup failed: ${error.message}`);
    }

    return {
        kind: "admin",
        userId,
        roleId,
        fullName,

        // Stated rather than implied, so a tool reads `scope.unrestricted` and
        // does not have to know which role ids are administrative.
        unrestricted: true
    };
};

// ---------------------------------------------------------------- resolveFor

/**
 * Resolves the scope for an authenticated request.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because every failure
 * here is a thing the user needs to be told in plain words — a teacher whose
 * account is not linked to an employee record is a real situation, not an
 * exception.
 */
const resolveFor = async (user) => {

    if (!user || !user.user_id) {
        return { ok: false, reason: "not authenticated" };
    }

    const key = `scope:${user.user_id}`;
    const hit = cached(key);
    if (hit) return hit;

    const base = {
        userId: user.user_id,
        roleId: user.role_id
    };

    let resolved;

    switch (user.role_id) {

        case ROLES.SUPER_ADMIN:
        case ROLES.ADMIN:
            resolved = await resolveAdminScope(user.user_id, user.role_id);
            break;

        case ROLES.TEACHER: {
            resolved = await resolveTeacherScope(user.user_id);

            if (!resolved) {
                return {
                    ok: false,
                    reason:
                        "This account is not linked to a teacher record, so there " +
                        "are no classes to answer questions about."
                };
            }

            // A teacher with no timetable rows is a valid account with an
            // empty scope. Saying so is far better than every tool returning
            // an empty list and the assistant implying the data does not exist.
            if (!resolved.classes.length) {
                resolved.emptyScopeReason =
                    "No classes are currently assigned to you in the timetable.";
            }
            break;
        }

        case ROLES.STUDENT:
            resolved = await resolveStudentScope(user.user_id);

            if (!resolved) {
                return {
                    ok: false,
                    reason:
                        "This account is not linked to a student record, so there " +
                        "is no academic information to report."
                };
            }
            break;

        /*
         * Parent resolves to a documentation-only scope.
         *
         * There is no ward lookup here and deliberately no studentIds. This
         * scope is reachable from /api/chatbot, which has no database tools,
         * and is rejected at the route by /api/assistant and /api/analytics,
         * whose role lists exclude parent — so canSeeStudent and the other
         * predicates below never receive it.
         *
         * If parent is ever given data tools, THIS is the branch that must
         * grow a ward list first. It returns a named kind rather than an
         * unrestricted scope so that forgetting to do so fails visibly.
         */
        case ROLES.PARENT: {

            /*
             * A display name, and deliberately nothing else.
             *
             * There is still no ward lookup here and still no studentIds - see
             * the note above. Reading `users.full_name` does not widen this
             * scope, because a name is not a permission; it is what lets the
             * documentation-only chatbot greet a parent by name instead of by
             * "there".
             */
            let fullName = null;

            try {
                const rows = await query(
                    `SELECT full_name FROM users WHERE user_id = :userId LIMIT 1`,
                    { userId: user.user_id }
                );
                fullName = rows[0]?.full_name || null;
            } catch (error) {
                console.warn(`[scope] parent name lookup failed: ${error.message}`);
            }

            resolved = { kind: "parent", documentationOnly: true, fullName };
            break;
        }

        default:
            // HR, Accountant, Library. The route rejects these before
            // reaching here; this is the second line, so that a future caller
            // that forgets the route guard fails closed rather than open.
            return {
                ok: false,
                reason: "The assistant is not available for this account type."
            };
    }

    return remember(key, { ok: true, ...base, ...resolved });
};

// ------------------------------------------------------------- authorization

/**
 * May this scope see this student?
 *
 * The one function every student-addressed tool must call. Admin: yes.
 * Student: only themselves. Teacher: only someone on a roster of theirs.
 */
const maySeeStudent = (scope, studentId) => {

    const target = Number(studentId);
    if (!Number.isInteger(target)) return false;

    if (scope.kind === "admin") return true;
    if (scope.kind === "student") return scope.studentId === target;
    if (scope.kind === "teacher") return scope.studentIds.has(target);

    return false;
};

/** May this scope see this (subject, section) class? */
const maySeeClass = (scope, subjectId, sectionId) => {

    if (scope.kind === "admin") return true;

    if (scope.kind === "teacher") {
        return scope.classes.some(
            (c) => c.subjectId === Number(subjectId)
                && c.sectionId === Number(sectionId)
        );
    }

    // A student may see a class they are in, which for these purposes means
    // their own section.
    if (scope.kind === "student") {
        return scope.sectionId === Number(sectionId);
    }

    return false;
};

/**
 * A compact description of the scope, for the query log and for the system
 * prompt. The full student id set is summarised rather than serialised — it
 * runs to hundreds of ids and neither the log nor the model needs them.
 */
const describe = (scope) => {

    if (scope.kind === "admin") {
        return { kind: "admin", unrestricted: true };
    }

    if (scope.kind === "student") {
        return {
            kind: "student",
            studentId: scope.studentId,
            programId: scope.programId,
            sectionId: scope.sectionId,
            semesterId: scope.semesterId
        };
    }

    /*
     * Parent carries no ids to summarise. Named explicitly rather than left to
     * fall through: the teacher branch below reads scope.studentIds.size, and
     * on a parent scope that is a TypeError rather than a wrong answer.
     */
    if (scope.kind === "parent") {
        return { kind: "parent", documentationOnly: true };
    }

    return {
        kind: "teacher",
        teacherId: scope.teacherId,
        departmentId: scope.departmentId,
        subjectIds: scope.subjectIds,
        sectionIds: scope.sectionIds,
        studentCount: scope.studentIds.size
    };
};

module.exports = {
    resolveFor,
    maySeeStudent,
    maySeeClass,
    describe,
    invalidate
};
