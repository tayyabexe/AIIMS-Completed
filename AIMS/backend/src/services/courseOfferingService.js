/*
 * Course offerings: creating classes, staffing them, and putting students in
 * them.
 *
 * An offering is one class - this section studies this subject with this
 * teacher this term. It is the row the schema was missing, and the reason the
 * question "who teaches this student" had no join that answered it. See
 * 20260822092000-create-course-offerings.js for the full argument.
 *
 * WHAT THIS MODULE OWNS
 * ---------------------
 * It is the only writer of `course_offerings`, and - together with
 * schedulingService - the only writer of `timetables`. That matters because
 * `timetables` still carries its own section_id, subject_id and teacher_id as
 * a denormalised copy of the offering's. Those columns are what the
 * double-booking indexes are built on, so they cannot be dropped; keeping them
 * true is therefore a job somebody has to do, and this module is where that
 * job lives. Any other code path writing a timetable row directly can put a
 * teacher on the grid who does not teach the class.
 *
 * THE THREE-STEP LIFECYCLE
 * ------------------------
 *   1. create   - the class exists. No teacher, no grid, no students.
 *   2. staff    - a teacher is assigned. Now it can be scheduled.
 *   3. enrol    - the section's students are put in it, in one action.
 *
 * They are separate because they happen at different times and are decided by
 * different people: classes are planned months ahead, teaching load is
 * allocated later, and enrolment waits on the term starting. Collapsing them
 * into one "create class" call would force all three decisions at the earliest
 * moment any of them is known.
 */

const { sequelize } = require("../database/connection");
const schedulingService = require("./schedulingService");

const query = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

const execute = (sql, replacements, type) =>
    sequelize.query(sql, { replacements, type: type || sequelize.QueryTypes.UPDATE });

// Same contract as SchedulingError: `statusCode` is what utils/apiError.js
// reads, so a caller's mistake does not surface as a 500.
class OfferingError extends Error {
    constructor(message, statusCode = 400, details = null) {
        super(message);
        this.name = "OfferingError";
        this.statusCode = statusCode;
        this.details = details;
    }
}

// =====================================================================
// TERMS
// =====================================================================

const listTerms = async ({ includeClosed = true } = {}) => {
    const rows = await query(
        `SELECT t.term_id, t.term_code, t.term_name, t.start_date, t.end_date,
                t.status,
                (SELECT COUNT(*) FROM course_offerings o
                  WHERE o.term_id = t.term_id AND o.is_deleted = 0) AS offering_count,
                (SELECT COUNT(*) FROM timetables tt
                  WHERE tt.term_id = t.term_id) AS session_count
           FROM academic_terms t
          WHERE t.is_deleted = 0
            AND (:includeClosed = 1 OR t.status <> 'Closed')
          ORDER BY t.start_date DESC`,
        { includeClosed: includeClosed ? 1 : 0 }
    );

    return rows.map((r) => ({
        ...r,
        offering_count: Number(r.offering_count) || 0,
        session_count: Number(r.session_count) || 0
    }));
};

/*
 * The term everything defaults to when a caller does not name one.
 *
 * Active first, and the most recent if somehow more than one is Active -
 * nothing in the schema forbids two, because a university genuinely can have
 * an overlapping summer session, and refusing to answer in that case would
 * break every screen rather than the one that caused it.
 *
 * Falling back to the nearest Planned term means the admin building next year
 * lands on it automatically instead of an empty screen.
 */
const getCurrentTerm = async () => {
    const rows = await query(
        `SELECT term_id, term_code, term_name, start_date, end_date, status
           FROM academic_terms
          WHERE is_deleted = 0
            AND status IN ('Active', 'Planned')
          ORDER BY FIELD(status, 'Active', 'Planned'), start_date DESC
          LIMIT 1`
    );

    return rows[0] || null;
};

const requireTerm = async (termId) => {
    const rows = await query(
        `SELECT term_id, term_code, term_name, status
           FROM academic_terms
          WHERE term_id = :termId AND is_deleted = 0
          LIMIT 1`,
        { termId }
    );

    if (!rows.length) throw new OfferingError(`No academic term ${termId}.`, 404);

    return rows[0];
};

// A closed term is the historical record of what was taught. Nothing about it
// changes, which is the whole reason it is kept.
const assertTermOpen = (term, action) => {
    if (term.status === "Closed") {
        throw new OfferingError(
            `${term.term_name} is closed, so ${action} is not possible. ` +
                "Its record is kept as taught.",
            422
        );
    }
};

const createTerm = async ({ term_code, term_name, start_date, end_date, status }) => {
    if (!term_code || !term_name || !start_date || !end_date) {
        throw new OfferingError(
            "term_code, term_name, start_date and end_date are all required.",
            400
        );
    }

    if (new Date(end_date) <= new Date(start_date)) {
        throw new OfferingError("A term must end after it starts.", 400);
    }

    const clash = await query(
        "SELECT term_id FROM academic_terms WHERE term_code = :code LIMIT 1",
        { code: term_code }
    );

    if (clash.length) {
        throw new OfferingError(`A term with the code ${term_code} already exists.`, 409);
    }

    const [termId] = await execute(
        `INSERT INTO academic_terms
              (term_code, term_name, start_date, end_date, status, is_deleted)
         VALUES (:code, :name, :startDate, :endDate, :status, 0)`,
        {
            code: term_code,
            name: term_name,
            startDate: start_date,
            endDate: end_date,
            status: status || "Planned"
        },
        sequelize.QueryTypes.INSERT
    );

    return (await listTerms()).find((t) => t.term_id === termId);
};

