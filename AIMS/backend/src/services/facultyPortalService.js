// Read/write model behind the teacher portal's Dashboard, My Classes and
// Attendance screens.
//
// Why this module exists
// ----------------------
// Those three screens used to build themselves from constants compiled into
// the bundle - a hardcoded CLASSES array in MyClasses.jsx, a three-row
// "Today's Schedule" in the dashboard, and an attendance grid whose rows were
// held in React state and thrown away on reload. The pieces that were wired to
// the API were assembled on the client from whole-table downloads
// (GET /api/timetables, GET /api/students, ...) and then filtered in the
// browser.
//
// Everything here is aggregated in SQL and scoped to the signed-in teacher's
// own timetable rows, so a teacher can only ever read or write the classes
// they actually teach.
//
// All queries are raw SQL against the live schema (see
// database/Live_DB_Schema_Reference.txt); the Sequelize models in this project
// carry no associations for these tables, so joins have to be written out.

const { sequelize } = require("../database/connection");
const { ROLES } = require("../config/roles");
const announcementService = require("./announcementService");

const SELECT = { type: sequelize.QueryTypes.SELECT };

// The order MySQL's ENUM already stores, repeated here so JS-side sorting and
// "which weekday is today" agree with the database.
const DAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
];

// A class is one subject taught to one section. The pair is the identity the
// portal navigates by.
const classKey = (subjectId, sectionId) => `${subjectId}:${sectionId}`;

// "09:00:00" -> "09:00". The seconds are always zero in this schema and only
// add noise to a timetable card.
const hhmm = (time) => (time ? String(time).slice(0, 5) : null);

// Sequelize's DATEONLY comes back as a string, but a raw query on some drivers
// yields a Date. Normalise to YYYY-MM-DD without crossing a timezone.
const isoDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, "0");
        const d = String(value.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
};

const todayIso = () => isoDate(new Date());

const pct = (part, whole) =>
    (whole > 0 ? Math.round((Number(part) / Number(whole)) * 1000) / 10 : null);

// ---------------------------------------------------------------- identity

/**
 * teacher_id for the signed-in account.
 *
 * `teachers` holds only teacher_id/employee_id/specialization; the person is
 * in `employees`, which is what carries user_id. Admins may act on behalf of a
 * named teacher (?teacher_id=), which is how the same screens serve a head of
 * department; every other role gets null and is refused by the controller.
 */
const resolveTeacher = async (user, requestedTeacherId) => {

    const isAdmin = user
        && (user.role_id === ROLES.SUPER_ADMIN || user.role_id === ROLES.ADMIN);

    if (isAdmin && requestedTeacherId) {
        const rows = await sequelize.query(
            `SELECT t.teacher_id,
                    t.specialization,
                    e.employee_id,
                    e.user_id,
                    e.employee_code,
                    e.first_name,
                    e.last_name,
                    e.designation,
                    e.employment_status,
                    d.department_id,
                    d.department_name,
                    u.email
               FROM teachers t
               JOIN employees e ON e.employee_id = t.employee_id
          LEFT JOIN departments d ON d.department_id = e.department_id
          LEFT JOIN users u ON u.user_id = e.user_id
              WHERE t.teacher_id = :teacherId
                AND t.is_deleted = 0
              LIMIT 1`,
            { ...SELECT, replacements: { teacherId: requestedTeacherId } }
        );
        return rows.length ? rows[0] : null;
    }

    if (!user || !user.user_id) return null;

    const rows = await sequelize.query(
        `SELECT t.teacher_id,
                t.specialization,
                e.employee_id,
                e.user_id,
                e.employee_code,
                e.first_name,
                e.last_name,
                e.designation,
                e.employment_status,
                d.department_id,
                d.department_name,
                u.email
           FROM teachers t
           JOIN employees e ON e.employee_id = t.employee_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      LEFT JOIN users u ON u.user_id = e.user_id
          WHERE e.user_id = :userId
            AND t.is_deleted = 0
          LIMIT 1`,
        { ...SELECT, replacements: { userId: user.user_id } }
    );

    return rows.length ? rows[0] : null;
};

// ----------------------------------------------------------------- classes

/**
 * The current term, or null when no calendar term exists yet.
 *
 * Read here rather than imported from courseOfferingService so the faculty
 * portal does not take a dependency on the scheduling module for one column.
 */
const currentTermId = async () => {
    const rows = await sequelize.query(
        `SELECT term_id FROM academic_terms
          WHERE status IN ('Active', 'Planned')
          ORDER BY FIELD(status, 'Active', 'Planned'), start_date
          LIMIT 1`,
        SELECT
    );

    return rows.length ? rows[0].term_id : null;
};

/**
 * Every class this teacher holds, with its weekly meetings.
 *
 * DRIVEN BY `course_offerings`, NOT BY `timetables`
 * ------------------------------------------------
 * This used to select `FROM timetables WHERE tt.teacher_id = :id` — it worked
 * out what a teacher taught from the rows that happened to be on the grid.
 * Two things were wrong with that:
 *
 *   1. A class that has been assigned to a teacher but not yet timetabled was
 *      invisible. The teacher could not see they had been given a course until
 *      somebody placed its periods, which is exactly when they would want to
 *      know.
 *   2. It read the teacher from the timetable row rather than from the class.
 *      `timetables.teacher_id` is denormalised; `course_offerings.teacher_id`
 *      is the fact. They agree today only because `createTimetable` copies one
 *      from the other, and a screen should not depend on that holding.
 *
 * The offering is now the driver and the timetable rows are LEFT JOINed onto
 * it, so an unplaced class returns exactly one row with null meeting columns —
 * `getClasses` reads that as "a class with no slots yet".
 */
const timetableRowsFor = async (teacherId) => {
    const termId = await currentTermId();

    return sequelize.query(
        `SELECT tt.timetable_id,
                o.offering_id,
                o.subject_id,
                o.section_id,
                -- THE RULE: subject states it, offering may override it.
                COALESCE(o.sessions_per_week, sub.sessions_per_week) AS sessions_per_week,
                tt.classroom_id,
                tt.day_of_week,
                tt.start_time,
                tt.end_time,
                sub.subject_code,
                sub.subject_name,
                sub.credit_hours,
                sub.semester_id,
                sem.semester_number,
                sec.section_name,
                sec.batch_id,
                b.batch_name,
                b.program_id,
                p.program_name,
                cr.room_name,
                cr.building
           FROM course_offerings o
           JOIN subjects sub ON sub.subject_id = o.subject_id
      LEFT JOIN semesters sem ON sem.semester_id = sub.semester_id
           JOIN sections sec ON sec.section_id = o.section_id
      LEFT JOIN batches b ON b.batch_id = sec.batch_id
      LEFT JOIN programs p ON p.program_id = b.program_id
      LEFT JOIN timetables tt ON tt.offering_id = o.offering_id
      LEFT JOIN classrooms cr ON cr.classroom_id = tt.classroom_id
          WHERE o.teacher_id = :teacherId
            AND o.is_deleted = 0
            AND o.status <> 'Cancelled'
            AND (:termId IS NULL OR o.term_id = :termId)
            AND sub.is_deleted = 0
            AND sec.is_deleted = 0
          ORDER BY sub.subject_code,
                   sec.section_name,
                   FIELD(tt.day_of_week,
                         'Monday','Tuesday','Wednesday',
                         'Thursday','Friday','Saturday'),
                   tt.start_time`,
        { ...SELECT, replacements: { teacherId, termId } }
    );
};

/** Headcount per section, for the "N students" badge on a class card. */
const sectionHeadcounts = async (sectionIds) => {

    if (!sectionIds.length) return new Map();

    const rows = await sequelize.query(
        `SELECT section_id, COUNT(*) AS student_count
           FROM students
          WHERE is_deleted = 0
            AND section_id IN (:sectionIds)
          GROUP BY section_id`,
        { ...SELECT, replacements: { sectionIds } }
    );

    return new Map(rows.map((r) => [r.section_id, Number(r.student_count)]));
};

