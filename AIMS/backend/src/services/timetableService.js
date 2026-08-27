const { Op } = require("sequelize");
const Timetable = require("../models/timetable.model");
const { sequelize } = require("../database/connection");
const { ROLES, ADMINS } = require("../config/roles");
const { SLOTS, BREAK, normalizeTime, findSlot, findSlotByStart } = require("../config/timetableSlots");

// Get all timetables
const getAllTimetables = async () => {
    return await Timetable.findAll();
};

// Get timetable by ID
const getTimetableById = async (id) => {
    return await Timetable.findByPk(id);
};

// A booking problem the caller can fix, as opposed to a server fault.
// `statusCode` is the key sendError() looks for in utils/apiError.js, so these
// surface with their own status instead of a blanket 500. Off-grid times are a
// 400 (the request is malformed); a double-booking is a 409 (the request is
// well-formed but the period is taken).
class TimetableConflictError extends Error {
    constructor(message, statusCode = 409) {
        super(message);
        this.name = "TimetableConflictError";
        this.statusCode = statusCode;
    }
}

// A section, a teacher and a room can each only be in one place per period, so
// a row conflicts with any existing row sharing its day + start_time on any of
// those three. The unique indexes added in
// 20260807120000-enforce-timetable-slot-grid.js enforce exactly the same three
// rules at the schema level; this check exists so the API answers with a clear
// 409 naming what clashed, instead of surfacing a driver-level duplicate-key
// error.
//
// Scoped to a term since 20260822094000-scope-timetable-uniqueness-to-term.js
// widened those indexes to lead with term_id. Without the same scope here the
// two would disagree in both directions: this would report a clash against
// last year's timetable that the database would happily accept, and - worse -
// an admin building next term would be told every period is taken.
const assertNoConflict = async ({ term_id, section_id, teacher_id, classroom_id, day_of_week, start_time }, excludeId = null) => {

    const start = normalizeTime(start_time);

    const clashes = await Timetable.findAll({
        where: {
            day_of_week,
            start_time: start,
            // A row with no term cannot be placed: the column is NOT NULL, and
            // an unscoped check here would be the disagreement described above.
            term_id,
            ...(excludeId ? { timetable_id: { [Op.ne]: excludeId } } : {}),
            [Op.or]: [
                { section_id },
                { teacher_id },
                ...(classroom_id ? [{ classroom_id }] : [])
            ]
        }
    });

    if (clashes.length === 0) return;

    const slot = findSlotByStart(start);
    const period = slot ? `slot ${slot.slot_number} (${slot.start_time}-${slot.end_time})` : start;

    // Report every resource that clashed, not just the first, so an admin
    // fixing the entry does not have to resubmit three times to find them all.
    const reasons = [];

    if (clashes.some((c) => c.section_id === Number(section_id))) {
        reasons.push("the section already has a class");
    }

    if (clashes.some((c) => c.teacher_id === Number(teacher_id))) {
        reasons.push("the teacher is already teaching");
    }

    if (classroom_id && clashes.some((c) => c.classroom_id === Number(classroom_id))) {
        reasons.push("the room is already booked");
    }

    throw new TimetableConflictError(
        `Cannot book ${day_of_week} ${period}: ${reasons.join(", ")}.`
    );
};

// Guards shared by create and update: the times must name a canonical slot,
// and must not fall inside the break.
const assertOnGrid = (start_time, end_time) => {

    if (findSlot(start_time, end_time)) return;

    const start = normalizeTime(start_time);

    if (start && start >= BREAK.start_time && start < BREAK.end_time) {
        throw new TimetableConflictError(
            `${BREAK.start_time}-${BREAK.end_time} is the daily break and cannot be booked.`,
            400
        );
    }

    throw new TimetableConflictError(
        `start_time ${start_time} / end_time ${end_time} is not a timetable slot. ` +
        `Valid slots: ${SLOTS.map((s) => `${s.start_time}-${s.end_time}`).join(", ")}.`,
        400
    );
};

/*
 * Create timetable.
 *
 * `timetables` now belongs to a term and, through offering_id, to a class.
 * This entry point predates both and is kept for the plain REST route, so it
 * fills them in rather than refusing: an offering_id resolves the term, the
 * section, the subject and the teacher from the class itself, which is the
 * only way those columns stay in step with it.
 *
 * Placement is better done through schedulingService.placeSession, which shows
 * the admin what is free before they choose instead of validating a guess.
 * This remains the low-level door.
 */