/*
 * Moving a term through its lifecycle.
 *
 * Planned -> Active also flips every scheduled class in it to Active, because
 * "the term has started" and "its classes have started" are the same event and
 * making the admin do the second by hand invites them to forget.
 *
 * Active -> Closed does the same with Completed. Closing is deliberately not
 * reversible here: a Closed term is what results and transcripts were built
 * against, and re-opening one is a data-repair job, not a button.
 */
const setTermStatus = async (termId, status) => {
    const term = await requireTerm(termId);

    if (!["Planned", "Active", "Closed"].includes(status)) {
        throw new OfferingError(
            `${status} is not a term status. Use Planned, Active or Closed.`,
            400
        );
    }

    if (term.status === "Closed") {
        throw new OfferingError(
            `${term.term_name} is already closed. Re-opening a closed term is a ` +
                "data-repair operation and is not done from here.",
            422
        );
    }

    /*
     * THE RULE: at most one term is Active at a time.
     *
     * Nothing enforced this, so two terms could both be Active — and the
     * system then disagreed with itself about which one "now" meant. The admin
     * screen defaults to the Active term and picked one of them; every portal
     * query resolves the current term with `ORDER BY start_date LIMIT 1` and
     * picked the other. A student's timetable and the timetable being edited
     * were then different terms, with nothing on screen saying so.
     *
     * Refused rather than silently demoting the other one. Activating a term
     * is how a year starts; closing one is one-way and completes every
     * enrolment in it, so doing that as a side effect of activating its
     * successor would be a destructive act nobody asked for.
     */
    if (status === "Active") {
        const clashes = await query(
            `SELECT term_id, term_name FROM academic_terms
              WHERE status = 'Active' AND term_id <> :termId
              LIMIT 1`,
            { termId }
        );

        if (clashes.length) {
            throw new OfferingError(
                `${clashes[0].term_name} is already the active term. Close it first — `
                    + "two active terms would leave the portals and the timetable "
                    + "editor disagreeing about which year is current.",
                409,
                { active_term_id: clashes[0].term_id, active_term_name: clashes[0].term_name }
            );
        }
    }

    await execute("UPDATE academic_terms SET status = :status WHERE term_id = :termId", {
        status,
        termId
    });

    if (status === "Active") {
        await execute(
            `UPDATE course_offerings
                SET status = 'Active'
              WHERE term_id = :termId AND is_deleted = 0 AND status = 'Scheduled'`,
            { termId }
        );
    }

    if (status === "Closed") {
        await execute(
            `UPDATE course_offerings
                SET status = 'Completed'
              WHERE term_id = :termId AND is_deleted = 0
                AND status IN ('Draft', 'Scheduled', 'Active')`,
            { termId }
        );

        await execute(
            `UPDATE enrollments
                SET status = 'Completed'
              WHERE term_id = :termId AND status = 'Active'`,
            { termId }
        );
    }

    return requireTerm(termId);
};

// =====================================================================
// OFFERINGS
// =====================================================================

const OFFERING_SELECT = `
    SELECT o.offering_id, o.term_id, o.section_id, o.subject_id, o.teacher_id,
           -- THE RULE: the subject says how often a class meets; the offering
           -- only overrides it when somebody deliberately set one. NULL on the
           -- offering means "follow the curriculum".
           COALESCE(o.sessions_per_week, sub.sessions_per_week) AS sessions_per_week,
           o.sessions_per_week AS sessions_override,
           o.required_room_type, o.max_seats, o.status,
           o.created_at,
           term.term_code, term.term_name, term.status AS term_status,
           sub.subject_code, sub.subject_name, sub.credit_hours,
           sub.semester_id,
           sem.semester_number,
           sec.section_name, sec.capacity AS section_capacity,
           b.batch_id, b.batch_name,
           p.program_id, p.program_name,
           emp.first_name AS teacher_first_name,
           emp.last_name  AS teacher_last_name,
           (SELECT COUNT(*) FROM timetables t
             WHERE t.offering_id = o.offering_id) AS placed_sessions,
           (SELECT COUNT(*) FROM enrollments e
                              JOIN students es ON es.student_id = e.student_id
                                              AND es.is_deleted = 0
                                              AND es.academic_status = 'Active'
                             WHERE e.offering_id = o.offering_id
                               AND e.status = 'Active') AS enrolled_count,
           (SELECT COUNT(*) FROM students st
             WHERE st.section_id = o.section_id
               AND st.is_deleted = 0
               AND st.academic_status = 'Active') AS section_headcount
      FROM course_offerings o
      JOIN academic_terms term ON term.term_id   = o.term_id
      JOIN subjects       sub  ON sub.subject_id = o.subject_id
      JOIN semesters      sem  ON sem.semester_id = sub.semester_id
      JOIN sections       sec  ON sec.section_id = o.section_id
      JOIN batches        b    ON b.batch_id     = sec.batch_id
      JOIN programs       p    ON p.program_id   = b.program_id
 LEFT JOIN teachers       tch  ON tch.teacher_id = o.teacher_id
 LEFT JOIN employees      emp  ON emp.employee_id = tch.employee_id
`;