/**
 * Attendance percentage per (subject, section) across every student in the
 * section, so a class card can report how the class as a whole is attending.
 */
const classAttendanceRates = async (pairs) => {

    if (!pairs.length) return new Map();

    const rows = await sequelize.query(
        `SELECT a.subject_id,
                st.section_id,
                COUNT(*) AS total_sessions,
                SUM(a.status = 'Present') AS present_count,
                SUM(a.status = 'Late') AS late_count,
                SUM(a.status = 'Absent') AS absent_count,
                SUM(a.status = 'Leave') AS leave_count
           FROM attendance a
           JOIN students st ON st.student_id = a.student_id
          WHERE st.is_deleted = 0
            AND (a.subject_id, st.section_id) IN (:pairs)
          GROUP BY a.subject_id, st.section_id`,
        {
            ...SELECT,
            replacements: { pairs: pairs.map((p) => [p.subjectId, p.sectionId]) }
        }
    );

    return new Map(rows.map((r) => [
        classKey(r.subject_id, r.section_id),
        {
            totalSessions: Number(r.total_sessions),
            present: Number(r.present_count),
            late: Number(r.late_count),
            absent: Number(r.absent_count),
            leave: Number(r.leave_count),
            // 'Late' still means the student attended.
            percentage: pct(
                Number(r.present_count) + Number(r.late_count),
                Number(r.total_sessions)
            )
        }
    ]));
};

/**
 * The teacher's classes: one entry per subject+section, each carrying its
 * weekly slots, its room(s) and its roster size.
 */
const getClasses = async (teacherId) => {

    const rows = await timetableRowsFor(teacherId);

    const classes = new Map();

    for (const row of rows) {
        const key = classKey(row.subject_id, row.section_id);

        if (!classes.has(key)) {
            classes.set(key, {
                key,
                offering_id: row.offering_id,
                subject_id: row.subject_id,
                section_id: row.section_id,
                // How many meetings this class is supposed to have, so the
                // portal can say "1 of 2 periods scheduled" instead of
                // implying that whatever is on the grid is the whole course.
                sessions_per_week: Number(row.sessions_per_week) || 0,
                subject_code: row.subject_code,
                subject_name: row.subject_name,
                credit_hours: row.credit_hours,
                semester_id: row.semester_id,
                semester_number: row.semester_number,
                section_name: row.section_name,
                batch_id: row.batch_id,
                batch_name: row.batch_name,
                program_id: row.program_id,
                program_name: row.program_name,
                slots: [],
                student_count: 0,
                attendance: null
            });
        }

        /*
         * An offering with no timetable rows arrives as a single LEFT JOINed
         * row whose meeting columns are all null. That is a real state — a
         * staffed class nobody has placed yet — and it must appear in the list
         * with an empty `slots`, not as a phantom lecture at "null null".
         */
        if (row.timetable_id !== null && row.timetable_id !== undefined) {
            classes.get(key).slots.push({
                timetable_id: row.timetable_id,
                day_of_week: row.day_of_week,
                start_time: hhmm(row.start_time),
                end_time: hhmm(row.end_time),
                classroom_id: row.classroom_id,
                room_name: row.room_name,
                building: row.building
            });
        }
    }

    const list = [...classes.values()];
    const sectionIds = [...new Set(list.map((c) => c.section_id))];

    const [counts, rates] = await Promise.all([
        sectionHeadcounts(sectionIds),
        classAttendanceRates(list.map((c) => ({
            subjectId: c.subject_id,
            sectionId: c.section_id
        })))
    ]);

    for (const item of list) {
        item.student_count = counts.get(item.section_id) || 0;
        item.attendance = rates.get(item.key) || null;
    }

    return list;
};

/** Refuses a subject+section this teacher has no timetable row for. */
const findClass = async (teacherId, subjectId, sectionId) => {
    const list = await getClasses(teacherId);
    return list.find(
        (c) => Number(c.subject_id) === Number(subjectId)
            && Number(c.section_id) === Number(sectionId)
    ) || null;
};

// ------------------------------------------------------------------ roster

/** The students of a section, ordered by registration number. */
const sectionRoster = async (sectionId) =>
    sequelize.query(
        `SELECT st.student_id,
                -- The login id. Carried purely so the faculty screens can show
                -- each student's actual photograph: /api/users/:id/avatar is
                -- keyed by the users row, not by student_id, and without this
                -- every class roster drew initials for students who had one.
                st.user_id,
                st.registration_number,
                st.first_name,
                st.last_name,
                st.gender,
                st.phone,
                st.academic_status,
                st.section_id,
                st.current_semester_id,
                p.program_name
           FROM students st
      LEFT JOIN programs p ON p.program_id = st.program_id
          WHERE st.is_deleted = 0
            AND st.section_id = :sectionId
          ORDER BY st.registration_number`,
        { ...SELECT, replacements: { sectionId } }
    );

/** Per-student attendance totals for one subject. */
const attendanceTotals = async (subjectId, studentIds) => {

    if (!studentIds.length) return new Map();

    const rows = await sequelize.query(
        `SELECT student_id,
                COUNT(*) AS total_sessions,
                SUM(status = 'Present') AS present_count,
                SUM(status = 'Late') AS late_count,
                SUM(status = 'Absent') AS absent_count,
                SUM(status = 'Leave') AS leave_count
           FROM attendance
          WHERE subject_id = :subjectId
            AND student_id IN (:studentIds)
          GROUP BY student_id`,
        { ...SELECT, replacements: { subjectId, studentIds } }
    );

    return new Map(rows.map((r) => [r.student_id, r]));
};

/**
 * Per-student marks for one subject, summed across every exam of that subject
 * they have a mark for. `marks` stores only the obtained score; the paper's
 * total lives on `exams`, so the percentage needs the join.
 */
const marksTotals = async (subjectId, studentIds) => {

    if (!studentIds.length) return new Map();

    const rows = await sequelize.query(
        `SELECT m.student_id,
                SUM(m.obtained_marks) AS obtained,
                SUM(e.total_marks) AS total,
                COUNT(*) AS exam_count
           FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
          WHERE e.subject_id = :subjectId
            AND m.student_id IN (:studentIds)
          GROUP BY m.student_id`,
        { ...SELECT, replacements: { subjectId, studentIds } }
    );

    return new Map(rows.map((r) => [r.student_id, r]));
};

/**
 * A class with its enrolled students, each carrying their real attendance rate
 * and marks total for that subject. Both are null when nothing has been
 * recorded yet, which the screen renders as a dash rather than a zero.
 */
const getClassRoster = async (teacherId, subjectId, sectionId) => {

    const klass = await findClass(teacherId, subjectId, sectionId);

    if (!klass) return null;

    const students = await sectionRoster(sectionId);
    const ids = students.map((s) => s.student_id);

    const [attendance, marks] = await Promise.all([
        attendanceTotals(subjectId, ids),
        marksTotals(subjectId, ids)
    ]);

    return {
        ...klass,
        student_count: students.length,
        students: students.map((s) => {

            const att = attendance.get(s.student_id) || null;
            const mk = marks.get(s.student_id) || null;

            const attended = att
                ? Number(att.present_count) + Number(att.late_count)
                : 0;

            return {
                student_id: s.student_id,
                user_id: s.user_id ?? null,
                registration_number: s.registration_number,
                first_name: s.first_name,
                last_name: s.last_name,
                full_name: [s.first_name, s.last_name].filter(Boolean).join(" "),
                gender: s.gender,
                phone: s.phone,
                academic_status: s.academic_status,
                program_name: s.program_name,
                current_semester_id: s.current_semester_id,

                attendance: att
                    ? {
                        total_sessions: Number(att.total_sessions),
                        present: Number(att.present_count),
                        late: Number(att.late_count),
                        absent: Number(att.absent_count),
                        leave: Number(att.leave_count),
                        percentage: pct(attended, Number(att.total_sessions))
                    }
                    : null,

                marks: mk
                    ? {
                        obtained: Number(mk.obtained),
                        total: Number(mk.total),
                        exam_count: Number(mk.exam_count),
                        percentage: pct(Number(mk.obtained), Number(mk.total))
                    }
                    : null
            };
        })
    };
};

