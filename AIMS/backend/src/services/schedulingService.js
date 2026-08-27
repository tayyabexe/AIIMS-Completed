/*
 * The scheduling constraint engine.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Placing a class on the timetable means choosing a day, a period and a room.
 * Three things can make that choice illegal, and before this module the admin
 * had to know all three from memory and find out they were wrong by getting a
 * 409 back:
 *
 *   1. the section is already in a class that period
 *   2. the teacher is already teaching that period
 *   3. the room is taken that period - or is the wrong kind of room, or is
 *      too small for the class
 *
 * (1) and (2) block the period outright: no room helps, because the people are
 * busy. (3) is per-room, so a period can be open with only some of the estate
 * available in it.
 *
 * So rather than validate a guess, this computes the whole answer up front:
 * every day, every period, and for each one either the reason it is blocked or
 * the list of rooms that would actually work. The admin picks from what is
 * offered and cannot pick something that fails.
 *
 * WHY IT REPORTS REASONS RATHER THAN JUST FILTERING
 * -------------------------------------------------
 * A grid of silently-missing options is unusable when it comes back empty -
 * "there is nowhere to put this" is the moment the timetabler most needs to
 * know *why*, because the fix is upstream (a bigger room, a different teacher,
 * a shorter class list) and nothing in a filtered list points at it. Every
 * exclusion here carries the reason and, where one exists, the thing that
 * caused it.
 *
 * WHERE THE GUARANTEE ACTUALLY LIVES
 * ----------------------------------
 * Not here. The three unique indexes on `timetables` are what make
 * double-booking impossible, and they hold whether or not this module is
 * involved. This exists so the admin sees the constraint before hitting it,
 * and so the error names what clashed. A check that only lives in application
 * code is a check that a future caller forgets.
 */

const { sequelize } = require("../database/connection");
const { SLOTS, findSlotByNumber } = require("../config/timetableSlots");
const { satisfiesRoomRequirement } = require("../config/roomTypes");

// The days the institute timetables. Mirrors the day_of_week ENUM, which has
// no Sunday.
const TEACHING_DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
];

/*
 * A placement the caller can fix, rather than a server fault. `statusCode` is
 * the key utils/apiError.js looks for, so these surface with their own status
 * instead of a blanket 500 - 404 for a missing offering, 409 for a clash, 422
 * for a class that is not in a state to be scheduled at all.
 */
class SchedulingError extends Error {
    constructor(message, statusCode = 409, details = null) {
        super(message);
        this.name = "SchedulingError";
        this.statusCode = statusCode;
        this.details = details;
    }
}

const query = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

// =====================================================================
// THE CLASS BEING PLACED
// =====================================================================

/*
 * Everything the engine needs about one offering, in a single round trip.
 * The database is remote, so the difference between one query and six here is
 * measured in seconds, not milliseconds.
 *
 * `class_size` is the headcount the room has to seat. It is max_seats when the
 * offering caps itself below its section - a lab bench count, say - and
 * otherwise the number of students actually in the section. Enrolment is
 * reported alongside it but is deliberately not used for the capacity test:
 * under cohort enrolment the two are the same number, and during planning the
 * enrolment rows may not exist yet, at which point sizing a room by them would
 * conclude that a nought-student class fits anywhere.
 */
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
 *
 * `enrolled_count` is filtered the same way, and has to be. An enrolment row
 * outlives the student's Active status - somebody who withdraws mid-term keeps
 * their Active enrolment until the term closes - so counting rows alone put
 * 395 over a headcount of 359 and made a fully-enrolled section look
 * over-subscribed. Both halves of the pair now count the same people, so
 * "enrolled / headcount" reaches N/N exactly when there is nobody left to
 * enrol.
 */