const shapeOffering = (row) => {
    const placed = Number(row.placed_sessions) || 0;
    const required = Number(row.sessions_per_week) || 0;

    return {
        offering_id: row.offering_id,
        term: {
            term_id: row.term_id,
            term_code: row.term_code,
            term_name: row.term_name,
            status: row.term_status
        },
        subject: {
            subject_id: row.subject_id,
            subject_code: row.subject_code,
            subject_name: row.subject_name,
            credit_hours: Number(row.credit_hours),
            semester_id: row.semester_id,
            semester_number: Number(row.semester_number)
        },
        section: {
            section_id: row.section_id,
            section_name: row.section_name,
            capacity: Number(row.section_capacity),
            headcount: Number(row.section_headcount) || 0,
            batch_id: row.batch_id,
            batch_name: row.batch_name,
            program_id: row.program_id,
            program_name: row.program_name
        },
        teacher: row.teacher_id
            ? {
                  teacher_id: row.teacher_id,
                  name: [row.teacher_first_name, row.teacher_last_name]
                      .filter(Boolean)
                      .join(" ")
              }
            : null,
        sessions_per_week: required,
        placed_sessions: placed,
        sessions_remaining: Math.max(0, required - placed),
        required_room_type: row.required_room_type,
        max_seats: row.max_seats === null ? null : Number(row.max_seats),
        enrolled_count: Number(row.enrolled_count) || 0,
        status: row.status,
        created_at: row.created_at
    };
};

/*
 * WHY `section_headcount` IS ACTIVE STUDENTS ONLY
 * ----------------------------------------------
 * It used to count every non-deleted student, which put it at odds with the
 * one action that consumes it. Cohort enrolment takes Active students, so a
 * section holding 405 rows of which 359 were Active reported "395/405
 * enrolled" - a denominator enrolment could never reach, on a class that was
 * in fact complete.
 *
 * It also fed `class_size`, which is what room capacity is checked against,
 * so classes were being sized for students who had withdrawn or already
 * graduated and would never sit in the room.
 */
const listOfferings = async (filters = {}) => {
    const where = ["o.is_deleted = 0"];
    const replacements = {};

    const filter = (key, column, value) => {
        if (value === undefined || value === null || value === "") return;
        where.push(`${column} = :${key}`);
        replacements[key] = value;
    };

    filter("termId", "o.term_id", filters.term_id);
    filter("sectionId", "o.section_id", filters.section_id);
    filter("subjectId", "o.subject_id", filters.subject_id);
    filter("teacherId", "o.teacher_id", filters.teacher_id);
    filter("batchId", "b.batch_id", filters.batch_id);
    filter("programId", "p.program_id", filters.program_id);
    filter("status", "o.status", filters.status);

    // "Which classes still have nobody teaching them" is the single most asked
    // planning question, and it cannot be expressed as an equality filter.
    if (filters.unstaffed === true || filters.unstaffed === "true") {
        where.push("o.teacher_id IS NULL");
    }

    const rows = await query(
        `${OFFERING_SELECT}
          WHERE ${where.join(" AND ")}
          ORDER BY p.program_name, b.batch_name, sec.section_name, sub.subject_code`,
        replacements
    );

    return rows.map(shapeOffering);
};

const getOffering = async (offeringId) => {
    const rows = await query(
        `${OFFERING_SELECT} WHERE o.offering_id = :offeringId AND o.is_deleted = 0 LIMIT 1`,
        { offeringId }
    );

    if (!rows.length) throw new OfferingError(`No course offering ${offeringId}.`, 404);

    return shapeOffering(rows[0]);
};

/*
 * Creating one class.
 *
 * The subject must belong to the same programme as the section's batch. That
 * check is not paperwork: `subjects.semester_id` points at a semester which
 * points at a programme, so a subject from another degree carries a curriculum
 * stage that means nothing to this section, and every screen that groups by
 * semester_number would then show it under a semester the batch never sits.
 */
const createOffering = async ({
    term_id,
    section_id,
    subject_id,
    teacher_id = null,
    sessions_per_week = null,
    required_room_type = undefined,
    max_seats = null
}) => {
    const term = await requireTerm(term_id);
    assertTermOpen(term, "adding a class to it");

    const [context] = await query(
        `SELECT sec.section_id, sec.section_name,
                b.program_id AS section_program_id,
                b.batch_name,
                sub.subject_id, sub.subject_code, sub.sessions_per_week AS subject_sessions,
                sub.required_room_type AS subject_room_type,
                sem.program_id AS subject_program_id
           FROM sections sec
           JOIN batches  b   ON b.batch_id = sec.batch_id
           JOIN subjects sub ON sub.subject_id = :subjectId AND sub.is_deleted = 0
           JOIN semesters sem ON sem.semester_id = sub.semester_id
          WHERE sec.section_id = :sectionId AND sec.is_deleted = 0
          LIMIT 1`,
        { sectionId: section_id, subjectId: subject_id }
    );

    if (!context) {
        throw new OfferingError(
            `Section ${section_id} or subject ${subject_id} does not exist.`,
            404
        );
    }

    if (Number(context.section_program_id) !== Number(context.subject_program_id)) {
        throw new OfferingError(
            `${context.subject_code} belongs to a different programme than batch ` +
                `${context.batch_name}, so section ${context.section_name} cannot ` +
                "be given it as a class.",
            422
        );
    }

    const duplicate = await query(
        `SELECT offering_id FROM course_offerings
          WHERE term_id = :termId AND section_id = :sectionId
            AND subject_id = :subjectId AND is_deleted = 0
          LIMIT 1`,
        { termId: term_id, sectionId: section_id, subjectId: subject_id }
    );

    if (duplicate.length) {
        throw new OfferingError(
            `Section ${context.section_name} already has ${context.subject_code} ` +
                `in ${term.term_name}.`,
            409,
            { offering_id: duplicate[0].offering_id }
        );
    }

    if (teacher_id !== null && teacher_id !== undefined) {
        await assertTeacherExists(teacher_id);
    }

    const [offeringId] = await execute(
        `INSERT INTO course_offerings
              (term_id, section_id, subject_id, teacher_id, sessions_per_week,
               required_room_type, max_seats, status, is_deleted)
         VALUES (:termId, :sectionId, :subjectId, :teacherId, :sessions,
                 :roomType, :maxSeats, 'Draft', 0)`,
        {
            termId: term_id,
            sectionId: section_id,
            subjectId: subject_id,
            teacherId: teacher_id ?? null,
            /*
             * NULL unless the caller deliberately overrode it.
             *
             * This used to copy the subject's value onto the new row, which is
             * how the two columns drifted apart in the first place: the moment
             * a subject's session count changed, every offering already created
             * kept the old number and nothing said which was right.
             */
            sessions: sessions_per_week ?? null,
            /*
             * Copied from the subject unless overridden. The copy is the point:
             * if the curriculum later decides this subject needs a lab, that
             * must not retroactively make an already-taught timetable invalid.
             * `undefined` means "not supplied"; an explicit null means "this
             * class genuinely has no room requirement".
             */
            roomType: required_room_type === undefined
                ? context.subject_room_type
                : required_room_type,
            maxSeats: max_seats ?? null
        },
        sequelize.QueryTypes.INSERT
    );

    return getOffering(offeringId);
};