// -------------------------------------------------------------- attendance

/**
 * The register for one class at ONE TIMETABLE SLOT on one date.
 *
 * A REGISTER IS A PERIOD, NOT A DAY
 * ---------------------------------
 * This used to resolve the slot as `slots.find(s => s.day_of_week ===
 * weekday)` — the FIRST slot matching that weekday — and there is nothing in
 * the data saying a class meets a day only once. CS-101 section CS-A meets
 * TWICE on Monday in `aims_test`, at 08:30 and at 10:00 (timetable_id 1 and
 * 2). The second period was unreachable: it could not be opened, could not be
 * marked, and its sessions never entered the 75% denominator. A student could
 * miss every 10:00 Monday lecture of a semester and their attendance would
 * read 100%.
 *
 * The database has been right about this the whole time — the unique key is
 * `uq_attendance_once (student_id, timetable_id, att_date)`, which says
 * plainly that a student has one register entry per SLOT per day. Only the
 * service disagreed.
 *
 * So the slot is now named. `sessions` lists every slot the class meets that
 * weekday, `session` is the one being marked, and the caller says which.
 *
 * WHEN THE CALLER DOES NOT SAY: a day with exactly one slot resolves to it,
 * because that is unambiguous and every existing caller depends on it. A day
 * with more than one is NOT guessed at — see saveAttendance, which refuses.
 * Reading is more forgiving than writing: the sheet opens on the first period
 * so the screen has something to show, and it says which one it opened.
 */
const getAttendanceSheet = async (teacherId, subjectId, sectionId, date, timetableId) => {

    const klass = await findClass(teacherId, subjectId, sectionId);

    if (!klass) return null;

    const attDate = isoDate(date) || todayIso();
    const weekday = DAYS[new Date(`${attDate}T00:00:00`).getDay()];

    // Every period this class meets on that weekday, earliest first, so the
    // screen can offer the choice rather than making it silently.
    const sessions = klass.slots
        .filter((s) => s.day_of_week === weekday)
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

    /*
     * A named slot is honoured only if it is one of THIS class's periods on
     * THIS weekday, so the parameter cannot be used to open somebody else's
     * register, or this class's Tuesday register under a Monday date.
     */
    const named = timetableId
        ? sessions.find((s) => Number(s.timetable_id) === Number(timetableId))
        : null;

    const session = named || sessions[0] || null;

    const students = await sectionRoster(sectionId);
    const ids = students.map((s) => s.student_id);

    /*
     * Scoped to the SLOT, not to the subject and date.
     *
     * This read `WHERE att_date = :attDate AND subject_id = :subjectId`, which
     * on a day with two periods of the same subject returns both registers.
     * They were then collapsed into one `Map` keyed by student, so whichever
     * row the query happened to return last silently won and the 08:30 sheet
     * could show the 10:00 marks. Keying on the slot is what the unique index
     * already keys on.
     */
    const marked = (ids.length && session)
        ? await sequelize.query(
            `SELECT attendance_id,
                    student_id,
                    timetable_id,
                    status,
                    marked_by
               FROM attendance
              WHERE att_date = :attDate
                AND timetable_id = :timetableId
                AND student_id IN (:studentIds)`,
            {
                ...SELECT,
                replacements: { attDate, timetableId: session.timetable_id, studentIds: ids }
            }
        )
        : [];

    const byStudent = new Map(marked.map((r) => [r.student_id, r]));

    const records = students.map((s) => {
        const row = byStudent.get(s.student_id) || null;
        return {
            student_id: s.student_id,
            user_id: s.user_id ?? null,
            registration_number: s.registration_number,
            full_name: [s.first_name, s.last_name].filter(Boolean).join(" "),
            academic_status: s.academic_status,
            attendance_id: row ? row.attendance_id : null,
            // null means "not marked yet" - deliberately not defaulted to
            // Absent, which is what the old client-side grid did and what made
            // an unopened register look like a fully absent class.
            status: row ? row.status : null,
            timetable_id: row ? row.timetable_id : (session ? session.timetable_id : null)
        };
    });

    const counts = { Present: 0, Absent: 0, Late: 0, Leave: 0, Holiday: 0 };
    let unmarked = 0;

    for (const r of records) {
        if (r.status && counts[r.status] !== undefined) counts[r.status] += 1;
        else unmarked += 1;
    }

    const markedTotal = records.length - unmarked;

    return {
        subject_id: klass.subject_id,
        section_id: klass.section_id,
        subject_code: klass.subject_code,
        subject_name: klass.subject_name,
        section_name: klass.section_name,
        program_name: klass.program_name,
        att_date: attDate,
        day_of_week: weekday,
        session,
        /*
         * Every period this class meets that weekday, so the screen can offer
         * the choice. A class meeting twice on a Monday returns two entries
         * here and the register the teacher opens is one of them, named.
         * Before this the second period did not exist as far as the UI was
         * concerned.
         */
        sessions,
        // True when the caller has to choose, because guessing is the bug.
        multiple_sessions: sessions.length > 1,
        // Nothing to mark on a day this class does not meet.
        is_class_day: Boolean(session),
        summary: {
            ...counts,
            unmarked,
            total: records.length,
            marked: markedTotal,
            percentage: pct(counts.Present + counts.Late, markedTotal)
        },
        records
    };
};

/**
 * Saves a whole register in one transaction.
 *
 * The unique key is (student_id, timetable_id, att_date), so re-submitting the
 * same day updates the existing rows rather than failing on the duplicate that
 * POST /api/attendance rejects with 409. `marked_by` is the teacher_id
 * resolved from the token - never a value the client sends.
 */
