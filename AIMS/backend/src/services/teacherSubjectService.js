/*
 * The qualification registry: which subjects each teacher is competent to
 * teach.
 *
 * WHAT THIS TABLE MEANS, NOW THAT OFFERINGS EXIST
 * ----------------------------------------------
 * There are two different facts about a teacher and a subject, and they were
 * previously tangled in this one table:
 *
 *   qualification - "Dr Anwar MAY teach CS-501"      -> teacher_subjects
 *   assignment    - "Dr Anwar TEACHES CS-501 to
 *                    BSCS-2023-A in Fall 2026"       -> course_offerings
 *
 * `course_offerings` took the assignment half when the timetable module
 * landed. What is left here is the qualification, which is a standing fact
 * about a person: it has no term, no section and - since migration
 * `…140000` - no batch. Competence to teach Computer Networks does not expire
 * when a new intake arrives.
 *
 * WHY IT MATTERS THAT ANYTHING CAN WRITE IT
 * -----------------------------------------
 * This registry is what sorts the staffing shortlist on the timetable screen.
 * Until now nothing in the portal could write it - the endpoints existed but
 * no screen called them - so the only rows in it were whatever the
 * provisioning service happened to insert when an account was created. A
 * teacher hired afterwards had none, and was permanently filed under
 * "everyone else" with no way to correct it.
 *
 * WHAT THIS SERVICE REFUSES
 * -------------------------
 * Deliberately, very little. A qualification is an administrative judgement,
 * not a derivable fact: a department may reasonably hand a subject to somebody
 * outside its own department, and a system that argues about that gets worked
 * around. The service checks that both rows exist and are not deleted, and
 * stops there.
 *
 * The one thing it does refuse is REMOVING a qualification the teacher is
 * currently teaching against - see `revoke`. That is not a rule about
 * competence; it is refusing to let the registry contradict the timetable.
 */

const { sequelize } = require("../database/connection");

const query = (sql, replacements) =>
    sequelize.query(sql, {
        replacements,
        type: sequelize.QueryTypes.SELECT
    });

const execute = (sql, replacements, type) =>
    sequelize.query(sql, { replacements, type: type || sequelize.QueryTypes.UPDATE });

class QualificationError extends Error {
    constructor(message, statusCode = 400, details) {
        super(message);
        this.name = "QualificationError";
        this.statusCode = statusCode;
        if (details) this.details = details;
    }
}

const asId = (value) => {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
};

/* ------------------------------------------------------------ lookups --- */

const requireTeacher = async (teacherId) => {
    const [row] = await query(
        `SELECT t.teacher_id, emp.first_name, emp.last_name
           FROM teachers t
           JOIN employees emp ON emp.employee_id = t.employee_id
          WHERE t.teacher_id = :teacherId
            AND t.is_deleted = 0 AND emp.is_deleted = 0`,
        { teacherId }
    );

    if (!row) throw new QualificationError(`No teacher ${teacherId}.`, 404);

    return {
        teacher_id: row.teacher_id,
        name: [row.first_name, row.last_name].filter(Boolean).join(" ")
    };
};

const requireSubject = async (subjectId) => {
    const [row] = await query(
        `SELECT subject_id, subject_code, subject_name
           FROM subjects
          WHERE subject_id = :subjectId AND is_deleted = 0`,
        { subjectId }
    );

    if (!row) throw new QualificationError(`No subject ${subjectId}.`, 404);

    return row;
};

/* ------------------------------------------------------------ reading --- */

/*
 * One row per teacher, with the subjects they hold nested inside it.
 *
 * A flat join returns one row per qualification, which is the shape the table
 * has and the wrong shape for the screen: the screen edits a teacher's whole
 * set at once, so it would have to regroup 41 rows into 24 people before it
 * could draw anything. Grouping here means one request and no client-side
 * assembly.
 *
 * `teaching_now` is the count of live offerings held against each subject. It
 * is what makes a revoke safe to offer or not, and it is cheaper to compute
 * once here than to ask per row when the admin clicks.
 */