const loadOffering = async (offeringId) => {
    const rows = await query(
        `SELECT o.offering_id, o.term_id, o.section_id, o.subject_id,
                o.teacher_id,
                -- THE RULE: subject states it, offering may override it.
                COALESCE(o.sessions_per_week, sub.sessions_per_week) AS sessions_per_week,
                o.required_room_type,
                o.max_seats, o.status,
                sub.subject_code, sub.subject_name, sub.credit_hours,
                sec.section_name, sec.capacity AS section_capacity,
                b.batch_name, b.batch_id,
                term.term_code, term.term_name, term.status AS term_status,
                tch.employee_id AS teacher_employee_id,
                emp.first_name AS teacher_first_name,
                emp.last_name  AS teacher_last_name,
                (SELECT COUNT(*) FROM students st
                  WHERE st.section_id = o.section_id
                    AND st.is_deleted = 0
                    AND st.academic_status = 'Active') AS section_headcount,
                (SELECT COUNT(*) FROM enrollments e
                              JOIN students es ON es.student_id = e.student_id
                                              AND es.is_deleted = 0
                                              AND es.academic_status = 'Active'
                             WHERE e.offering_id = o.offering_id
                               AND e.status = 'Active') AS enrolled_count,
                (SELECT COUNT(*) FROM timetables t
                  WHERE t.offering_id = o.offering_id) AS placed_sessions
           FROM course_offerings o
           JOIN subjects       sub  ON sub.subject_id  = o.subject_id
           JOIN sections       sec  ON sec.section_id  = o.section_id
           JOIN batches        b    ON b.batch_id      = sec.batch_id
           JOIN academic_terms term ON term.term_id    = o.term_id
      LEFT JOIN teachers       tch  ON tch.teacher_id  = o.teacher_id
      LEFT JOIN employees      emp  ON emp.employee_id = tch.employee_id
          WHERE o.offering_id = :offeringId
            AND o.is_deleted = 0
          LIMIT 1`,
        { offeringId }
    );

    if (!rows.length) {
        throw new SchedulingError(`No course offering ${offeringId}.`, 404);
    }

    const offering = rows[0];

    const headcount = Number(offering.section_headcount) || 0;

    return {
        ...offering,
        section_headcount: headcount,
        enrolled_count: Number(offering.enrolled_count) || 0,
        placed_sessions: Number(offering.placed_sessions) || 0,
        sessions_remaining: Math.max(
            0,
            Number(offering.sessions_per_week) - (Number(offering.placed_sessions) || 0)
        ),
        class_size: offering.max_seats !== null && offering.max_seats !== undefined
            ? Number(offering.max_seats)
            : headcount
    };
};

// =====================================================================
// WHAT IS ALREADY BOOKED
// =====================================================================

/*
 * Every booking in the term, keyed by what it consumes.
 *
 * Read in one pass and indexed in memory rather than asked per cell: the grid
 * is 6 days x 4 periods x however many rooms, so a query per candidate would
 * be hundreds of round trips to a remote database to answer a question the
 * whole of which fits comfortably in one result set.
 *
 * Scoped to the term because that is what the uniqueness rules say since
 * 20260822094000: a room booked all of last year does not block this year.
 */
const loadTermBookings = async (termId, excludeTimetableId = null) => {
    const rows = await query(
        `SELECT t.timetable_id, t.section_id, t.teacher_id, t.classroom_id,
                t.day_of_week, t.start_time,
                sub.subject_code, sub.subject_name,
                sec.section_name,
                room.room_name, room.building,
                emp.first_name AS teacher_first_name,
                emp.last_name  AS teacher_last_name
           FROM timetables t
           JOIN subjects   sub  ON sub.subject_id    = t.subject_id
           JOIN sections   sec  ON sec.section_id    = t.section_id
           JOIN classrooms room ON room.classroom_id = t.classroom_id
      LEFT JOIN teachers  tch  ON tch.teacher_id    = t.teacher_id
      LEFT JOIN employees emp  ON emp.employee_id   = tch.employee_id
          WHERE t.term_id = :termId
            AND (:excludeId IS NULL OR t.timetable_id <> :excludeId)`,
        { termId, excludeId: excludeTimetableId }
    );

    // "Tuesday|10:00:00" - the period, which is all the unique indexes key on
    // since every row is pinned to the grid.
    const cell = (day, start) => `${day}|${start}`;

    const bySection = new Map();
    const byTeacher = new Map();
    const byRoom = new Map();

    for (const row of rows) {
        const key = cell(row.day_of_week, row.start_time);

        bySection.set(`${row.section_id}@${key}`, row);
        byRoom.set(`${row.classroom_id}@${key}`, row);

        // teacher_id is NOT NULL on timetables, but the LEFT JOIN above means
        // a row whose teacher record was deleted still arrives - guard rather
        // than index a null key that nothing will ever look up.
        if (row.teacher_id !== null) {
            byTeacher.set(`${row.teacher_id}@${key}`, row);
        }
    }

    return { cell, bySection, byTeacher, byRoom };
};