const saveAttendance = async (teacher, { subject_id, section_id, att_date, timetable_id, records }) => {

    const klass = await findClass(teacher.teacher_id, subject_id, section_id);

    if (!klass) {
        return { error: "forbidden" };
    }

    const attDate = isoDate(att_date);

    if (!attDate) {
        return { error: "att_date is required (YYYY-MM-DD)" };
    }

    const weekday = DAYS[new Date(`${attDate}T00:00:00`).getDay()];

    /*
     * Which period this register belongs to.
     *
     * An explicit `timetable_id` is honoured only if it is one of THIS class's
     * periods ON THIS WEEKDAY. Both halves matter:
     *
     *  - "this class" stops the parameter being used to write a register
     *    against somebody else's slot. That check was already here.
     *  - "this weekday" is new, and it is the one that was missing. Nothing
     *    stopped a caller passing the Monday slot with a Thursday `att_date`,
     *    which would write a row claiming a lecture happened on a day the
     *    class does not meet — and the unique key would happily accept it,
     *    because (student, timetable, date) is still unique.
     */
    const daySlots = klass.slots
        .filter((s) => s.day_of_week === weekday)
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

    if (!daySlots.length) {
        return { error: `This class does not meet on ${weekday}.` };
    }

    let session;

    if (timetable_id) {
        session = daySlots.find((s) => Number(s.timetable_id) === Number(timetable_id));

        if (!session) {
            /*
             * Named a slot this class does not hold on this weekday. Refused
             * rather than quietly falling back to the first period, because
             * silently writing to a different slot than the one asked for is
             * how a register ends up attached to the wrong lecture.
             */
            return {
                error: `That period is not one of this class's ${weekday} slots.`
            };
        }
    } else if (daySlots.length === 1) {
        // Unambiguous. Every caller written before periods were addressable
        // relies on this, and it is correct.
        session = daySlots[0];
    } else {
        /*
         * THE BUG, REFUSED.
         *
         * This used to take `daySlots[0]` — the first period of the day —
         * whenever the caller did not name one. CS-101 CS-A meets at 08:30 and
         * at 10:00 on Mondays, so the 10:00 register was unwritable and every
         * 10:00 submission silently overwrote the 08:30 one instead. There is
         * no safe guess to make here, so the caller is told what the choices
         * are rather than having one picked for it.
         */
        const offered = daySlots
            .map((s) => `${s.start_time}-${s.end_time}`)
            .join(", ");

        return {
            error: `This class meets ${daySlots.length} times on ${weekday} `
                + `(${offered}). Say which period this register is for.`
        };
    }

    // Only students who are actually in this section may be written.
    const roster = await sectionRoster(section_id);
    const allowed = new Set(roster.map((s) => s.student_id));

    const valid = ["Present", "Absent", "Late", "Leave", "Holiday"];

    const clean = (records || []).filter(
        (r) => allowed.has(Number(r.student_id)) && valid.includes(r.status)
    );

    if (!clean.length) {
        return { error: "No valid attendance records were supplied." };
    }

    let created = 0;
    let updated = 0;

    await sequelize.transaction(async (transaction) => {

        for (const record of clean) {

            const [existing] = await sequelize.query(
                `SELECT attendance_id
                   FROM attendance
                  WHERE student_id = :studentId
                    AND timetable_id = :timetableId
                    AND att_date = :attDate
                  LIMIT 1`,
                {
                    ...SELECT,
                    transaction,
                    replacements: {
                        studentId: record.student_id,
                        timetableId: session.timetable_id,
                        attDate
                    }
                }
            );

            if (existing) {
                await sequelize.query(
                    `UPDATE attendance
                        SET status = :status,
                            marked_by = :markedBy,
                            subject_id = :subjectId
                      WHERE attendance_id = :attendanceId`,
                    {
                        transaction,
                        replacements: {
                            status: record.status,
                            markedBy: teacher.teacher_id,
                            subjectId: subject_id,
                            attendanceId: existing.attendance_id
                        }
                    }
                );
                updated += 1;
            } else {
                await sequelize.query(
                    `INSERT INTO attendance
                            (student_id, subject_id, timetable_id,
                             att_date, status, marked_by)
                     VALUES (:studentId, :subjectId, :timetableId,
                             :attDate, :status, :markedBy)`,
                    {
                        transaction,
                        replacements: {
                            studentId: record.student_id,
                            subjectId: subject_id,
                            timetableId: session.timetable_id,
                            attDate,
                            status: record.status,
                            markedBy: teacher.teacher_id
                        }
                    }
                );
                created += 1;
            }
        }
    });

    /*
     * The two names are carried out for the audit entry the controller writes:
     * "Attendance marked — Data Structures, BSCS-2022-A" is readable, and
     * "Attendance marked — sections#14" is not. Both come from `klass`, which
     * is already loaded above, so this costs nothing.
     */
    return {
        created,
        updated,
        att_date: attDate,
        timetable_id: session.timetable_id,
        // The period this register was filed against, echoed back so the
        // caller can confirm what it wrote rather than assuming. On a class
        // that meets twice a day, "saved" alone does not say which lecture.
        session: {
            timetable_id: session.timetable_id,
            day_of_week: session.day_of_week,
            start_time: session.start_time,
            end_time: session.end_time,
            room_name: session.room_name ?? null
        },
        subject_name: klass.subject_name ?? null,
        section_name: klass.section_name ?? null
    };
};

/**
 * Day-by-day attendance counts over a date range, for the trend chart.
 *
 * Scoped to the teacher's own classes: with no subject/section given it covers
 * every (subject, section) pair they teach, which is what the "All Subjects"
 * filter means.
 */
const trendRows = async (pairs, from, to) => {

    const where = [
        "st.is_deleted = 0",
        "(a.subject_id, st.section_id) IN (:pairs)",
        "a.att_date BETWEEN :from AND :to"
    ];

    return sequelize.query(
        `SELECT a.att_date,
                COUNT(*) AS total,
                SUM(a.status = 'Present') AS present_count,
                SUM(a.status = 'Late') AS late_count,
                SUM(a.status = 'Absent') AS absent_count,
                SUM(a.status = 'Leave') AS leave_count,
                SUM(a.status = 'Holiday') AS holiday_count
           FROM attendance a
           JOIN students st ON st.student_id = a.student_id
          WHERE ${where.join(" AND ")}
          GROUP BY a.att_date
          ORDER BY a.att_date`,
        { ...SELECT, replacements: { pairs, from, to } }
    );
};

const getAttendanceTrend = async (teacherId, { subject_id, section_id, date_from, date_to, period }) => {

    const classes = await getClasses(teacherId);

    const pairs = classes
        .filter((c) => (!subject_id || Number(c.subject_id) === Number(subject_id))
            && (!section_id || Number(c.section_id) === Number(section_id)))
        .map((c) => [c.subject_id, c.section_id]);

    const empty = {
        series: [],
        totals: { total: 0, present: 0, late: 0, absent: 0, leave: 0, holiday: 0, percentage: null },
        range: null,
        available: null,
        anchored: false
    };

    if (!pairs.length) return empty;

    // The window the class actually has records for. Without this, a portal
    // opened on a date the institute has not recorded yet — which is every day
    // after the last seeded register — drew an empty chart with no explanation.
    const [available] = await sequelize.query(
        `SELECT MIN(a.att_date) AS first_date, MAX(a.att_date) AS last_date
           FROM attendance a
           JOIN students st ON st.student_id = a.student_id
          WHERE st.is_deleted = 0
            AND (a.subject_id, st.section_id) IN (:pairs)`,
        { ...SELECT, replacements: { pairs } }
    );

    const firstAvailable = isoDate(available && available.first_date);
    const lastAvailable = isoDate(available && available.last_date);

    if (!lastAvailable) return empty;

    // Window length in days, so the anchor can be moved without the caller
    // having to recompute both ends.
    const spanDays = period === "Daily" ? 1 : period === "Monthly" ? null : 7;

    const windowFor = (anchor) => {
        if (period === "Monthly" || (!spanDays && !date_from)) {
            return { from: `${anchor.slice(0, 7)}-01`, to: anchor };
        }
        if (spanDays === 1) return { from: anchor, to: anchor };
        const d = new Date(`${anchor}T00:00:00`);
        d.setDate(d.getDate() - (spanDays - 1));
        return { from: isoDate(d), to: anchor };
    };

    let to = isoDate(date_to) || todayIso();
    let from = isoDate(date_from) || windowFor(to).from;

    let rows = await trendRows(pairs, from, to);
    let anchored = false;

    /*
     * Nothing in the requested window: fall back to the same-length window
     * ending on the last date this class has records for, and say so.
     *
     * WHY THIS NO LONGER TESTS `lastAvailable < to`
     * ----------------------------------------------
     * That test only re-anchored BACKWARDS — it fired when the class's last
     * register was older than the window, and did nothing when the registers
     * lay ahead of it. A term whose timetable starts after today is the normal
     * case at the start of a session, not an edge case: the teacher opens
     * Attendance, the date picker offers today, the only registers are three
     * weeks out, and the screen reported "No attendance recorded for this
     * class yet" for a class that plainly had some.
     *
     * The direction was never the point. The question is whether the requested
     * window came back empty while the class has records SOMEWHERE, and if it
     * did, the most recent register is the right place to look — which is what
     * `lastAvailable` already is, in both directions.
     *
     * `anchored` still goes back true, so the subtitle says which window is
     * actually being drawn rather than silently showing a different week from
     * the one the date picker names.
     */
    if (!rows.length && lastAvailable) {
        const shifted = period || date_from
            ? windowFor(lastAvailable)
            : { from: lastAvailable, to: lastAvailable };
        from = shifted.from;
        to = shifted.to;
        rows = await trendRows(pairs, from, to);
        anchored = true;
    }

    const series = rows.map((r) => ({
        att_date: isoDate(r.att_date),
        total: Number(r.total),
        present: Number(r.present_count),
        late: Number(r.late_count),
        absent: Number(r.absent_count),
        leave: Number(r.leave_count),
        holiday: Number(r.holiday_count),
        percentage: pct(
            Number(r.present_count) + Number(r.late_count),
            Number(r.total)
        )
    }));

    const totals = series.reduce((acc, day) => ({
        total: acc.total + day.total,
        present: acc.present + day.present,
        late: acc.late + day.late,
        absent: acc.absent + day.absent,
        leave: acc.leave + day.leave,
        holiday: acc.holiday + day.holiday
    }), { total: 0, present: 0, late: 0, absent: 0, leave: 0, holiday: 0 });

    totals.percentage = pct(totals.present + totals.late, totals.total);

    return {
        series,
        totals,
        range: { from, to },
        available: { first: firstAvailable, last: lastAvailable },
        anchored
    };
};