const listQualifications = async (filters = {}) => {
    const clauses = ["t.is_deleted = 0", "emp.is_deleted = 0"];
    const replacements = {};

    const teacherId = asId(filters.teacher_id);
    if (teacherId) {
        clauses.push("t.teacher_id = :teacherId");
        replacements.teacherId = teacherId;
    }

    const departmentId = asId(filters.department_id);
    if (departmentId) {
        clauses.push("emp.department_id = :departmentId");
        replacements.departmentId = departmentId;
    }

    if (filters.q) {
        clauses.push(
            `(CONCAT(emp.first_name, ' ', emp.last_name) LIKE :q
              OR t.specialization LIKE :q
              OR emp.employee_code LIKE :q
              OR EXISTS (SELECT 1 FROM teacher_subjects ts2
                           JOIN subjects s2 ON s2.subject_id = ts2.subject_id
                          WHERE ts2.teacher_id = t.teacher_id
                            AND (s2.subject_code LIKE :q OR s2.subject_name LIKE :q)))`
        );
        replacements.q = `%${filters.q}%`;
    }

    /*
     * `unqualified_only` is the filter the screen actually opens on. The whole
     * reason to visit this registry is the teachers who have nothing recorded,
     * and finding them by eye in a list of 24 is the sort of thing that gets
     * skipped.
     */
    if (filters.unqualified_only === "1" || filters.unqualified_only === true) {
        clauses.push(
            `NOT EXISTS (SELECT 1 FROM teacher_subjects ts3
                          WHERE ts3.teacher_id = t.teacher_id)`
        );
    }

    const teachers = await query(
        `SELECT t.teacher_id, t.specialization,
                emp.first_name, emp.last_name, emp.designation,
                emp.employee_code, emp.department_id,
                d.department_name, usr.email
           FROM teachers t
           JOIN employees emp ON emp.employee_id = t.employee_id
      LEFT JOIN departments d ON d.department_id = emp.department_id
      LEFT JOIN users usr     ON usr.user_id     = emp.user_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY emp.first_name, emp.last_name`,
        replacements
    );

    if (!teachers.length) return [];

    const ids = teachers.map((t) => t.teacher_id);

    const rows = await query(
        `SELECT ts.teacher_id,
                sub.subject_id, sub.subject_code, sub.subject_name,
                sub.credit_hours, sub.semester_id,
                sem.semester_number, p.program_id, p.program_name,
                -- Live classes held against this qualification. A revoke is
                -- refused while this is non-zero, so the screen needs it to
                -- disable the control rather than offer a certain failure.
                (SELECT COUNT(*) FROM course_offerings o
                  WHERE o.teacher_id = ts.teacher_id
                    AND o.subject_id = ts.subject_id
                    AND o.is_deleted = 0
                    AND o.status <> 'Cancelled') AS teaching_now
           FROM teacher_subjects ts
           JOIN subjects  sub ON sub.subject_id  = ts.subject_id
                              AND sub.is_deleted = 0
           JOIN semesters sem ON sem.semester_id = sub.semester_id
           JOIN programs  p   ON p.program_id    = sem.program_id
          WHERE ts.teacher_id IN (:ids)
          ORDER BY p.program_name, sem.semester_number, sub.subject_code`,
        { ids }
    );

    const byTeacher = new Map();
    for (const r of rows) {
        const list = byTeacher.get(r.teacher_id) || [];
        list.push({
            subject_id: r.subject_id,
            subject_code: r.subject_code,
            subject_name: r.subject_name,
            credit_hours: Number(r.credit_hours),
            semester_id: r.semester_id,
            semester_number: Number(r.semester_number),
            program_id: r.program_id,
            program_name: r.program_name,
            teaching_now: Number(r.teaching_now) || 0
        });
        byTeacher.set(r.teacher_id, list);
    }

    return teachers.map((t) => ({
        teacher_id: t.teacher_id,
        name: [t.first_name, t.last_name].filter(Boolean).join(" "),
        email: t.email,
        employee_code: t.employee_code,
        designation: t.designation,
        specialization: t.specialization,
        department_id: t.department_id,
        department_name: t.department_name,
        subjects: byTeacher.get(t.teacher_id) || []
    }));
};

/*
 * Who is qualified for one subject. The registry read from the other
 * direction, which is the question asked when a class needs staffing.
 */