const loadRooms = async () =>
    query(
        `SELECT classroom_id, room_name, building, capacity, room_type
           FROM classrooms
          WHERE is_deleted = 0
          ORDER BY building, room_name`
    );

// How a clash reads back to the admin: what is in the way, not just that
// something is.
const describeBooking = (booking) => ({
    timetable_id: booking.timetable_id,
    subject_code: booking.subject_code,
    subject_name: booking.subject_name,
    section_name: booking.section_name,
    room: `${booking.room_name}${booking.building ? `, ${booking.building}` : ""}`,
    teacher_name: [booking.teacher_first_name, booking.teacher_last_name]
        .filter(Boolean)
        .join(" ") || null
});

// =====================================================================
// THE GRID
// =====================================================================

/*
 * Every (day, period) for one offering, each carrying either the reasons it
 * cannot be used or the rooms that would work in it.
 *
 * `excludeTimetableId` exists for moving an existing meeting: the row being
 * moved must not count as blocking its own destination, or dragging a class
 * one period sideways and back would be refused by itself.
 */
const getPlacementOptions = async (offeringId, { excludeTimetableId = null } = {}) => {
    const offering = await loadOffering(offeringId);

    if (offering.teacher_id === null) {
        throw new SchedulingError(
            `${offering.subject_code} for section ${offering.section_name} has no ` +
                "teacher assigned, so it cannot be scheduled yet. Assign a teacher " +
                "to the offering first.",
            422,
            { reason: "unstaffed" }
        );
    }

    if (offering.term_status === "Closed") {
        throw new SchedulingError(
            `${offering.term_name} is closed. Its timetable is the historical ` +
                "record of what was taught and cannot be changed.",
            422,
            { reason: "term_closed" }
        );
    }

    const [rooms, bookings, own] = await Promise.all([
        loadRooms(),
        loadTermBookings(offering.term_id, excludeTimetableId),
        /*
         * This class's own meetings.
         *
         * Without them the grid cannot tell "somebody else is in this period"
         * from "this is where this class already meets" - both arrive as a
         * section_busy blocker, because a class does indeed clash with itself.
         * The screen needs the difference: one cell offers a room to pick, the
         * other offers a period to remove.
         */
        query(
            `SELECT t.timetable_id, t.day_of_week, t.start_time,
                    t.classroom_id, room.room_name, room.building, room.room_type,
                    (SELECT COUNT(*) FROM attendance a
                      WHERE a.timetable_id = t.timetable_id) AS attendance_count
               FROM timetables t
               JOIN classrooms room ON room.classroom_id = t.classroom_id
              WHERE t.offering_id = :offeringId
                AND (:excludeId IS NULL OR t.timetable_id <> :excludeId)`,
            { offeringId, excludeId: excludeTimetableId }
        )
    ]);

    const ownByCell = new Map(
        own.map((row) => [`${row.day_of_week}|${row.start_time}`, row])
    );

    /*
     * Room eligibility splits in two, and the split matters.
     *
     * Type and capacity are properties of the room against this class: a room
     * that is too small is too small in every period, so it is excluded once
     * and the reason is reported once, rather than repeated 24 times across
     * the grid. Being booked is per-period and has to be evaluated per cell.
     */
    const roomsByFitness = rooms.map((room) => {
        const typeOk = satisfiesRoomRequirement(
            room.room_type,
            offering.required_room_type
        );

        const capacityOk = Number(room.capacity) >= offering.class_size;

        const reasons = [];

        if (!typeOk) {
            reasons.push(
                `${room.room_name} is a ${room.room_type.toLowerCase()} room; ` +
                    `this class needs a ${String(offering.required_room_type).toLowerCase()} room`
            );
        }

        if (!capacityOk) {
            reasons.push(
                `${room.room_name} seats ${room.capacity}; this class has ` +
                    `${offering.class_size}`
            );
        }

        return { room, eligible: typeOk && capacityOk, reasons };
    });

    const eligibleRooms = roomsByFitness.filter((r) => r.eligible);

    const days = TEACHING_DAYS.map((day) => ({
        day,
        slots: SLOTS.map((slot) => {
            const key = bookings.cell(day, slot.start_time);

            const sectionClash = bookings.bySection.get(`${offering.section_id}@${key}`);
            const teacherClash = bookings.byTeacher.get(`${offering.teacher_id}@${key}`);

            // The people come first: if either is busy the period is closed
            // regardless of what rooms are free, and listing rooms under it
            // would invite a click that can only fail.
            const blockers = [];

            // A clash with this class's own meeting is not a clash worth
            // reporting - it is the meeting itself.
            const ownHere = ownByCell.get(key) || null;

            if (sectionClash && !(ownHere && ownHere.timetable_id === sectionClash.timetable_id)) {
                blockers.push({
                    type: "section_busy",
                    message:
                        `Section ${offering.section_name} already has ` +
                        `${sectionClash.subject_code} this period.`,
                    conflict: describeBooking(sectionClash)
                });
            }

            if (teacherClash && !(ownHere && ownHere.timetable_id === teacherClash.timetable_id)) {
                blockers.push({
                    type: "teacher_busy",
                    message:
                        `${describeBooking(teacherClash).teacher_name || "The teacher"} ` +
                        `is teaching ${teacherClash.subject_code} to section ` +
                        `${teacherClash.section_name} this period.`,
                    conflict: describeBooking(teacherClash)
                });
            }

            const available = [];
            const occupied = [];

            /*
             * A cell this class already meets in is finished. Its rooms are not
             * computed at all: the only action it offers is "remove this
             * period", and reporting it as `available` because some *other*
             * room happens to be free would invite the admin to book the same
             * class into the same period twice - which the unique index would
             * then refuse.
             */
            if (blockers.length === 0 && !ownHere) {
                for (const { room } of eligibleRooms) {
                    const roomClash = bookings.byRoom.get(`${room.classroom_id}@${key}`);

                    if (roomClash) {
                        occupied.push({
                            ...room,
                            occupied_by: describeBooking(roomClash)
                        });
                    } else {
                        available.push(room);
                    }
                }

                if (available.length === 0) {
                    blockers.push({
                        type: "no_room",
                        message: eligibleRooms.length === 0
                            ? "No room in the estate is the right type and large " +
                              "enough for this class."
                            : "Every room that fits this class is already booked " +
                              "this period.",
                        conflict: null
                    });
                }
            }

            return {
                slot_number: slot.slot_number,
                start_time: slot.start_time,
                end_time: slot.end_time,
                /*
                 * This class already meets here. The cell is not "blocked" in
                 * any sense the admin cares about - it is done - so it is
                 * reported separately from `available` rather than folded into
                 * it, and the section_busy blocker naming this same booking is
                 * dropped below.
                 */
                own_session: ownHere
                    ? {
                          timetable_id: ownHere.timetable_id,
                          classroom_id: ownHere.classroom_id,
                          room_name: ownHere.room_name,
                          building: ownHere.building,
                          room_type: ownHere.room_type,
                          /*
                           * Whether this period can actually be taken off the
                           * grid, decided here rather than discovered by the
                           * user.
                           *
                           * `attendance.timetable_id` is ON DELETE CASCADE, so
                           * unplacing a period that has been taught would take
                           * its attendance with it. The server refuses that
                           * with a 422 - but a button that is always offered
                           * and always refused reads as broken, and on seeded
                           * data every period has attendance. The grid can now
                           * disable it and say why instead.
                           */
                          attendance_count: Number(ownHere.attendance_count) || 0,
                          can_unplace: (Number(ownHere.attendance_count) || 0) === 0
                      }
                    : null,
                // The single fact the UI colours an empty cell on. An own
                // session is never "available" - see above.
                available: blockers.length === 0 && !ownHere,
                blockers,
                available_rooms: available,
                // Surfaced rather than dropped: "the room you want is taken by
                // X" is what tells a timetabler whether to move this class or
                // that one.
                occupied_rooms: occupied
            };
        })
    }));

    const openCells = days.reduce(
        (n, d) => n + d.slots.filter((s) => s.available).length,
        0
    );

    return {
        offering: {
            offering_id: offering.offering_id,
            term_id: offering.term_id,
            term_code: offering.term_code,
            term_name: offering.term_name,
            subject_code: offering.subject_code,
            subject_name: offering.subject_name,
            section_id: offering.section_id,
            section_name: offering.section_name,
            batch_name: offering.batch_name,
            teacher_id: offering.teacher_id,
            teacher_name: [offering.teacher_first_name, offering.teacher_last_name]
                .filter(Boolean)
                .join(" ") || null,
            required_room_type: offering.required_room_type,
            class_size: offering.class_size,
            section_headcount: offering.section_headcount,
            enrolled_count: offering.enrolled_count,
            sessions_per_week: Number(offering.sessions_per_week),
            placed_sessions: offering.placed_sessions,
            sessions_remaining: offering.sessions_remaining,
            status: offering.status
        },
        /*
         * Why a room is out for this class regardless of when - reported once,
         * not once per cell. This is the list that explains an empty grid, and
         * it is the reason the engine reports exclusions instead of quietly
         * filtering them away.
         */
        excluded_rooms: roomsByFitness
            .filter((r) => !r.eligible)
            .map((r) => ({ ...r.room, reasons: r.reasons })),
        days,
        summary: {
            open_periods: openCells,
            total_periods: TEACHING_DAYS.length * SLOTS.length,
            eligible_rooms: eligibleRooms.length,
            total_rooms: rooms.length
        }
    };
};