// ------------------------------------------------------ notifications feed

const ROLE_NAME = {
    [ROLES.SUPER_ADMIN]: "Admin",
    [ROLES.ADMIN]: "Admin",
    [ROLES.TEACHER]: "Teacher",
    [ROLES.STUDENT]: "Student",
    [ROLES.PARENT]: "Parent"
};

/**
 * The teacher's notification feed: their own `notifications` rows merged with
 * the announcements addressed to them.
 *
 * The dashboard card read /api/notifications alone, and `notifications` rows
 * are written per event — a teacher with no events yet saw an empty card even
 * though the institute's announcements board had notices addressed to them.
 * Announcement visibility is decided by announcementService, so the audience
 * rules stay in one place.
 */
const getNotificationFeed = async (user, limit = 10) => {

    const take = Math.max(1, Math.min(Number(limit) || 10, 50));

    const [personal, announced] = await Promise.all([
        sequelize.query(
            `SELECT notification_id, message, type, is_read, created_at
               FROM notifications
              WHERE user_id = :userId
              ORDER BY created_at DESC
              LIMIT :take`,
            { ...SELECT, replacements: { userId: user.user_id, take } }
        ),
        (async () => {
            const viewer = await announcementService.describeViewer(user);
            const { rows } = await announcementService.getAnnouncements(
                { limit: take },
                viewer,
                ROLE_NAME[user.role_id] || null
            );
            return rows;
        })()
    ]);

    const items = [
        ...personal.map((n) => ({
            id: `notification-${n.notification_id}`,
            notification_id: n.notification_id,
            source: "notification",
            type: n.type,
            title: n.type,
            message: n.message,
            created_at: n.created_at,
            is_read: Boolean(n.is_read)
        })),
        ...announced.map((a) => ({
            id: `announcement-${a.announcement_id}`,
            announcement_id: a.announcement_id,
            source: "announcement",
            type: "Announcement",
            title: a.title,
            message: a.content,
            posted_by_name: a.posted_by_name,
            posted_by_designation: a.posted_by_designation,
            created_at: a.created_at,
            // Announcements carry no per-reader read flag.
            is_read: null
        }))
    ];

    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
        items: items.slice(0, take),
        unread: personal.filter((n) => !n.is_read).length
    };
};

// ------------------------------------------------------------ activity feed

/**
 * What this teacher has actually done, reconstructed from the rows that carry
 * their id: `attendance.marked_by` and `marks.entered_by` both point at
 * teachers.teacher_id, and `exams` names the subjects they teach.
 *
 * The dashboard's Recent Activity panel used to render six invented events
 * ("Parent meeting with Ali Hassan's parent"), and after those were removed it
 * simply repeated the notification list.
 */
const getActivity = async (teacher, limit = 8) => {

    const take = Math.max(1, Math.min(Number(limit) || 8, 30));

    const classes = await getClasses(teacher.teacher_id);
    const subjectIds = [...new Set(classes.map((c) => c.subject_id))];
    const byTimetable = new Map();

    for (const klass of classes) {
        for (const slot of klass.slots) {
            byTimetable.set(slot.timetable_id, klass);
        }
    }

    const [registers, marksEntered, upcomingExams, posted] = await Promise.all([

        sequelize.query(
            `SELECT a.att_date,
                    a.timetable_id,
                    a.subject_id,
                    COUNT(*) AS students,
                    SUM(a.status = 'Present') AS present_count,
                    SUM(a.status = 'Absent') AS absent_count,
                    MAX(a.created_at) AS at
               FROM attendance a
              WHERE a.marked_by = :teacherId
              GROUP BY a.att_date, a.timetable_id, a.subject_id
              ORDER BY a.att_date DESC
              LIMIT :take`,
            { ...SELECT, replacements: { teacherId: teacher.teacher_id, take } }
        ),

        sequelize.query(
            `SELECT e.exam_id,
                    e.exam_name,
                    e.exam_type,
                    e.exam_date,
                    sub.subject_code,
                    sub.subject_name,
                    COUNT(*) AS students,
                    ROUND(AVG(m.obtained_marks / e.total_marks) * 100, 1) AS avg_percentage
               FROM marks m
               JOIN exams e ON e.exam_id = m.exam_id
               JOIN subjects sub ON sub.subject_id = e.subject_id
              WHERE m.entered_by = :teacherId
              GROUP BY e.exam_id, e.exam_name, e.exam_type, e.exam_date,
                       sub.subject_code, sub.subject_name
              ORDER BY e.exam_date DESC
              LIMIT :take`,
            { ...SELECT, replacements: { teacherId: teacher.teacher_id, take } }
        ),

        subjectIds.length
            ? sequelize.query(
                `SELECT e.exam_id,
                        e.exam_name,
                        e.exam_type,
                        e.exam_date,
                        e.total_marks,
                        sub.subject_code,
                        sub.subject_name
                   FROM exams e
                   JOIN subjects sub ON sub.subject_id = e.subject_id
                  WHERE e.subject_id IN (:subjectIds)
                  ORDER BY e.exam_date DESC
                  LIMIT :take`,
                { ...SELECT, replacements: { subjectIds, take } }
            )
            : [],

        sequelize.query(
            `SELECT announcement_id, title, content, target_role, created_at
               FROM announcements
              WHERE posted_by = :userId
              ORDER BY created_at DESC
              LIMIT :take`,
            { ...SELECT, replacements: { userId: teacher.user_id ?? -1, take } }
        )
    ]);

    const items = [];

    for (const r of registers) {
        const klass = byTimetable.get(r.timetable_id);
        const label = klass
            ? `${klass.subject_code} · Sec ${klass.section_name}`
            : `Subject ${r.subject_id}`;

        items.push({
            id: `register-${r.timetable_id}-${isoDate(r.att_date)}`,
            kind: "Attendance",
            title: "Attendance marked",
            message: `${label} — ${r.students} students recorded, `
                + `${r.present_count} present, ${r.absent_count} absent.`,
            at: r.at || `${isoDate(r.att_date)}T00:00:00`,
            date: isoDate(r.att_date)
        });
    }

    for (const m of marksEntered) {
        items.push({
            id: `marks-${m.exam_id}`,
            kind: "Result",
            title: "Marks entered",
            message: `${m.subject_code} ${m.exam_type} "${m.exam_name}" — `
                + `${m.students} students`
                + (m.avg_percentage !== null ? `, class average ${m.avg_percentage}%.` : "."),
            at: `${isoDate(m.exam_date)}T00:00:00`,
            date: isoDate(m.exam_date)
        });
    }

    for (const e of upcomingExams) {
        items.push({
            id: `exam-${e.exam_id}`,
            kind: "Academic",
            title: `${e.exam_type} scheduled`,
            message: `${e.subject_code} — "${e.exam_name}" on `
                + `${isoDate(e.exam_date)}, out of ${e.total_marks} marks.`,
            at: `${isoDate(e.exam_date)}T00:00:00`,
            date: isoDate(e.exam_date)
        });
    }

    for (const a of posted) {
        items.push({
            id: `announcement-${a.announcement_id}`,
            kind: "Announcement",
            title: "Announcement posted",
            message: `${a.title} — addressed to ${a.target_role}.`,
            at: a.created_at,
            date: isoDate(a.created_at)
        });
    }

    items.sort((a, b) => new Date(b.at) - new Date(a.at));

    return items.slice(0, take);
};