const createTimetable = async (timetableData) => {

    assertOnGrid(timetableData.start_time, timetableData.end_time);

    const resolved = await resolveOfferingContext(timetableData);

    await assertNoConflict(resolved);

    return await Timetable.create({
        ...resolved,
        start_time: normalizeTime(resolved.start_time),
        end_time: normalizeTime(resolved.end_time)
    });
};

/*
 * Fills in term_id, and - when an offering is named - the section, subject and
 * teacher that offering already knows.
 *
 * Taking them from the offering rather than the request is what stops a
 * timetable row disagreeing with the class it belongs to. A caller who passes
 * both an offering_id and a conflicting teacher_id is corrected, not obeyed:
 * the class is the authority on who teaches it.
 *
 * With no offering_id, the term has to be supplied or inferred, and the row is
 * an unattached one - legal, because rows predating offerings exist, but it
 * cannot be moved by the scheduler afterwards.
 */
const resolveOfferingContext = async (data) => {

    if (data.offering_id) {

        const rows = await query(
            `SELECT term_id, section_id, subject_id, teacher_id
               FROM course_offerings
              WHERE offering_id = :offeringId AND is_deleted = 0
              LIMIT 1`,
            { offeringId: data.offering_id }
        );

        if (!rows.length) {
            throw new TimetableConflictError(
                `No course offering ${data.offering_id}.`,
                404
            );
        }

        const offering = rows[0];

        if (offering.teacher_id === null) {
            throw new TimetableConflictError(
                "That class has no teacher assigned, so it cannot be put on the " +
                "timetable yet.",
                422
            );
        }

        return {
            ...data,
            term_id: offering.term_id,
            section_id: offering.section_id,
            subject_id: offering.subject_id,
            teacher_id: offering.teacher_id
        };
    }

    if (data.term_id) return data;

    // No term named and no class to read it from: fall back to the term that
    // is running, so the plain REST route keeps working as it did.
    const current = await query(
        `SELECT term_id FROM academic_terms
          WHERE is_deleted = 0 AND status IN ('Active', 'Planned')
          ORDER BY FIELD(status, 'Active', 'Planned'), start_date DESC
          LIMIT 1`
    );

    if (!current.length) {
        throw new TimetableConflictError(
            "No academic term is active or planned, so there is nowhere to put " +
            "this period. Create a term first.",
            422
        );
    }

    return { ...data, term_id: current[0].term_id };
};

// Update timetable
const updateTimetable = async (id, timetableData) => {
    const timetable = await Timetable.findByPk(id);

    if (!timetable) {
        return null;
    }

    // A partial update still has to be checked against the row's *resulting*
    // state - moving only the teacher can create a clash just as easily as
    // moving the time.
    const merged = {
        // The term is not editable here: moving a period into another term
        // would mean moving the class, which is a different operation.
        term_id: timetable.term_id,
        section_id: timetableData.section_id ?? timetable.section_id,
        teacher_id: timetableData.teacher_id ?? timetable.teacher_id,
        classroom_id: timetableData.classroom_id ?? timetable.classroom_id,
        day_of_week: timetableData.day_of_week ?? timetable.day_of_week,
        start_time: timetableData.start_time ?? timetable.start_time,
        end_time: timetableData.end_time ?? timetable.end_time
    };

    assertOnGrid(merged.start_time, merged.end_time);

    await assertNoConflict(merged, timetable.timetable_id);

    await timetable.update({
        ...timetableData,
        ...(timetableData.start_time !== undefined
            ? { start_time: normalizeTime(timetableData.start_time) }
            : {}),
        ...(timetableData.end_time !== undefined
            ? { end_time: normalizeTime(timetableData.end_time) }
            : {})
    });

    return timetable;
};

// Delete timetable
const deleteTimetable = async (id) => {
    const timetable = await Timetable.findByPk(id);

    if (!timetable) {
        return null;
    }

    await timetable.destroy();

    return timetable;
};