const listTeachersForSubject = async (subjectId) => {
    const subject = await requireSubject(subjectId);

    const teachers = await query(
        `SELECT t.teacher_id, t.specialization,
                emp.first_name, emp.last_name, emp.designation
           FROM teacher_subjects ts
           JOIN teachers  t   ON t.teacher_id     = ts.teacher_id
                              AND t.is_deleted    = 0
           JOIN employees emp ON emp.employee_id  = t.employee_id
                              AND emp.is_deleted  = 0
          WHERE ts.subject_id = :subjectId
          ORDER BY emp.first_name, emp.last_name`,
        { subjectId: subject.subject_id }
    );

    return {
        subject,
        teachers: teachers.map((t) => ({
            teacher_id: t.teacher_id,
            name: [t.first_name, t.last_name].filter(Boolean).join(" "),
            designation: t.designation,
            specialization: t.specialization
        }))
    };
};

/* ------------------------------------------------------------ writing --- */

/*
 * Recording one qualification.
 *
 * INSERT IGNORE rather than a check-then-insert: the key is (teacher,
 * subject), so a repeat is a no-op at the database level and there is no race
 * to lose. The response says which of the two happened, because "added" and
 * "already there" look identical from the outside and a screen that cannot
 * tell them apart cannot report honestly.
 */
const grant = async ({ teacher_id, subject_id }) => {
    const teacherId = asId(teacher_id);
    const subjectId = asId(subject_id);

    if (!teacherId) throw new QualificationError("A numeric teacher_id is required.", 400);
    if (!subjectId) throw new QualificationError("A numeric subject_id is required.", 400);

    const teacher = await requireTeacher(teacherId);
    const subject = await requireSubject(subjectId);

    const [, affected] = await execute(
        `INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id)
         VALUES (:teacherId, :subjectId)`,
        { teacherId, subjectId },
        sequelize.QueryTypes.INSERT
    );

    const added = Number(affected) > 0;

    return {
        teacher,
        subject,
        outcome: added ? "added" : "already_recorded",
        message: added
            ? `${teacher.name} is now recorded as qualified for ${subject.subject_code}.`
            : `${teacher.name} was already recorded for ${subject.subject_code}.`
    };
};

/*
 * Removing one qualification.
 *
 * Refused while the teacher holds a live class in that subject. The registry
 * and the timetable would otherwise disagree out loud: the staffing dialog
 * would stop flagging them as qualified for a class they are, at that moment,
 * standing in front of. The refusal names the classes, because "cannot remove"
 * with no reason is a dead end - the admin needs to know what to reassign.
 */
const revoke = async (teacherId, subjectId) => {
    const tId = asId(teacherId);
    const sId = asId(subjectId);

    if (!tId || !sId) {
        throw new QualificationError(
            "Both teacher_id and subject_id must be numeric.",
            400
        );
    }

    const [existing] = await query(
        `SELECT 1 AS found FROM teacher_subjects
          WHERE teacher_id = :tId AND subject_id = :sId`,
        { tId, sId }
    );

    if (!existing) {
        throw new QualificationError(
            "That qualification is not recorded, so there is nothing to remove.",
            404
        );
    }

    const held = await query(
        `SELECT sec.section_name, term.term_name
           FROM course_offerings o
           JOIN sections sec       ON sec.section_id = o.section_id
           JOIN academic_terms term ON term.term_id  = o.term_id
          WHERE o.teacher_id = :tId
            AND o.subject_id = :sId
            AND o.is_deleted = 0
            AND o.status <> 'Cancelled'
          ORDER BY term.start_date DESC, sec.section_name`,
        { tId, sId }
    );

    if (held.length) {
        const subject = await requireSubject(sId);
        const teacher = await requireTeacher(tId);
        const list = held
            .map((h) => `${h.section_name} (${h.term_name})`)
            .join(", ");

        throw new QualificationError(
            `${teacher.name} is currently teaching ${subject.subject_code} to ` +
                `${list}. Reassign ${held.length === 1 ? "that class" : "those classes"} ` +
                "before removing the qualification.",
            409,
            { classes: held }
        );
    }

    await execute(
        `DELETE FROM teacher_subjects
          WHERE teacher_id = :tId AND subject_id = :sId`,
        { tId, sId },
        sequelize.QueryTypes.DELETE
    );

    return { outcome: "removed", teacher_id: tId, subject_id: sId };
};