// --------------------------------------------------------------- dashboard

// A student under this line is flagged for follow-up. 75% is the attendance
// requirement stated in the institute's own rules, not an invented number.
const ATTENDANCE_AT_RISK = 75;

// Marks percentage at or above which a student is counted as excelling.
const MARKS_EXCELLENT = 85;

/** Per-student attendance across every subject this teacher teaches them. */
const teacherStudentAttendance = async (pairs) => {

    if (!pairs.length) return [];

    return sequelize.query(
        `SELECT a.student_id,
                st.user_id,
                st.registration_number,
                CONCAT(st.first_name, ' ', st.last_name) AS full_name,
                sec.section_name,
                COUNT(*) AS total_sessions,
                SUM(a.status = 'Present') AS present_count,
                SUM(a.status = 'Late') AS late_count
           FROM attendance a
           JOIN students st ON st.student_id = a.student_id
      LEFT JOIN sections sec ON sec.section_id = st.section_id
          WHERE st.is_deleted = 0
            AND (a.subject_id, st.section_id) IN (:pairs)
          GROUP BY a.student_id, st.registration_number,
                   st.first_name, st.last_name, sec.section_name`,
        { ...SELECT, replacements: { pairs } }
    );
};

/** Class-level marks average, one row per (subject, section). */
const classMarksAverages = async (pairs) => {

    if (!pairs.length) return new Map();

    const rows = await sequelize.query(
        `SELECT e.subject_id,
                st.section_id,
                COUNT(DISTINCT m.student_id) AS graded_students,
                SUM(m.obtained_marks) AS obtained,
                SUM(e.total_marks) AS total
           FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
           JOIN students st ON st.student_id = m.student_id
          WHERE st.is_deleted = 0
            AND (e.subject_id, st.section_id) IN (:pairs)
          GROUP BY e.subject_id, st.section_id`,
        { ...SELECT, replacements: { pairs } }
    );

    return new Map(rows.map((r) => [
        classKey(r.subject_id, r.section_id),
        {
            graded_students: Number(r.graded_students),
            percentage: pct(Number(r.obtained), Number(r.total))
        }
    ]));
};

/** Per-student marks percentage across this teacher's subjects. */
const teacherStudentMarks = async (pairs) => {

    if (!pairs.length) return [];

    return sequelize.query(
        `SELECT m.student_id,
                SUM(m.obtained_marks) AS obtained,
                SUM(e.total_marks) AS total
           FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
           JOIN students st ON st.student_id = m.student_id
          WHERE st.is_deleted = 0
            AND (e.subject_id, st.section_id) IN (:pairs)
          GROUP BY m.student_id`,
        { ...SELECT, replacements: { pairs } }
    );
};

/** The institute's own grading ladder, used to bucket the marks above. */
const gradingScale = async () =>
    sequelize.query(
        `SELECT grade_letter, min_percentage, max_percentage, grade_point
           FROM grades
          ORDER BY min_percentage DESC`,
        SELECT
    );

/**
 * Everything the teacher dashboard renders, in one call.
 *
 * The screen previously showed a fixed three-lecture "Today's Schedule", an
 * "AI Academic Insights" panel with the constants 8 / 24 / 12% / 91%, and four
 * stat cards fed by a submissions collection that is always empty because the
 * database has no submissions table. All four numbers below are counted from
 * the teacher's own rows.
 */