// =====================================================================
// LIVE ("SMART") TIMETABLE
// =====================================================================
//
// The plain list endpoints above return rows with no notion of "now", so every
// portal had to work out which day and which lecture to highlight in the
// browser - from the device clock, which is wrong whenever the device clock is
// wrong or set to another timezone. This resolves the current day and slot
// server-side and returns the whole week already flagged.

// The university's timezone. Pakistan is UTC+5 year-round with no DST, so the
// day boundary and every lecture time are evaluated here rather than in the
// server's local timezone, which depends on where it happens to be deployed.
const DEFAULT_TIMEZONE = "Asia/Karachi";

// timetables.day_of_week is an ENUM with no Sunday - the university does not
// timetable Sundays. Index 0 is Sunday so this lines up with the weekday names
// Intl reports.
const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
];

const TEACHING_DAYS = WEEKDAYS.slice(1);

// "HH:MM:SS" -> seconds since midnight. MySQL returns TIME as a string.
const toSeconds = (time) => {
    if (!time) return null;

    const [h = 0, m = 0, s = 0] = String(time).split(":").map(Number);

    return (h * 3600) + (m * 60) + s;
};

// The calendar date, weekday and wall-clock time as they read in `timezone`,
// independent of the server's own locale and offset.
const resolveNow = (timezone, now = new Date()) => {

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(now).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});

    const time = `${parts.hour}:${parts.minute}:${parts.second}`;

    return {
        timezone,
        // ISO instant, so a client can measure its own clock drift against it.
        server_time: now.toISOString(),
        date: `${parts.year}-${parts.month}-${parts.day}`,
        day: parts.weekday,
        time,
        seconds_since_midnight: toSeconds(time),
        // Sunday and any other non-teaching day: the week still renders, just
        // with nothing highlighted.
        is_teaching_day: TEACHING_DAYS.includes(parts.weekday)
    };
};

const query = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

// Which rows this caller may see. A student and a parent never choose: the
// scope is derived from the token (and, for a parent, from the guardian link),
// so neither can read another section's timetable by passing an id.
const resolveScope = async ({ user, sectionId, teacherId, studentId }) => {

    const roleId = user.role_id;

    if (roleId === ROLES.STUDENT) {

        const rows = await query(
            `SELECT student_id, section_id FROM students
              WHERE user_id = :userId AND is_deleted = 0
              LIMIT 1`,
            { userId: user.user_id }
        );

        if (!rows.length) {
            return { error: "No student record is linked to this account" };
        }

        if (!rows[0].section_id) {
            return { error: "You are not assigned to a section yet" };
        }

        return {
            type: "section",
            section_id: rows[0].section_id,
            student_id: rows[0].student_id
        };
    }

    if (roleId === ROLES.TEACHER) {

        const rows = await query(
            `SELECT t.teacher_id
               FROM teachers t
               JOIN employees e ON e.employee_id = t.employee_id
              WHERE e.user_id = :userId
                AND t.is_deleted = 0
                AND e.is_deleted = 0
              LIMIT 1`,
            { userId: user.user_id }
        );

        if (!rows.length) {
            return { error: "No teacher record is linked to this account" };
        }

        return { type: "teacher", teacher_id: rows[0].teacher_id };
    }

    if (roleId === ROLES.PARENT) {

        // A parent may have more than one child, so the child is chosen by
        // ?student_id=. The guardian link is what authorises it - an
        // unrelated id resolves to nothing and is refused.
        const children = await query(
            `SELECT s.student_id, s.section_id, s.first_name, s.last_name
               FROM student_guardians sg
               JOIN students s ON s.student_id = sg.student_id
               JOIN parents  p ON p.parent_id  = sg.parent_id
              WHERE p.user_id = :userId
                AND p.is_deleted = 0
                AND s.is_deleted = 0
              ORDER BY s.student_id`,
            { userId: user.user_id }
        );

        if (!children.length) {
            return { error: "No children are linked to this parent account" };
        }

        const child = studentId
            ? children.find((c) => Number(c.student_id) === Number(studentId))
            : children[0];

        if (!child) {
            return { error: "You can only view your own children's timetable" };
        }

        if (!child.section_id) {
            return { error: "This student is not assigned to a section yet" };
        }

        return {
            type: "section",
            section_id: child.section_id,
            student_id: child.student_id,
            children: children.map((c) => ({
                student_id: c.student_id,
                name: `${c.first_name} ${c.last_name}`
            }))
        };
    }

    // Admin and Super Admin: an explicit section or teacher. Unfiltered would
    // be the whole university's timetable in one response, which no screen
    // wants and which makes "the current lecture" meaningless.
    if (!ADMINS.includes(roleId)) {
        return { error: "Your role does not have a timetable view" };
    }

    if (sectionId) return { type: "section", section_id: Number(sectionId) };
    if (teacherId) return { type: "teacher", teacher_id: Number(teacherId) };

    return {
        error: "Pass section_id or teacher_id to view a timetable"
    };
};