/*
 * Creating every class a section needs for one curriculum semester, in one
 * action.
 *
 * This is how a term actually gets built. Doing it subject by subject means
 * twenty-odd identical decisions per section, and the twenty-first is the one
 * that gets forgotten - a class nobody notices is missing until a student asks
 * why it is not on their timetable.
 *
 * Subjects that already have an offering are skipped rather than reported as
 * errors, so the call is safe to repeat after adding a subject to the
 * curriculum. What was created and what was skipped both come back, because
 * "nothing happened" and "everything already existed" look identical otherwise.
 */
const createOfferingsForSection = async ({ term_id, section_id, semester_id }) => {
    const term = await requireTerm(term_id);
    assertTermOpen(term, "adding classes to it");

    const subjects = await query(
        `SELECT sub.subject_id, sub.subject_code, sub.subject_name
           FROM subjects sub
           JOIN semesters sem ON sem.semester_id = sub.semester_id
           JOIN sections sec  ON sec.section_id = :sectionId
           JOIN batches  b    ON b.batch_id = sec.batch_id AND b.program_id = sem.program_id
          WHERE sub.semester_id = :semesterId
            AND sub.is_deleted = 0
            AND sec.is_deleted = 0
          ORDER BY sub.subject_code`,
        { sectionId: section_id, semesterId: semester_id }
    );

    /*
     * Two different failures used to share one message.
     *
     * The query above joins the semester to the section's programme, so an
     * empty result means EITHER "this stage has no subjects" OR "this stage
     * belongs to a different programme entirely" - and the message named only
     * the first. A registrar who picked BBA's Semester 5 for a BSCS section
     * (both are labelled "Semester 5"; only the row id differs) was told the
     * stage was empty when it holds five subjects, and went looking in the
     * curriculum for a problem that was not there.
     *
     * So the two are separated and each is told with the names involved,
     * because "Semester 30" is a row id and means nothing to the person
     * reading it. Only asked for when the fast path has already failed.
     */
    if (!subjects.length) {
        const [diag] = await query(
            `SELECT sem.semester_id, sem.semester_number,
                    semp.program_name AS semester_program,
                    secp.program_name AS section_program,
                    sec.section_name, b.batch_name,
                    (SELECT COUNT(*) FROM subjects s2
                      WHERE s2.semester_id = sem.semester_id AND s2.is_deleted = 0)
                        AS subject_count
               FROM semesters sem
               JOIN programs  semp ON semp.program_id = sem.program_id
               JOIN sections  sec  ON sec.section_id  = :sectionId
               JOIN batches   b    ON b.batch_id      = sec.batch_id
               JOIN programs  secp ON secp.program_id = b.program_id
              WHERE sem.semester_id = :semesterId`,
            { sectionId: section_id, semesterId: semester_id }
        );

        if (!diag) {
            throw new OfferingError(
                `No curriculum semester ${semester_id}, or no section ` +
                    `${section_id}. Nothing was created.`,
                404
            );
        }

        if (diag.semester_program !== diag.section_program) {
            throw new OfferingError(
                `Semester ${diag.semester_number} of ${diag.semester_program} ` +
                    `cannot be given to ${diag.section_name}, which is ` +
                    `${diag.batch_name} - ${diag.section_program}. Every ` +
                    "programme has its own Semester " +
                    `${diag.semester_number}; pick ${diag.section_program}'s.`,
                422
            );
        }

        throw new OfferingError(
            `Semester ${diag.semester_number} of ${diag.section_program} has no ` +
                "subjects yet, so there are no classes to create. Add its " +
                "subjects under Academic Structure first.",
            422
        );
    }

    const created = [];
    const skipped = [];

    for (const subject of subjects) {
        try {
            created.push(
                await createOffering({
                    term_id,
                    section_id,
                    subject_id: subject.subject_id
                })
            );
        } catch (error) {
            if (error instanceof OfferingError && error.statusCode === 409) {
                skipped.push({
                    subject_id: subject.subject_id,
                    subject_code: subject.subject_code,
                    reason: "already offered to this section this term"
                });
                continue;
            }

            throw error;
        }
    }

    return { created, skipped };
};