const getDashboard = async (teacher) => {

    const classes = await getClasses(teacher.teacher_id);

    const date = todayIso();
    const weekday = DAYS[new Date(`${date}T00:00:00`).getDay()];

    // Today's lectures, in the order they are taught.
    const todaySchedule = classes
        .flatMap((c) => c.slots
            .filter((s) => s.day_of_week === weekday)
            .map((s) => ({
                timetable_id: s.timetable_id,
                subject_id: c.subject_id,
                section_id: c.section_id,
                subject_code: c.subject_code,
                subject_name: c.subject_name,
                section_name: c.section_name,
                program_name: c.program_name,
                semester_number: c.semester_number,
                start_time: s.start_time,
                end_time: s.end_time,
                room_name: s.room_name,
                building: s.building,
                student_count: c.student_count
            })))
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

    const pairs = classes.map((c) => [c.subject_id, c.section_id]);

    // Which of today's lectures already have a register saved.
    const markedToday = todaySchedule.length
        ? await sequelize.query(
            `SELECT timetable_id, COUNT(*) AS marked
               FROM attendance
              WHERE att_date = :date
                AND timetable_id IN (:timetableIds)
              GROUP BY timetable_id`,
            {
                ...SELECT,
                replacements: {
                    date,
                    timetableIds: todaySchedule.map((s) => s.timetable_id)
                }
            }
        )
        : [];

    const markedByTimetable = new Map(
        markedToday.map((r) => [r.timetable_id, Number(r.marked)])
    );

    for (const slot of todaySchedule) {
        slot.attendance_marked = markedByTimetable.get(slot.timetable_id) || 0;
        slot.is_marked = (markedByTimetable.get(slot.timetable_id) || 0) > 0;
    }

    const [attendanceRows, marksRows, grades, classMarks] = await Promise.all([
        teacherStudentAttendance(pairs),
        teacherStudentMarks(pairs),
        gradingScale(),
        classMarksAverages(pairs)
    ]);

    // --- students at risk / excelling -------------------------------------
    const attendanceByStudent = attendanceRows.map((r) => {
        const total = Number(r.total_sessions);
        const attended = Number(r.present_count) + Number(r.late_count);
        return {
            student_id: r.student_id,
            user_id: r.user_id ?? null,
            registration_number: r.registration_number,
            full_name: r.full_name,
            section_name: r.section_name,
            total_sessions: total,
            percentage: pct(attended, total)
        };
    });

    const atRisk = attendanceByStudent
        .filter((s) => s.percentage !== null && s.percentage < ATTENDANCE_AT_RISK)
        .sort((a, b) => a.percentage - b.percentage);

    const marksByStudent = marksRows
        .map((r) => ({
            student_id: r.student_id,
            percentage: pct(Number(r.obtained), Number(r.total))
        }))
        .filter((s) => s.percentage !== null);

    const excellent = marksByStudent.filter((s) => s.percentage >= MARKS_EXCELLENT);

    // --- grade distribution over this teacher's subjects -------------------
    const buckets = new Map(grades.map((g) => [g.grade_letter, 0]));

    for (const student of marksByStudent) {
        const grade = grades.find(
            (g) => student.percentage >= Number(g.min_percentage)
                && student.percentage <= Number(g.max_percentage)
        );
        if (grade) buckets.set(grade.grade_letter, buckets.get(grade.grade_letter) + 1);
    }

    const gradeDistribution = grades.map((g) => ({
        grade: g.grade_letter,
        grade_point: Number(g.grade_point),
        count: buckets.get(g.grade_letter) || 0
    }));

    // --- headline numbers --------------------------------------------------
    /*
     * Distinct students, not the sum of the class headcounts.
     *
     * `student_count` on a class is the headcount of its whole SECTION, which
     * is right for a class card ("CS-101, CS-1A, 4 students") but wrong to add
     * up: a teacher taking one section for two subjects appears twice in
     * `classes`, and summing reported 8 students for the same 4 people. The
     * roster screens count the section directly and said 4, so the dashboard
     * card and the class it opens disagreed.
     *
     * Keyed by section so each one contributes its headcount once. getProfile
     * already counts distinct students for the same reason.
     */
    const sectionSizes = new Map(
        classes.map((c) => [c.section_id, c.student_count])
    );

    const totalStudents = [...sectionSizes.values()]
        .reduce((sum, count) => sum + count, 0);

    const uniqueSections = sectionSizes.size;

    const overall = attendanceByStudent.filter((s) => s.percentage !== null);
    const avgAttendance = overall.length
        ? Math.round(
            (overall.reduce((sum, s) => sum + s.percentage, 0) / overall.length) * 10
        ) / 10
        : null;

    // --- per-class performance, attendance next to marks -------------------
    const classPerformance = classes.map((c) => {
        const marks = classMarks.get(c.key) || null;
        return {
            subject_id: c.subject_id,
            section_id: c.section_id,
            label: `${c.subject_code} · Sec ${c.section_name}`,
            subject_name: c.subject_name,
            students: c.student_count,
            attendance_percentage: c.attendance ? c.attendance.percentage : null,
            attendance_records: c.attendance ? c.attendance.totalSessions : 0,
            marks_percentage: marks ? marks.percentage : null,
            graded_students: marks ? marks.graded_students : 0
        };
    });

    // --- what to do about it ----------------------------------------------
    // Each line is generated from a number counted above, so the panel never
    // recommends anything that is not true of this teacher's own classes. It
    // replaces three sentences that were compiled into the bundle, naming
    // students who do not exist ("Omar Sheikh's attendance (55% — critical)").
    const actions = [];

    const pendingToday = todaySchedule.filter((s) => !s.is_marked);

    if (pendingToday.length) {
        actions.push(
            `Mark today's register for ${pendingToday
                .map((s) => `${s.subject_code} (Sec ${s.section_name})`)
                .join(", ")}.`
        );
    }

    if (atRisk.length) {
        actions.push(
            `${atRisk.length} student${atRisk.length > 1 ? "s are" : " is"} below the `
            + `${ATTENDANCE_AT_RISK}% attendance requirement — lowest is `
            + `${atRisk[0].full_name} at ${atRisk[0].percentage}%.`
        );
    }

    const ungraded = classPerformance.filter((c) => c.graded_students === 0);

    if (ungraded.length) {
        actions.push(
            `No marks have been entered yet for ${ungraded
                .map((c) => c.label)
                .join(", ")}.`
        );
    }

    const weakest = classPerformance
        .filter((c) => c.marks_percentage !== null)
        .sort((a, b) => a.marks_percentage - b.marks_percentage)[0];

    if (weakest && weakest.marks_percentage < 60) {
        actions.push(
            `${weakest.label} is averaging ${weakest.marks_percentage}% — `
            + "consider supplementary material for this class."
        );
    }

    const unrecorded = classPerformance.filter((c) => c.attendance_records === 0);

    if (unrecorded.length) {
        actions.push(
            `No attendance has ever been recorded for ${unrecorded
                .map((c) => c.label)
                .join(", ")}.`
        );
    }

    if (!actions.length) {
        actions.push("Nothing needs attention — every register is marked and no student is below threshold.");
    }

    return {
        teacher: {
            teacher_id: teacher.teacher_id,
            full_name: [teacher.first_name, teacher.last_name].filter(Boolean).join(" "),
            designation: teacher.designation,
            department_name: teacher.department_name,
            email: teacher.email,
            specialization: teacher.specialization
        },

        today: {
            date,
            day_of_week: weekday,
            schedule: todaySchedule,
            lectures: todaySchedule.length,
            registers_marked: todaySchedule.filter((s) => s.is_marked).length
        },

        stats: {
            classes: classes.length,
            subjects: new Set(classes.map((c) => c.subject_id)).size,
            sections: uniqueSections,
            students: totalStudents,
            lectures_today: todaySchedule.length,
            registers_pending: todaySchedule.filter((s) => !s.is_marked).length,
            average_attendance: avgAttendance,
            students_at_risk: atRisk.length,
            students_excelling: excellent.length,
            students_graded: marksByStudent.length
        },

        // Attendance rate per class, for the dashboard's bar chart.
        attendance_by_class: classes.map((c) => ({
            subject_id: c.subject_id,
            section_id: c.section_id,
            label: `${c.subject_code} · ${c.section_name}`,
            percentage: c.attendance ? c.attendance.percentage : null,
            total_sessions: c.attendance ? c.attendance.totalSessions : 0
        })),

        grade_distribution: gradeDistribution,

        class_performance: classPerformance,

        // Named students, so the panel points at someone the teacher can
        // actually follow up with instead of a generic count.
        at_risk_students: atRisk.slice(0, 5),

        recommended_actions: actions,

        thresholds: {
            attendance_at_risk: ATTENDANCE_AT_RISK,
            marks_excellent: MARKS_EXCELLENT
        }
    };
};

// ----------------------------------------------------------------- profile

/**
 * Everything the teacher's Profile screen shows, from the rows that hold it.
 *
 * The screen used to print a fixed "Academic Information" panel for every
 * teacher alike - Spring 2026, joining year 2019, "PhD (Computer Science)",
 * "Machine Learning & AI", "CS Block, Room 312" - none of which came from
 * anywhere. The fields below are the ones this schema can actually answer:
 *
 *   employee_code, designation, department  -> employees / departments
 *   email, phone, profile_picture           -> users
 *   specialization                          -> teachers
 *   joined_on, experience_years             -> employees.hire_date
 *   current_semester                        -> semesters, by today's date
 *   total_students / class / subject counts -> the teacher's own timetable
 *   rooms                                   -> classrooms via timetables
 *
 * There is no qualification column anywhere in the schema, so the screen no
 * longer claims one.
 */