// =====================================================================
// PLACING AND MOVING
// =====================================================================

/*
 * Writes one meeting of an offering onto the grid.
 *
 * The section, subject, teacher and term are taken from the offering and never
 * from the caller. That is the whole point of routing placement through here:
 * `timetables` still carries those columns, so a caller that supplied them
 * could put a row on the grid that disagreed with the class it belongs to -
 * which is exactly the inconsistency offerings were introduced to end.
 *
 * The pre-flight check below is for the message, not for the guarantee. Two
 * admins placing the same room in the same period at the same moment both pass
 * it and one of them then hits the unique index; that INSERT is caught and
 * reported in the same shape, so the outcome is identical either way.
 */
const placeSession = async (offeringId, { day_of_week, slot_number, classroom_id }) => {
    const slot = findSlotByNumber(slot_number);

    if (!slot) {
        throw new SchedulingError(
            `slot_number ${slot_number} is not a period. Valid periods: ` +
                SLOTS.map((s) => `${s.slot_number} (${s.start_time}-${s.end_time})`).join(", "),
            400
        );
    }

    if (!TEACHING_DAYS.includes(day_of_week)) {
        throw new SchedulingError(
            `${day_of_week} is not a teaching day. Valid days: ${TEACHING_DAYS.join(", ")}.`,
            400
        );
    }

    const options = await getPlacementOptions(offeringId);

    const day = options.days.find((d) => d.day === day_of_week);
    const cell = day.slots.find((s) => s.slot_number === Number(slot_number));

    if (!cell.available) {
        throw new SchedulingError(
            `Cannot place ${options.offering.subject_code} on ${day_of_week} ` +
                `${slot.start_time}-${slot.end_time}: ` +
                cell.blockers.map((b) => b.message).join(" "),
            409,
            { blockers: cell.blockers }
        );
    }

    const room = cell.available_rooms.find(
        (r) => Number(r.classroom_id) === Number(classroom_id)
    );

    if (!room) {
        // Distinguish "not a legal room for this class, ever" from "legal but
        // taken right now" - the fixes are completely different.
        const excluded = options.excluded_rooms.find(
            (r) => Number(r.classroom_id) === Number(classroom_id)
        );

        const taken = cell.occupied_rooms.find(
            (r) => Number(r.classroom_id) === Number(classroom_id)
        );

        if (excluded) {
            throw new SchedulingError(excluded.reasons.join("; ") + ".", 409);
        }

        if (taken) {
            throw new SchedulingError(
                `That room is booked this period by ${taken.occupied_by.subject_code} ` +
                    `(section ${taken.occupied_by.section_name}).`,
                409
            );
        }

        throw new SchedulingError(
            `Classroom ${classroom_id} is not available for this class on ` +
                `${day_of_week} ${slot.start_time}.`,
            409
        );
    }

    const offering = await loadOffering(offeringId);

    try {
        const [timetableId] = await sequelize.query(
            `INSERT INTO timetables
                  (offering_id, term_id, subject_id, section_id, teacher_id,
                   classroom_id, day_of_week, start_time, end_time)
             VALUES (:offeringId, :termId, :subjectId, :sectionId, :teacherId,
                     :classroomId, :day, :startTime, :endTime)`,
            {
                replacements: {
                    offeringId,
                    termId: offering.term_id,
                    subjectId: offering.subject_id,
                    sectionId: offering.section_id,
                    teacherId: offering.teacher_id,
                    classroomId: classroom_id,
                    day: day_of_week,
                    startTime: slot.start_time,
                    endTime: slot.end_time
                },
                type: sequelize.QueryTypes.INSERT
            }
        );

        await syncOfferingStatus(offeringId);

        return {
            timetable_id: timetableId,
            offering_id: Number(offeringId),
            day_of_week,
            slot_number: slot.slot_number,
            start_time: slot.start_time,
            end_time: slot.end_time,
            classroom_id: Number(classroom_id),
            room_name: room.room_name,
            building: room.building
        };
    } catch (error) {
        // The race described above. The indexes are named for exactly this, so
        // the message can still say which resource lost.
        if (error?.original?.code === "ER_DUP_ENTRY") {
            const name = String(error.original.sqlMessage || "");

            const what = name.includes("classroom")
                ? "that room was booked"
                : name.includes("teacher")
                    ? "the teacher was booked"
                    : "the section was booked";

            throw new SchedulingError(
                `${day_of_week} ${slot.start_time} is no longer free - ${what} ` +
                    "while you were choosing. Reload the grid and try again.",
                409
            );
        }

        throw error;
    }
};