const updateOffering = async (offeringId, changes) => {
    const existing = await getOffering(offeringId);

    assertTermOpen(
        { status: existing.term.status, term_name: existing.term.term_name },
        "changing its classes"
    );

    const fields = [];
    const replacements = { offeringId };

    if (changes.sessions_per_week !== undefined) {
        // null / '' clears the override and hands the class back to the rule.
        if (changes.sessions_per_week === null || changes.sessions_per_week === "") {
            fields.push("sessions_per_week = NULL");
            changes.sessions_per_week = undefined;
        }
    }

    if (changes.sessions_per_week !== undefined) {
        const value = Number(changes.sessions_per_week);

        if (!Number.isInteger(value) || value < 1 || value > 6) {
            throw new OfferingError(
                "sessions_per_week must be between 1 and 6 - there are only 4 " +
                    "periods a day.",
                400
            );
        }

        /*
         * Lowering it below what is already on the grid is allowed and is
         * reported by scheduling status as `over_scheduled`, rather than being
         * refused. Refusing would force the admin to delete meetings before
         * they can record the decision that those meetings are surplus, which
         * is backwards - the decision comes first.
         */
        fields.push("sessions_per_week = :sessions");
        replacements.sessions = value;
    }

    if (changes.required_room_type !== undefined) {
        fields.push("required_room_type = :roomType");
        replacements.roomType = changes.required_room_type || null;
    }

    if (changes.max_seats !== undefined) {
        fields.push("max_seats = :maxSeats");
        replacements.maxSeats =
            changes.max_seats === null || changes.max_seats === ""
                ? null
                : Number(changes.max_seats);
    }

    if (changes.status !== undefined) {
        const allowed = ["Draft", "Scheduled", "Active", "Completed", "Cancelled"];

        if (!allowed.includes(changes.status)) {
            throw new OfferingError(
                `${changes.status} is not an offering status. Use one of: ` +
                    `${allowed.join(", ")}.`,
                400
            );
        }

        fields.push("status = :status");
        replacements.status = changes.status;
    }

    if (!fields.length) return existing;

    await execute(
        `UPDATE course_offerings SET ${fields.join(", ")} WHERE offering_id = :offeringId`,
        replacements
    );

    // Changing the required session count can flip Draft <-> Scheduled.
    if (changes.sessions_per_week !== undefined) {
        await schedulingService.syncOfferingStatus(offeringId);
    }

    return getOffering(offeringId);
};

/*
 * Removing a class.
 *
 * A class with enrolments or attendance behind it is cancelled, not deleted:
 * marks, attendance and results all point back through the enrolment, and a
 * class that ran and was then erased leaves those rows pointing at nothing.
 * Cancelling keeps the record and takes it off the grid, which is what
 * "this class is not happening" actually means once it has started.
 */
const deleteOffering = async (offeringId) => {
    const existing = await getOffering(offeringId);

    const [counts] = await query(
        `SELECT (SELECT COUNT(*) FROM enrollments e
                  WHERE e.offering_id = :offeringId) AS enrollments,
                (SELECT COUNT(*) FROM attendance a
                   JOIN timetables t ON t.timetable_id = a.timetable_id
                  WHERE t.offering_id = :offeringId) AS attendance`,
        { offeringId }
    );

    const hasHistory =
        Number(counts.enrollments) > 0 || Number(counts.attendance) > 0;

    if (hasHistory) {
        await execute(
            "UPDATE course_offerings SET status = 'Cancelled' WHERE offering_id = :offeringId",
            { offeringId }
        );

        return {
            outcome: "cancelled",
            offering_id: Number(offeringId),
            message:
                `${existing.subject.subject_code} for section ` +
                `${existing.section.section_name} has ${counts.enrollments} ` +
                `enrolment(s) and ${counts.attendance} attendance record(s), so it ` +
                "was cancelled rather than deleted. Its history is intact.",
            enrollments: Number(counts.enrollments),
            attendance: Number(counts.attendance)
        };
    }

    // Nothing hangs off it. Its timetable rows go with it via the FK cascade.
    await execute(
        "UPDATE course_offerings SET is_deleted = 1 WHERE offering_id = :offeringId",
        { offeringId }
    );

    await execute("DELETE FROM timetables WHERE offering_id = :offeringId", {
        offeringId
    }, sequelize.QueryTypes.DELETE);

    return {
        outcome: "deleted",
        offering_id: Number(offeringId),
        message: `${existing.subject.subject_code} for section ${existing.section.section_name} was deleted.`
    };
};

// =====================================================================
// STAFFING
// =====================================================================

const assertTeacherExists = async (teacherId) => {
    const rows = await query(
        `SELECT t.teacher_id FROM teachers t
           JOIN employees e ON e.employee_id = t.employee_id
          WHERE t.teacher_id = :teacherId AND t.is_deleted = 0 AND e.is_deleted = 0
          LIMIT 1`,
        { teacherId }
    );

    if (!rows.length) throw new OfferingError(`No teacher ${teacherId}.`, 404);
};

/*
 * Who could teach this class.
 *
 * `teacher_subjects` is (teacher, subject, batch) and, now that offerings
 * exist, it means *eligibility* - a qualification to teach this subject to
 * this batch - rather than an assignment. It is returned first and flagged, so
 * the admin sees the qualified shortlist without being prevented from going
 * outside it: staffing rules bend at the start of a term, and a system that
 * refuses the only available lecturer because nobody updated a lookup table is
 * a system that gets worked around.
 *
 * Each teacher's current load is included, because "who is qualified" and "who
 * has room in their week" are the same decision made twice otherwise.
 */