/*
 * The rows behind /api/timetables/current.
 *
 * WHY THIS IS NOT "THE SECTION'S TIMETABLE" ANY MORE
 * --------------------------------------------------
 * A student used to be resolved to their section and handed that section's
 * whole grid. That answers a different question than the one the screen asks.
 * A section's timetable lists every subject the section sits — including ones
 * this student is not enrolled in, and including a subject they dropped — and
 * it cannot distinguish the two. "What am I taught, and by whom" is a fact
 * about enrolments, so it is now read from them.
 *
 * The three scopes:
 *   student/parent -> the offerings this student is actively enrolled in
 *   teacher        -> the offerings this teacher holds
 *   section        -> the whole section (admins asking for a section directly)
 *
 * All three read the same join. `course_offerings` is the authority for who
 * teaches a class; `timetables.teacher_id` is denormalised and is no longer
 * consulted here.
 */
const fetchEntries = async (scope) => {

    /*
     * Scoped to one term. Before terms existed every row was "current"; now a
     * closed term keeps its grid as history and a planned one can be drafted
     * alongside, so an unscoped query would hand a student three timetables
     * stacked on top of each other.
     */
    const termRows = await query(
        `SELECT term_id FROM academic_terms
          WHERE status IN ('Active', 'Planned')
          ORDER BY FIELD(status, 'Active', 'Planned'), start_date
          LIMIT 1`
    );

    const termId = termRows.length ? termRows[0].term_id : null;

    let where;

    if (scope.type === "teacher") {
        where = "o.teacher_id = :teacherId";
    } else if (scope.student_id) {
        where = `EXISTS (
                    SELECT 1 FROM enrollments e
                     WHERE e.offering_id = o.offering_id
                       AND e.student_id = :studentId
                       AND e.status = 'Active'
                 )`;
    } else {
        where = "o.section_id = :sectionId";
    }

    return await query(
        `SELECT t.timetable_id, o.section_id, o.subject_id,
                sub.subject_code, sub.subject_name,
                o.teacher_id,
                emp.first_name AS teacher_first_name,
                emp.last_name  AS teacher_last_name,
                t.classroom_id, room.room_name, room.building,
                t.day_of_week, t.start_time, t.end_time,
                sec.section_name
           FROM timetables t
           JOIN course_offerings o ON o.offering_id = t.offering_id
                                  AND o.is_deleted = 0
                                  AND o.status <> 'Cancelled'
           JOIN subjects sub ON sub.subject_id = o.subject_id
      LEFT JOIN sections  sec  ON sec.section_id = o.section_id
      LEFT JOIN teachers  tch  ON tch.teacher_id = o.teacher_id
      LEFT JOIN employees emp  ON emp.employee_id = tch.employee_id
      LEFT JOIN classrooms room ON room.classroom_id = t.classroom_id
          WHERE ${where}
            AND (:termId IS NULL OR o.term_id = :termId)
          ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'),
                   t.start_time`,
        {
            teacherId: scope.teacher_id,
            sectionId: scope.section_id,
            studentId: scope.student_id,
            termId
        }
    );
};