/*
 * Removes one meeting. The class itself survives - an offering with no
 * meetings is a class that is not on the grid yet, which is a normal state and
 * how every offering starts.
 */
const unplaceSession = async (timetableId) => {
    const rows = await query(
        `SELECT t.timetable_id, t.offering_id, t.day_of_week, t.start_time,
                term.status AS term_status, term.term_name
           FROM timetables t
      LEFT JOIN academic_terms term ON term.term_id = t.term_id
          WHERE t.timetable_id = :timetableId
          LIMIT 1`,
        { timetableId }
    );

    if (!rows.length) {
        throw new SchedulingError(`No timetable entry ${timetableId}.`, 404);
    }

    const row = rows[0];

    if (row.term_status === "Closed") {
        throw new SchedulingError(
            `${row.term_name} is closed and its timetable cannot be changed.`,
            422
        );
    }

    /*
     * Attendance references timetable_id, and the FK cascades. Deleting a
     * meeting that has been taught would take its attendance with it, so this
     * refuses instead - the record of who was in the room outlives the
     * scheduling decision that put them there.
     */
    const [attendance] = await query(
        "SELECT COUNT(*) AS n FROM attendance WHERE timetable_id = :timetableId",
        { timetableId }
    );

    if (Number(attendance.n) > 0) {
        throw new SchedulingError(
            `This period has ${attendance.n} attendance record(s) against it and ` +
                "cannot be removed. Cancel the offering instead, which keeps both " +
                "the timetable and the attendance intact.",
            422,
            { attendance_rows: Number(attendance.n) }
        );
    }

    await sequelize.query(
        "DELETE FROM timetables WHERE timetable_id = :timetableId",
        { replacements: { timetableId }, type: sequelize.QueryTypes.DELETE }
    );

    if (row.offering_id) {
        await syncOfferingStatus(row.offering_id);
    }

    return { timetable_id: Number(timetableId), offering_id: row.offering_id };
};