const getEligibleTeachers = async (offeringId) => {
    const offering = await getOffering(offeringId);

    const rows = await query(
        `SELECT t.teacher_id,
                emp.first_name, emp.last_name,
                -- designation is on employees, not teachers; teachers holds
                -- only teacher_id, employee_id and specialization.
                emp.designation,
                -- and the address is on the user account, not the employee
                -- record - employees has no email column at all.
                usr.email,
                t.specialization,
                -- Qualification is per SUBJECT, full stop. It used to be
                -- matched on batch as well, which meant a brand-new batch
                -- emptied the shortlist for every subject at once - the exact
                -- moment a registrar most needs it. See migration
                -- 20260822140000-qualification-is-not-batch-scoped.
                EXISTS (
                    SELECT 1 FROM teacher_subjects ts
                     WHERE ts.teacher_id = t.teacher_id
                       AND ts.subject_id = :subjectId
                ) AS is_qualified,
                (SELECT COUNT(*) FROM course_offerings o2
                  WHERE o2.teacher_id = t.teacher_id
                    AND o2.term_id = :termId
                    AND o2.is_deleted = 0
                    AND o2.status <> 'Cancelled') AS classes_this_term,
                (SELECT COUNT(*) FROM timetables tt
                  WHERE tt.teacher_id = t.teacher_id
                    AND tt.term_id = :termId) AS periods_this_week,
                -- What they are already teaching this term, as
                -- "CS-402 CS-4A" pairs. A load of "3 classes" says how busy
                -- somebody is but not whether they are the right person:
                -- a lecturer already taking this same subject for another
                -- section is the obvious pick, and a count cannot show that.
                (SELECT GROUP_CONCAT(
                            CONCAT(s2.subject_code, ' ', sec2.section_name)
                            ORDER BY s2.subject_code SEPARATOR ', ')
                   FROM course_offerings o3
                   JOIN subjects s2   ON s2.subject_id  = o3.subject_id
                   JOIN sections sec2 ON sec2.section_id = o3.section_id
                  WHERE o3.teacher_id = t.teacher_id
                    AND o3.term_id = :termId
                    AND o3.is_deleted = 0
                    AND o3.status <> 'Cancelled') AS teaching_now,
                -- Whether one of those is this very subject.
                EXISTS (
                    SELECT 1 FROM course_offerings o4
                     WHERE o4.teacher_id = t.teacher_id
                       AND o4.term_id = :termId
                       AND o4.subject_id = :subjectId
                       AND o4.is_deleted = 0
                       AND o4.status <> 'Cancelled'
                ) AS teaches_this_subject
           FROM teachers t
           JOIN employees emp ON emp.employee_id = t.employee_id
      LEFT JOIN users     usr ON usr.user_id     = emp.user_id
          WHERE t.is_deleted = 0 AND emp.is_deleted = 0
          ORDER BY is_qualified DESC, emp.first_name, emp.last_name`,
        {
            subjectId: offering.subject.subject_id,
            termId: offering.term.term_id
        }
    );

    return {
        offering,
        teachers: rows.map((r) => ({
            teacher_id: r.teacher_id,
            name: [r.first_name, r.last_name].filter(Boolean).join(" "),
            email: r.email,
            designation: r.designation,
            specialization: r.specialization,
            // Recorded in teacher_subjects for this subject and batch.
            is_qualified: Boolean(Number(r.is_qualified)),
            classes_this_term: Number(r.classes_this_term) || 0,
            periods_this_week: Number(r.periods_this_week) || 0,
            // "CS-402 CS-4A, CS202 CS-4B" - the classes they already hold this
            // term, so the choice is made against what they teach and not only
            // against how many.
            teaching_now: r.teaching_now
                ? String(r.teaching_now).split(", ").filter(Boolean)
                : [],
            teaches_this_subject: Boolean(Number(r.teaches_this_subject))
        }))
    };
};

/*
 * Assigning or changing the teacher of a class.
 *
 * The hard part is not the offering row - it is the timetable rows that
 * already exist. Each one carries teacher_id, and each is covered by the
 * (term, teacher, day, period) unique index. So changing the teacher of a
 * scheduled class means moving that teacher into every period the class
 * occupies, and the new teacher may already be busy in some of them.
 *
 * Every period is therefore checked before anything is written, and the whole
 * change is refused if any of them clashes. A partial reassignment - some
 * periods moved, some not - is the single worst outcome available here: it
 * produces exactly the split-teacher inconsistency that offerings exist to
 * prevent, and it does it silently.
 *
 * The write runs in a transaction for the same reason: the unique index can
 * still reject one of the updates under a concurrent write, and a rolled-back
 * attempt is recoverable where a half-applied one is not.
 */
const assignTeacher = async (offeringId, teacherId) => {
    const offering = await getOffering(offeringId);

    assertTermOpen(
        { status: offering.term.status, term_name: offering.term.term_name },
        "changing who teaches its classes"
    );

    if (teacherId === null || teacherId === undefined || teacherId === "") {
        // Unstaffing a scheduled class would leave timetable rows whose
        // teacher_id cannot be null, so the grid has to be cleared first.
        if (offering.placed_sessions > 0) {
            throw new OfferingError(
                `${offering.subject.subject_code} has ${offering.placed_sessions} ` +
                    "period(s) on the timetable. Remove them before unassigning the " +
                    "teacher, or assign a different teacher instead.",
                422
            );
        }

        await execute(
            "UPDATE course_offerings SET teacher_id = NULL WHERE offering_id = :offeringId",
            { offeringId }
        );

        return getOffering(offeringId);
    }

    await assertTeacherExists(teacherId);

    if (offering.teacher && Number(offering.teacher.teacher_id) === Number(teacherId)) {
        return offering;
    }

    const sessions = await query(
        `SELECT timetable_id, day_of_week, start_time FROM timetables
          WHERE offering_id = :offeringId`,
        { offeringId }
    );

    if (sessions.length) {
        // Every period this class occupies, checked against the incoming
        // teacher's existing week in this term.
        const clashes = await query(
            `SELECT t.day_of_week, t.start_time, sub.subject_code, sec.section_name
               FROM timetables t
               JOIN subjects sub ON sub.subject_id = t.subject_id
               JOIN sections sec ON sec.section_id = t.section_id
              WHERE t.teacher_id = :teacherId
                AND t.term_id = :termId
                AND t.offering_id <> :offeringId
                AND (t.day_of_week, t.start_time) IN (:periods)`,
            {
                teacherId,
                termId: offering.term.term_id,
                offeringId,
                periods: sessions.map((s) => [s.day_of_week, s.start_time])
            }
        );

        if (clashes.length) {
            throw new OfferingError(
                `That teacher is already booked in ${clashes.length} of this class's ` +
                    `periods: ` +
                    clashes
                        .map(
                            (c) =>
                                `${c.day_of_week} ${c.start_time} (${c.subject_code}, ` +
                                `section ${c.section_name})`
                        )
                        .join("; ") +
                    ". Reschedule one of the classes first.",
                409,
                { clashes }
            );
        }
    }

    await sequelize.transaction(async (transaction) => {
        await sequelize.query(
            "UPDATE course_offerings SET teacher_id = :teacherId WHERE offering_id = :offeringId",
            {
                replacements: { teacherId, offeringId },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            }
        );

        // The denormalised copy on the grid, kept true. This is the write that
        // makes "the teacher of a class" a single fact rather than one fact
        // per period.
        await sequelize.query(
            "UPDATE timetables SET teacher_id = :teacherId WHERE offering_id = :offeringId",
            {
                replacements: { teacherId, offeringId },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            }
        );
    });

    return getOffering(offeringId);
};