/*
 * Replacing a teacher's whole set in one call.
 *
 * This is what the editor submits: the admin ticks boxes and saves once, so
 * the natural payload is the resulting set, not a list of deltas the client
 * would have to compute (and would compute wrongly the first time two admins
 * had the screen open).
 *
 * Everything runs in one transaction. A half-applied set - some added, one
 * revoke refused - would leave the registry in a state nobody chose, and the
 * admin with no way to tell which half landed.
 */
const setQualifications = async (teacherId, subjectIds) => {
    const tId = asId(teacherId);
    if (!tId) throw new QualificationError("A numeric teacher_id is required.", 400);

    if (!Array.isArray(subjectIds)) {
        throw new QualificationError("subject_ids must be an array.", 400);
    }

    const teacher = await requireTeacher(tId);

    const wanted = [...new Set(subjectIds.map(asId).filter(Boolean))];

    // Every id must resolve before anything is written, so an unknown subject
    // fails the whole save rather than silently dropping one tick box.
    for (const id of wanted) {
        await requireSubject(id);
    }

    const current = await query(
        "SELECT subject_id FROM teacher_subjects WHERE teacher_id = :tId",
        { tId }
    );

    const held = new Set(current.map((r) => r.subject_id));
    const toAdd = wanted.filter((id) => !held.has(id));
    const toRemove = [...held].filter((id) => !wanted.includes(id));

    /*
     * The same protection as `revoke`, applied to the whole removal set before
     * a single row moves. Checked up front rather than per row so the refusal
     * lists every blocker at once - discovering them one save at a time is the
     * behaviour that makes people give up on a screen.
     */
    if (toRemove.length) {
        const blocked = await query(
            `SELECT sub.subject_code, sec.section_name, term.term_name
               FROM course_offerings o
               JOIN subjects sub        ON sub.subject_id = o.subject_id
               JOIN sections sec        ON sec.section_id = o.section_id
               JOIN academic_terms term ON term.term_id   = o.term_id
              WHERE o.teacher_id = :tId
                AND o.subject_id IN (:toRemove)
                AND o.is_deleted = 0
                AND o.status <> 'Cancelled'
              ORDER BY sub.subject_code`,
            { tId, toRemove }
        );

        if (blocked.length) {
            const list = blocked
                .map((b) => `${b.subject_code} for ${b.section_name} (${b.term_name})`)
                .join(", ");

            throw new QualificationError(
                `${teacher.name} is still teaching ${list}. Reassign ` +
                    `${blocked.length === 1 ? "that class" : "those classes"} ` +
                    "before removing the qualification.",
                409,
                { classes: blocked }
            );
        }
    }

    const transaction = await sequelize.transaction();

    try {
        if (toRemove.length) {
            await sequelize.query(
                `DELETE FROM teacher_subjects
                  WHERE teacher_id = :tId AND subject_id IN (:toRemove)`,
                { replacements: { tId, toRemove }, transaction }
            );
        }

        for (const id of toAdd) {
            await sequelize.query(
                `INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id)
                 VALUES (:tId, :id)`,
                { replacements: { tId, id }, transaction }
            );
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    const parts = [];
    if (toAdd.length) parts.push(`${toAdd.length} added`);
    if (toRemove.length) parts.push(`${toRemove.length} removed`);

    return {
        teacher,
        added: toAdd,
        removed: toRemove,
        total: wanted.length,
        message: parts.length
            ? `${teacher.name}: ${parts.join(", ")}. Now qualified for ${wanted.length} subject${wanted.length === 1 ? "" : "s"}.`
            : `No change - ${teacher.name} was already recorded for exactly these ${wanted.length} subject${wanted.length === 1 ? "" : "s"}.`
    };
};

module.exports = {
    QualificationError,
    listQualifications,
    listTeachersForSubject,
    grant,
    revoke,
    setQualifications
};