const annotate = (entries, nowInfo) => {

    const nowSeconds = nowInfo.seconds_since_midnight;
    const todayIndex = WEEKDAYS.indexOf(nowInfo.day);

    const annotated = entries.map((entry) => {

        const startSeconds = toSeconds(entry.start_time);
        const endSeconds = toSeconds(entry.end_time);
        const isToday = entry.day_of_week === nowInfo.day;

        // A lecture is "current" from its start up to but not including its
        // end, so two back-to-back slots never both highlight.
        const isCurrent = isToday
            && nowSeconds >= startSeconds
            && nowSeconds < endSeconds;

        // How far into the week this sits relative to today, used to order
        // "what is next" across the day boundary.
        const dayIndex = WEEKDAYS.indexOf(entry.day_of_week);
        const daysAhead = (dayIndex - todayIndex + 7) % 7;

        return {
            ...entry,
            teacher_name: [entry.teacher_first_name, entry.teacher_last_name]
                .filter(Boolean).join(" "),
            is_today: isToday,
            is_current: isCurrent,
            is_past: isToday && nowSeconds >= endSeconds,
            is_upcoming: isToday && nowSeconds < startSeconds,
            starts_in_seconds: isToday && nowSeconds < startSeconds
                ? startSeconds - nowSeconds
                : null,
            ends_in_seconds: isCurrent ? endSeconds - nowSeconds : null,
            // Sort key for "next", counting a slot already finished today as
            // belonging to the same weekday next week.
            _order: (daysAhead === 0 && nowSeconds >= startSeconds)
                ? Number.MAX_SAFE_INTEGER
                : (daysAhead * 86400) + startSeconds
        };
    });

    const current = annotated.find((e) => e.is_current) || null;

    const next = annotated
        .filter((e) => e._order !== Number.MAX_SAFE_INTEGER && !e.is_current)
        .sort((a, b) => a._order - b._order)[0] || null;

    // When the highlight next changes: the end of the lecture in progress, or
    // the start of the following one. The portal can set a single timer for
    // exactly this instead of polling on a fixed interval.
    let secondsUntilChange = null;

    if (current) {
        secondsUntilChange = current.ends_in_seconds;
    } else if (next && next.is_today) {
        secondsUntilChange = next.starts_in_seconds;
    }

    const strip = ({ _order, ...rest }) => rest;

    return {
        entries: annotated.map(strip),
        current: current ? strip(current) : null,
        next: next ? strip(next) : null,
        seconds_until_change: secondsUntilChange
    };
};

// Monday..Saturday, each with its own rows, so a week view can render straight
// from the response without regrouping. Days with no lectures are kept as empty
// arrays rather than dropped, so the grid keeps its shape.
const groupByDay = (entries, today) =>
    TEACHING_DAYS.map((day) => ({
        day,
        is_today: day === today,
        entries: entries.filter((e) => e.day_of_week === day)
    }));

const getLiveTimetable = async ({ user, timezone, sectionId, teacherId, studentId }) => {

    const scope = await resolveScope({ user, sectionId, teacherId, studentId });

    if (scope.error) return { error: scope.error };

    const nowInfo = resolveNow(timezone || DEFAULT_TIMEZONE);
    const rows = await fetchEntries(scope);
    const { entries, current, next, seconds_until_change } = annotate(rows, nowInfo);

    return {
        now: nowInfo,
        scope: {
            type: scope.type,
            section_id: scope.section_id || null,
            teacher_id: scope.teacher_id || null,
            student_id: scope.student_id || null,
            children: scope.children
        },
        // The period grid itself, so the portals can render a column per slot -
        // including periods this section has free - instead of inferring the
        // columns from whichever rows happen to exist.
        slots: SLOTS.map((slot) => ({
            ...slot,
            is_current: nowInfo.day !== "Sunday"
                && nowInfo.seconds_since_midnight >= toSeconds(slot.start_time)
                && nowInfo.seconds_since_midnight < toSeconds(slot.end_time)
        })),
        break: {
            ...BREAK,
            is_current: nowInfo.day !== "Sunday"
                && nowInfo.seconds_since_midnight >= toSeconds(BREAK.start_time)
                && nowInfo.seconds_since_midnight < toSeconds(BREAK.end_time)
        },
        current_lecture: current,
        next_lecture: next,
        // null when nothing else happens today; the portal should then refresh
        // at the next day boundary rather than sit on a timer.
        seconds_until_change,
        today: entries.filter((e) => e.is_today),
        week: groupByDay(entries, nowInfo.day),
        count: entries.length
    };
};

module.exports = {
    getAllTimetables,
    getTimetableById,
    createTimetable,
    updateTimetable,
    deleteTimetable,
    getLiveTimetable,
    TimetableConflictError,
    // exported for the test suite
    resolveNow,
    assertNoConflict,
    assertOnGrid,
    DEFAULT_TIMEZONE
};