/*
 * Moving a meeting is an unplace and a place, but it must not be those two
 * things separately: dropping the row first would free the slot and then fail
 * to find a destination, leaving a class less scheduled than it started. So
 * the destination is validated with the row excluded from the conflict set -
 * that is what `excludeTimetableId` is for - and only then is the row updated
 * in place.
 */
const moveSession = async (timetableId, { day_of_week, slot_number, classroom_id }) => {
    const rows = await query(
        `SELECT offering_id FROM timetables WHERE timetable_id = :timetableId LIMIT 1`,
        { timetableId }
    );

    if (!rows.length) {
        throw new SchedulingError(`No timetable entry ${timetableId}.`, 404);
    }

    const offeringId = rows[0].offering_id;

    if (!offeringId) {
        throw new SchedulingError(
            `Timetable entry ${timetableId} is not linked to a course offering, ` +
                "so it cannot be moved through the scheduler. Link or recreate it first.",
            422
        );
    }

    const slot = findSlotByNumber(slot_number);

    if (!slot) {
        throw new SchedulingError(`slot_number ${slot_number} is not a period.`, 400);
    }

    const options = await getPlacementOptions(offeringId, {
        excludeTimetableId: timetableId
    });

    const day = options.days.find((d) => d.day === day_of_week);

    if (!day) {
        throw new SchedulingError(`${day_of_week} is not a teaching day.`, 400);
    }

    const cell = day.slots.find((s) => s.slot_number === Number(slot_number));

    if (!cell.available) {
        throw new SchedulingError(
            `Cannot move to ${day_of_week} ${slot.start_time}: ` +
                cell.blockers.map((b) => b.message).join(" "),
            409,
            { blockers: cell.blockers }
        );
    }

    if (!cell.available_rooms.some((r) => Number(r.classroom_id) === Number(classroom_id))) {
        throw new SchedulingError(
            `That room is not available for this class on ${day_of_week} ` +
                `${slot.start_time}.`,
            409
        );
    }

    await sequelize.query(
        `UPDATE timetables
            SET day_of_week = :day,
                start_time  = :startTime,
                end_time    = :endTime,
                classroom_id = :classroomId
          WHERE timetable_id = :timetableId`,
        {
            replacements: {
                day: day_of_week,
                startTime: slot.start_time,
                endTime: slot.end_time,
                classroomId: classroom_id,
                timetableId
            },
            type: sequelize.QueryTypes.UPDATE
        }
    );

    return {
        timetable_id: Number(timetableId),
        offering_id: offeringId,
        day_of_week,
        slot_number: slot.slot_number,
        start_time: slot.start_time,
        end_time: slot.end_time,
        classroom_id: Number(classroom_id)
    };
};