const getProfile = async (teacher) => {

    const [accountRows, classes] = await Promise.all([
        sequelize.query(
            `SELECT u.user_id,
                    u.email,
                    u.phone,
                    u.profile_picture,
                    u.last_login,
                    e.hire_date
               FROM employees e
               JOIN users u ON u.user_id = e.user_id
              WHERE e.employee_id = :employeeId
              LIMIT 1`,
            { ...SELECT, replacements: { employeeId: teacher.employee_id } }
        ),
        getClasses(teacher.teacher_id)
    ]);

    const account = accountRows.length ? accountRows[0] : {};

    const hireDate = isoDate(account.hire_date);

    // Whole years between the hire date and today, floored - the figure a CV
    // would state.
    const experienceYears = hireDate
        ? Math.max(0, Math.floor(
            (Date.now() - new Date(hireDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
        ))
        : null;

    // The semester currently running on one of the programmes this teacher
    // teaches. Semester rows are per-programme, so several can be open at once;
    // the one ending soonest is the one their classes are actually sitting in.
    const semesterIds = [...new Set(classes.map((c) => c.semester_id).filter(Boolean))];

    let currentSemester = null;

    if (semesterIds.length) {
        const rows = await sequelize.query(
            `SELECT sem.semester_id,
                    sem.semester_number,
                    sem.start_date,
                    sem.end_date,
                    p.program_name
               FROM semesters sem
          LEFT JOIN programs p ON p.program_id = sem.program_id
              WHERE sem.semester_id IN (:semesterIds)
                AND sem.is_archived = 0
                AND :today BETWEEN sem.start_date AND sem.end_date
              ORDER BY sem.end_date ASC
              LIMIT 1`,
            { ...SELECT, replacements: { semesterIds, today: todayIso() } }
        );

        if (rows.length) {
            currentSemester = {
                semester_id: rows[0].semester_id,
                semester_number: rows[0].semester_number,
                program_name: rows[0].program_name,
                start_date: isoDate(rows[0].start_date),
                end_date: isoDate(rows[0].end_date)
            };
        }
    }

    // Distinct students, not the sum of the class headcounts: a section this
    // teacher takes for two subjects would otherwise be counted twice.
    const sectionIds = [...new Set(classes.map((c) => c.section_id))];

    let totalStudents = 0;

    if (sectionIds.length) {
        const [row] = await sequelize.query(
            `SELECT COUNT(DISTINCT st.student_id) AS total
               FROM students st
              WHERE st.section_id IN (:sectionIds)
                AND st.is_deleted = 0`,
            { ...SELECT, replacements: { sectionIds } }
        );
        totalStudents = Number(row.total || 0);
    }

    // Where this teacher actually teaches, from the timetable's classrooms.
    const rooms = [...new Set(
        classes
            .flatMap((c) => c.slots)
            .map((s) => (s.room_name
                ? [s.room_name, s.building].filter(Boolean).join(", ")
                : null))
            .filter(Boolean)
    )];

    return {
        teacher_id: teacher.teacher_id,
        user_id: account.user_id ?? teacher.user_id ?? null,
        employee_id: teacher.employee_id,
        employee_code: teacher.employee_code,
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        full_name: [teacher.first_name, teacher.last_name].filter(Boolean).join(" "),
        designation: teacher.designation,
        department_id: teacher.department_id,
        department_name: teacher.department_name,
        employment_status: teacher.employment_status,
        email: account.email ?? teacher.email ?? null,
        phone: account.phone ?? null,
        profile_picture: account.profile_picture ?? null,
        last_login: account.last_login ?? null,

        specialization: teacher.specialization,
        joined_on: hireDate,
        joining_year: hireDate ? Number(hireDate.slice(0, 4)) : null,
        experience_years: experienceYears,

        current_semester: currentSemester,
        total_students: totalStudents,
        class_count: classes.length,
        subject_count: new Set(classes.map((c) => c.subject_id)).size,
        section_count: sectionIds.length,
        rooms,

        // One card per subject+section taught, which is what the "Assigned
        // Subjects" panel lists.
        subjects: classes.map((c) => ({
            subject_id: c.subject_id,
            section_id: c.section_id,
            subject_code: c.subject_code,
            subject_name: c.subject_name,
            section_name: c.section_name,
            program_name: c.program_name,
            semester_number: c.semester_number,
            credit_hours: c.credit_hours,
            student_count: c.student_count
        }))
    };
};

/**
 * The teacher's own edits to their profile.
 *
 * Deliberately narrow. Name, designation and department are HR records on
 * `employees` and stay with the Admin - the screen has always said so, but its
 * form accepted changes to them and dropped them on save. What a teacher owns
 * is their contact details (`users`) and their stated specialization
 * (`teachers`).
 */
const updateProfile = async (teacher, payload = {}) => {

    const userUpdates = {};

    if (payload.email !== undefined) {
        const email = String(payload.email).trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { error: "A valid email address is required." };
        }

        // users.email is UNIQUE; without this the insert fails as a 500.
        const clash = await sequelize.query(
            `SELECT user_id FROM users
              WHERE email = :email AND user_id <> :userId LIMIT 1`,
            { ...SELECT, replacements: { email, userId: teacher.user_id } }
        );

        if (clash.length) return { error: "That email address is already in use.", status: 409 };

        userUpdates.email = email;
    }

    if (payload.phone !== undefined) {
        const phone = payload.phone === null ? null : String(payload.phone).trim();

        if (phone && phone.length > 20) {
            return { error: "Phone number must be 20 characters or fewer." };
        }

        userUpdates.phone = phone || null;
    }

    const teacherUpdates = {};

    if (payload.specialization !== undefined) {
        const specialization = payload.specialization === null
            ? null
            : String(payload.specialization).trim();

        if (specialization && specialization.length > 150) {
            return { error: "Specialization must be 150 characters or fewer." };
        }

        teacherUpdates.specialization = specialization || null;
    }

    if (!Object.keys(userUpdates).length && !Object.keys(teacherUpdates).length) {
        return { error: "Nothing to update. Send email, phone and/or specialization." };
    }

    await sequelize.transaction(async (transaction) => {

        if (Object.keys(userUpdates).length) {
            const setClause = Object.keys(userUpdates)
                .map((field) => `\`${field}\` = :${field}`)
                .join(", ");

            await sequelize.query(
                `UPDATE users SET ${setClause} WHERE user_id = :userId`,
                {
                    transaction,
                    replacements: { ...userUpdates, userId: teacher.user_id }
                }
            );
        }

        if (Object.keys(teacherUpdates).length) {
            await sequelize.query(
                `UPDATE teachers SET specialization = :specialization
                  WHERE teacher_id = :teacherId`,
                {
                    transaction,
                    replacements: {
                        specialization: teacherUpdates.specialization,
                        teacherId: teacher.teacher_id
                    }
                }
            );
        }
    });

    // Re-read so the response carries what is actually stored, including the
    // fields this call did not touch.
    const refreshed = await resolveTeacher(
        { user_id: teacher.user_id, role_id: ROLES.TEACHER },
        null
    );

    return { profile: await getProfile(refreshed || teacher) };
};

// ------------------------------------------------------------------ badges

/**
 * The counts behind the sidebar bubbles.
 *
 * Both numbers used to be literals in Sidebar.jsx - `badge: 5` on Assignments
 * and `badge: 2` on Notifications - so every teacher saw the same two bubbles
 * and nothing they did ever cleared them.
 *
 * Notifications is simply the unread count, which the existing read/read-all
 * endpoints already clear.
 *
 * Assignments is "how many assignments have appeared since you last opened the
 * page". `exams` has no created_at, but exam_id is auto-increment and therefore
 * monotonic, so the highest id the teacher has acknowledged is a sound
 * watermark. Opening the Assignments screen saves the current maximum through
 * PUT /api/users/me/preferences, and the bubble goes away.
 */
const getBadges = async (teacher, user, preferences) => {

    const classes = await getClasses(teacher.teacher_id);
    const subjectIds = [...new Set(classes.map((c) => c.subject_id))];

    let assignmentsNew = 0;
    let latestAssignmentId = 0;

    if (subjectIds.length) {
        const [row] = await sequelize.query(
            `SELECT COUNT(*) AS new_count,
                    COALESCE(MAX(e.exam_id), 0) AS latest_id
               FROM exams e
              WHERE e.subject_id IN (:subjectIds)
                AND e.exam_type = 'Assignment'`,
            { ...SELECT, replacements: { subjectIds } }
        );

        latestAssignmentId = Number(row.latest_id || 0);

        const [unseen] = await sequelize.query(
            `SELECT COUNT(*) AS unseen
               FROM exams e
              WHERE e.subject_id IN (:subjectIds)
                AND e.exam_type = 'Assignment'
                AND e.exam_id > :watermark`,
            {
                ...SELECT,
                replacements: {
                    subjectIds,
                    watermark: Number(preferences?.seen?.assignments || 0)
                }
            }
        );

        assignmentsNew = Number(unseen.unseen || 0);
    }

    // Muted categories are hidden from the feed, so counting them here would
    // leave a bubble with nothing behind it to open.
    const mutedTypes = preferences?.notifications?.mutedTypes || [];

    const [unreadRow] = await sequelize.query(
        `SELECT COUNT(*) AS unread
           FROM notifications
          WHERE user_id = :userId
            AND is_read = 0
            ${mutedTypes.length ? "AND type NOT IN (:mutedTypes)" : ""}`,
        {
            ...SELECT,
            replacements: mutedTypes.length
                ? { userId: user.user_id, mutedTypes }
                : { userId: user.user_id }
        }
    );

    const showUnread = preferences?.notifications?.unreadBadge !== false;
    const showAssignments = preferences?.notifications?.assignmentBadge !== false;

    return {
        // The watermark the client should save when the page is opened.
        latest_assignment_id: latestAssignmentId,
        assignments: showAssignments ? assignmentsNew : 0,
        notifications: showUnread ? Number(unreadRow.unread || 0) : 0
    };
};

module.exports = {
    // Shared with facultyAcademicsService, which builds the marks, students
    // and reports screens on the same teacher scoping.
    isoDate,
    todayIso,
    pct,
    classKey,
    sectionRoster,
    findClass,
    gradingScale,

    resolveTeacher,
    getClasses,
    getClassRoster,
    getAttendanceSheet,
    saveAttendance,
    getAttendanceTrend,
    getNotificationFeed,
    getActivity,
    getDashboard,
    getProfile,
    updateProfile,
    getBadges
};