// =====================================================================
// ENROLMENT
// =====================================================================

/*
 * Puts the section's students into the class.
 *
 * This is the cohort model: an offering belongs to a section, every student in
 * that section takes it, and nobody picks subjects individually. So enrolment
 * is not a per-student decision at all - it is one action per class, and the
 * roster is simply the section.
 *
 * That is what answers "how does a student end up in a teacher's class". Not
 * the teacher adding them, and not the admin doing it one at a time: the admin
 * creates the class and staffs it, and the section's membership does the rest.
 *
 * Students already enrolled are left alone rather than re-inserted, so the
 * call is safe to repeat when a student joins the section mid-term - which is
 * the main reason it is a separate action rather than a side effect of
 * creating the offering.
 */
const enrolCohort = async (offeringId) => {
    const offering = await getOffering(offeringId);

    assertTermOpen(
        { status: offering.term.status, term_name: offering.term.term_name },
        "enrolling students"
    );

    if (offering.status === "Cancelled") {
        throw new OfferingError(
            `${offering.subject.subject_code} for section ` +
                `${offering.section.section_name} is cancelled, so students cannot ` +
                "be enrolled in it.",
            422
        );
    }

    /*
     * Only students who are actually in the section and actually studying.
     * A Withdrawn or Graduated student still carries their old section_id -
     * the column is never cleared - so enrolling by section alone would put
     * people who left the university into this year's classes.
     */
    const candidates = await query(
        `SELECT st.student_id, st.registration_number, st.first_name, st.last_name,
                EXISTS (
                    SELECT 1 FROM enrollments e
                     WHERE e.student_id = st.student_id
                       AND e.offering_id = :offeringId
                ) AS already_enrolled
           FROM students st
          WHERE st.section_id = :sectionId
            AND st.is_deleted = 0
            AND st.academic_status = 'Active'
          ORDER BY st.registration_number`,
        { offeringId, sectionId: offering.section.section_id }
    );

    const toEnrol = candidates.filter((c) => !Number(c.already_enrolled));

    if (offering.max_seats !== null) {
        const wouldBe = offering.enrolled_count + toEnrol.length;

        if (wouldBe > offering.max_seats) {
            throw new OfferingError(
                `${offering.subject.subject_code} is capped at ${offering.max_seats} ` +
                    `seats but section ${offering.section.section_name} would put ` +
                    `${wouldBe} students in it. Raise the cap or split the section.`,
                422,
                { cap: offering.max_seats, would_be: wouldBe }
            );
        }
    }

    if (toEnrol.length) {
        await sequelize.query(
            `INSERT INTO enrollments
                  (student_id, subject_id, semester_id, term_id, offering_id,
                   enrollment_date, status)
             VALUES ${toEnrol.map((_, i) => `(:student${i}, :subjectId, :semesterId, :termId, :offeringId, CURDATE(), 'Active')`).join(", ")}`,
            {
                replacements: {
                    ...Object.fromEntries(
                        toEnrol.map((s, i) => [`student${i}`, s.student_id])
                    ),
                    subjectId: offering.subject.subject_id,
                    // The curriculum stage stays on the row as well as the
                    // term: results and GPA are computed per stage, and every
                    // query that does so predates offerings.
                    semesterId: offering.subject.semester_id,
                    termId: offering.term.term_id,
                    offeringId
                },
                type: sequelize.QueryTypes.INSERT
            }
        );
    }

    return {
        offering_id: Number(offeringId),
        enrolled: toEnrol.length,
        already_enrolled: candidates.length - toEnrol.length,
        total_in_class: candidates.length,
        students: toEnrol.map((s) => ({
            student_id: s.student_id,
            registration_number: s.registration_number,
            name: `${s.first_name} ${s.last_name}`
        }))
    };
};

/*
 * Enrols every class a section has this term, in one call - the companion to
 * createOfferingsForSection. Building a term is two clicks per section rather
 * than two per subject.
 */
const enrolCohortForSection = async (termId, sectionId) => {
    const offerings = await listOfferings({ term_id: termId, section_id: sectionId });

    const results = [];

    for (const offering of offerings) {
        if (offering.status === "Cancelled") continue;

        results.push({
            offering_id: offering.offering_id,
            subject_code: offering.subject.subject_code,
            ...(await enrolCohort(offering.offering_id))
        });
    }

    return {
        term_id: Number(termId),
        section_id: Number(sectionId),
        classes: results.length,
        total_enrolled: results.reduce((n, r) => n + r.enrolled, 0),
        results
    };
};