// =====================================================================
// STATUS
// =====================================================================

/*
 * Keeps `course_offerings.status` honest about whether the class is on the
 * grid, so "what is left to schedule" is a column rather than a count somebody
 * has to recompute.
 *
 * Only Draft <-> Scheduled are managed here. Active, Completed and Cancelled
 * are decisions about the class, not about its placement, and must not be
 * undone by someone moving a period around.
 */
const syncOfferingStatus = async (offeringId) => {
    await sequelize.query(
        `UPDATE course_offerings o
            JOIN subjects sub ON sub.subject_id = o.subject_id
            SET o.status = CASE
                WHEN (SELECT COUNT(*) FROM timetables t
                       WHERE t.offering_id = o.offering_id)
                     >= COALESCE(o.sessions_per_week, sub.sessions_per_week)
                THEN 'Scheduled'
                ELSE 'Draft'
            END
          WHERE o.offering_id = :offeringId
            AND o.status IN ('Draft', 'Scheduled')`,
        { replacements: { offeringId }, type: sequelize.QueryTypes.UPDATE }
    );
};

/*
 * The admin's worklist for a term: every class, how much of it is on the grid,
 * and what is stopping the rest. Sorted so the classes that need attention
 * come first - unstaffed, then partly placed, then done - because a list
 * sorted by id makes the timetabler find the work themselves.
 */