// The class list, with each student's attendance in it. This is the screen a
// teacher opens; the join that produces it is the one that did not exist
// before offerings.
const getRoster = async (offeringId) => {
    const offering = await getOffering(offeringId);

    const students = await query(
        `SELECT st.student_id, st.registration_number, st.first_name, st.last_name,
                st.academic_status, e.enrollment_id, e.status AS enrollment_status,
                e.enrollment_date,
                (SELECT COUNT(*) FROM attendance a
                   JOIN timetables t ON t.timetable_id = a.timetable_id
                  WHERE t.offering_id = :offeringId
                    AND a.student_id = st.student_id) AS sessions_recorded,
                (SELECT COUNT(*) FROM attendance a
                   JOIN timetables t ON t.timetable_id = a.timetable_id
                  WHERE t.offering_id = :offeringId
                    AND a.student_id = st.student_id
                    AND a.status IN ('Present', 'Late')) AS sessions_attended
           FROM enrollments e
           JOIN students st ON st.student_id = e.student_id AND st.is_deleted = 0
          WHERE e.offering_id = :offeringId
          ORDER BY st.registration_number`,
        { offeringId }
    );

    return {
        offering,
        students: students.map((s) => {
            const recorded = Number(s.sessions_recorded) || 0;
            const attended = Number(s.sessions_attended) || 0;

            return {
                student_id: s.student_id,
                registration_number: s.registration_number,
                name: `${s.first_name} ${s.last_name}`,
                academic_status: s.academic_status,
                enrollment_id: s.enrollment_id,
                enrollment_status: s.enrollment_status,
                enrollment_date: s.enrollment_date,
                sessions_recorded: recorded,
                sessions_attended: attended,
                // null rather than 0 when nothing has been recorded: a class
                // that has not met yet has no attendance rate, and showing 0%
                // reads as everyone having missed it.
                attendance_percent: recorded
                    ? Math.round((attended / recorded) * 100)
                    : null
            };
        }),
        count: students.length
    };
};

/*
 * The question that started all of this: for one student, what are they
 * taking, who teaches it, where, and when.
 *
 * Answerable in a single join now. Before offerings it was not answerable at
 * all - the only route was the section's timetable, which lists subjects the
 * student may not be enrolled in and cannot tell a dropped course from a
 * current one.
 */
const getStudentClasses = async (studentId, termId = null) => {
    const term = termId ? await requireTerm(termId) : await getCurrentTerm();

    if (!term) {
        throw new OfferingError(
            "No academic term is active or planned, so there are no classes to show.",
            404
        );
    }

    const rows = await query(
        `SELECT o.offering_id, e.enrollment_id, e.status AS enrollment_status,
                sub.subject_code, sub.subject_name, sub.credit_hours,
                sec.section_name,
                o.teacher_id,
                emp.first_name AS teacher_first_name,
                emp.last_name  AS teacher_last_name,
                usr.email      AS teacher_email
           FROM enrollments e
           JOIN course_offerings o ON o.offering_id = e.offering_id AND o.is_deleted = 0
           JOIN subjects  sub ON sub.subject_id = o.subject_id
           JOIN sections  sec ON sec.section_id = o.section_id
      LEFT JOIN teachers  tch ON tch.teacher_id = o.teacher_id
      LEFT JOIN employees emp ON emp.employee_id = tch.employee_id
      LEFT JOIN users     usr ON usr.user_id     = emp.user_id
          WHERE e.student_id = :studentId
            AND e.term_id = :termId
          ORDER BY sub.subject_code`,
        { studentId, termId: term.term_id }
    );

    // The meetings of those classes, fetched in one go rather than per class.
    const offeringIds = rows.map((r) => r.offering_id);

    const sessions = offeringIds.length
        ? await query(
              `SELECT t.offering_id, t.day_of_week, t.start_time, t.end_time,
                      room.room_name, room.building, room.room_type
                 FROM timetables t
                 JOIN classrooms room ON room.classroom_id = t.classroom_id
                WHERE t.offering_id IN (:offeringIds)
                ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday',
                               'Thursday','Friday','Saturday'), t.start_time`,
              { offeringIds }
          )
        : [];

    return {
        student_id: Number(studentId),
        term,
        classes: rows.map((row) => ({
            offering_id: row.offering_id,
            enrollment_id: row.enrollment_id,
            enrollment_status: row.enrollment_status,
            subject_code: row.subject_code,
            subject_name: row.subject_name,
            credit_hours: Number(row.credit_hours),
            section_name: row.section_name,
            teacher: row.teacher_id
                ? {
                      teacher_id: row.teacher_id,
                      name: [row.teacher_first_name, row.teacher_last_name]
                          .filter(Boolean)
                          .join(" "),
                      email: row.teacher_email
                  }
                : null,
            sessions: sessions
                .filter((s) => s.offering_id === row.offering_id)
                .map((s) => ({
                    day_of_week: s.day_of_week,
                    start_time: s.start_time,
                    end_time: s.end_time,
                    room_name: s.room_name,
                    building: s.building,
                    room_type: s.room_type
                }))
        })),
        count: rows.length
    };
};

module.exports = {
    // terms
    listTerms,
    getCurrentTerm,
    createTerm,
    setTermStatus,
    // offerings
    listOfferings,
    getOffering,
    createOffering,
    createOfferingsForSection,
    updateOffering,
    deleteOffering,
    // staffing
    getEligibleTeachers,
    assignTeacher,
    // enrolment
    enrolCohort,
    enrolCohortForSection,
    getRoster,
    getStudentClasses,

    OfferingError
};