const getTermSchedulingStatus = async (termId) => {
    const rows = await query(
        `SELECT o.offering_id, o.status, o.teacher_id,
                COALESCE(o.sessions_per_week, sub.sessions_per_week) AS sessions_per_week,
                o.required_room_type, o.max_seats,
                sub.subject_code, sub.subject_name,
                sec.section_id, sec.section_name,
                b.batch_name,
                p.program_name,
                sem.semester_number,
                emp.first_name AS teacher_first_name,
                emp.last_name  AS teacher_last_name,
                (SELECT COUNT(*) FROM timetables t
                  WHERE t.offering_id = o.offering_id) AS placed_sessions,
                (SELECT COUNT(*) FROM students st
                  WHERE st.section_id = o.section_id
                    AND st.is_deleted = 0
                    AND st.academic_status = 'Active') AS section_headcount,
                (SELECT COUNT(*) FROM enrollments e
                              JOIN students es ON es.student_id = e.student_id
                                              AND es.is_deleted = 0
                                              AND es.academic_status = 'Active'
                             WHERE e.offering_id = o.offering_id
                               AND e.status = 'Active') AS enrolled_count
           FROM course_offerings o
           JOIN subjects  sub ON sub.subject_id = o.subject_id
           JOIN sections  sec ON sec.section_id = o.section_id
           JOIN batches   b   ON b.batch_id     = sec.batch_id
           JOIN programs  p   ON p.program_id   = b.program_id
           JOIN semesters sem ON sem.semester_id = sub.semester_id
      LEFT JOIN teachers  tch ON tch.teacher_id  = o.teacher_id
      LEFT JOIN employees emp ON emp.employee_id = tch.employee_id
          WHERE o.term_id = :termId
            AND o.is_deleted = 0
          ORDER BY p.program_name, b.batch_name, sec.section_name, sub.subject_code`,
        { termId }
    );

    const offerings = rows.map((row) => {
        const placed = Number(row.placed_sessions) || 0;
        const required = Number(row.sessions_per_week) || 0;

        return {
            offering_id: row.offering_id,
            subject_code: row.subject_code,
            subject_name: row.subject_name,
            section_id: row.section_id,
            section_name: row.section_name,
            batch_name: row.batch_name,
            program_name: row.program_name,
            semester_number: Number(row.semester_number),
            teacher_id: row.teacher_id,
            teacher_name: [row.teacher_first_name, row.teacher_last_name]
                .filter(Boolean)
                .join(" ") || null,
            required_room_type: row.required_room_type,
            section_headcount: Number(row.section_headcount) || 0,
            enrolled_count: Number(row.enrolled_count) || 0,
            sessions_per_week: required,
            placed_sessions: placed,
            sessions_remaining: Math.max(0, required - placed),
            status: row.status,
            /*
             * One word for what the timetabler has to do next. Being over-placed
             * is called out rather than treated as done: it means the required
             * session count was lowered after the grid was built, and the extra
             * period is still being taught.
             */
            scheduling_state: row.teacher_id === null
                ? "unstaffed"
                : placed === 0
                    ? "unscheduled"
                    : placed < required
                        ? "partial"
                        : placed > required
                            ? "over_scheduled"
                            : "complete"
        };
    });

    const ORDER = {
        unstaffed: 0,
        unscheduled: 1,
        partial: 2,
        over_scheduled: 3,
        complete: 4
    };

    offerings.sort((a, b) => ORDER[a.scheduling_state] - ORDER[b.scheduling_state]);

    const tally = (state) => offerings.filter((o) => o.scheduling_state === state).length;

    return {
        term_id: Number(termId),
        offerings,
        summary: {
            total: offerings.length,
            unstaffed: tally("unstaffed"),
            unscheduled: tally("unscheduled"),
            partial: tally("partial"),
            over_scheduled: tally("over_scheduled"),
            complete: tally("complete"),
            sessions_required: offerings.reduce((n, o) => n + o.sessions_per_week, 0),
            sessions_placed: offerings.reduce((n, o) => n + o.placed_sessions, 0)
        }
    };
};

/*
 * The estate's week: every room against every period, and what is in it.
 *
 * This is the view that answers "is 401 free on Wednesday afternoon" without
 * the admin opening a class first, and the one that shows which rooms are
 * standing empty while the timetabler fights over the others.
 */
const getRoomOccupancy = async (termId, { classroomId = null } = {}) => {
    const [rooms, bookings] = await Promise.all([
        classroomId
            ? query(
                  `SELECT classroom_id, room_name, building, capacity, room_type
                     FROM classrooms
                    WHERE is_deleted = 0 AND classroom_id = :classroomId`,
                  { classroomId }
              )
            : loadRooms(),
        loadTermBookings(termId)
    ]);

    const totalPeriods = TEACHING_DAYS.length * SLOTS.length;

    const grid = rooms.map((room) => {
        let used = 0;

        const days = TEACHING_DAYS.map((day) => ({
            day,
            slots: SLOTS.map((slot) => {
                const booking = bookings.byRoom.get(
                    `${room.classroom_id}@${bookings.cell(day, slot.start_time)}`
                );

                if (booking) used += 1;

                return {
                    slot_number: slot.slot_number,
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                    booking: booking ? describeBooking(booking) : null
                };
            })
        }));

        return {
            ...room,
            days,
            periods_used: used,
            periods_free: totalPeriods - used,
            // Rounded to a whole percent: the figure is read, not calculated
            // with, and a utilisation of 41.66666666666667% helps nobody.
            utilisation_percent: Math.round((used / totalPeriods) * 100)
        };
    });

    return {
        term_id: Number(termId),
        periods_per_week: totalPeriods,
        rooms: grid,
        summary: {
            rooms: grid.length,
            periods_used: grid.reduce((n, r) => n + r.periods_used, 0),
            periods_available: grid.length * totalPeriods
        }
    };
};

module.exports = {
    getPlacementOptions,
    placeSession,
    moveSession,
    unplaceSession,
    getTermSchedulingStatus,
    getRoomOccupancy,
    syncOfferingStatus,
    SchedulingError,
    TEACHING_DAYS
};
