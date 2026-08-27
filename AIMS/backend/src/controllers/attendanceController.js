const { validationResult } = require("express-validator");
const { Op } = require("sequelize");
const Attendance = require("../models/attendance.model");
const Student = require("../models/student.model");
const audit = require("../services/auditService");
const notify = require("../services/notificationService");
const { sequelize } = require("../database/connection");
const Subject = require("../models/subject.model");

/*
 * Attendance decides who is eligible to sit an exam at the 75% threshold, so an
 * amended record is a consequential act — and the row itself keeps only the
 * final value. Each entry therefore carries the student's NAME as well as their
 * id: a trail that says "attendance#41207 changed" answers nothing.
 */
const attendanceSnapshot = (attendance, student) => ({
    attendanceId: attendance.attendance_id,
    studentId: attendance.student_id,
    studentName: student
        ? [student.first_name, student.last_name].filter(Boolean).join(" ")
        : null,
    registrationNumber: student ? student.registration_number : null,
    subjectId: attendance.subject_id,
    timetableId: attendance.timetable_id,
    date: attendance.att_date,
    status: attendance.status,
    markedBy: attendance.marked_by
});

// Never fails the act it is describing — a missing student leaves the name out.
const studentFor = (studentId) => Student.findByPk(studentId).catch(() => null);

/*
 * The eligibility threshold. 75% is not a display convention — it is the rule
 * that decides who may sit the exam, and it is already applied in the reporting
 * views and the faculty portal.
 */
const THRESHOLD = 75;

/*
 * Tells a student and their guardians that a session was missed, and — the part
 * that actually matters — whether it has taken them below the exam-eligibility
 * threshold in that subject.
 *
 * WHY ONE NOTIFICATION AND NOT TWO
 * --------------------------------
 * Being marked absent and dropping below 75% are the same event from the
 * family's point of view; sending both would mean the important one arrives
 * underneath a routine one. So the threshold decides the WORDING and the
 * priority of a single notice rather than adding a second.
 *
 * WHY ONLY ON ABSENCE
 * -------------------
 * A register is filed for every student in the room every session. Emitting on
 * Present would put four notifications a day into the feed of a student who has
 * done nothing wrong, and a feed that is mostly noise stops being read — which
 * would cost the fee and result notices their audience too.
 *
 * Never throws: attendance must be markable when the notifications table is not
 * cooperating.
 */
const notifyAbsence = async ({ studentId, subjectId, date, actorUserId }) => {
    try {
        if (!studentId || !subjectId) return;

        const [tally] = await sequelize.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) AS attended
               FROM attendance
              WHERE student_id = :studentId
                AND subject_id = :subjectId
                AND status <> 'Holiday'`,
            { type: sequelize.QueryTypes.SELECT, replacements: { studentId, subjectId } }
        );

        const subject = await Subject.findByPk(subjectId).catch(() => null);
        const subjectName = subject?.subject_name || "one of your subjects";

        const total = Number(tally?.total || 0);
        const attended = Number(tally?.attended || 0);
        const percentage = total ? Math.round((attended / total) * 100) : null;

        const below = percentage !== null && percentage < THRESHOLD;

        const when = date
            ? new Date(date).toLocaleDateString("en-PK", { day: "numeric", month: "long" })
            : null;

        await notify.notifyStudent({
            studentId,
            type: notify.TYPES.ATTENDANCE,
            priority: below ? notify.PRIORITY.HIGH : notify.PRIORITY.NORMAL,
            subject: "attendance",
            actorUserId,
            title: below ? "Attendance below 75%" : "Marked absent",
            ownMessage: below
                ? `Your attendance in ${subjectName} is now ${percentage}%, below the `
                    + `${THRESHOLD}% required to sit the exam.`
                : `You were marked absent in ${subjectName}${when ? ` on ${when}` : ""}.`,
            guardianMessage: (role, who) => (below
                ? `${who}'s attendance in ${subjectName} is now ${percentage}%, below the `
                    + `${THRESHOLD}% required to sit the exam.`
                : `${who} was marked absent in ${subjectName}${when ? ` on ${when}` : ""}.`)
        });

    } catch (error) {
        console.error("[notify] absence notice failed:", error.message);
    }
};


/*
 * A register entry belongs to a TIMETABLE SLOT, and the slot has to agree with
 * everything else on the row.
 *
 * `attendance.timetable_id` has been a NOT NULL foreign key from the start,
 * and `uq_attendance_once (student_id, timetable_id, att_date)` says plainly
 * that a student has one entry per slot per day. The FK guaranteed the slot
 * EXISTS; nothing checked that it was the right one. So this endpoint would
 * accept, and write:
 *
 *   - a Monday 08:30 slot with an `att_date` that is a Thursday — a lecture
 *     recorded on a day the class does not meet;
 *   - `subject_id` CS-101 against a slot that teaches CS-102 — attendance
 *     credited to the wrong course, which then feeds the wrong 75% denominator
 *     and the wrong exam-eligibility decision;
 *   - a student who is not in the slot's section at all.
 *
 * None of these is exotic: `subject_id`, `timetable_id` and `att_date` all
 * arrive from the client as independent numbers, and only their agreement
 * makes the row mean anything.
 *
 * Returns a message when the row is incoherent, or null when it is fine.
 */
const SLOT_DAYS = [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday"
];

const slotObjection = async ({ timetableId, subjectId, attDate, student }) => {

    const [slot] = await sequelize.query(
        `SELECT t.timetable_id, t.subject_id, t.section_id,
                t.day_of_week, t.start_time, t.end_time,
                s.subject_code
           FROM timetables t
           JOIN subjects s ON s.subject_id = t.subject_id
          WHERE t.timetable_id = :timetableId
          LIMIT 1`,
        { type: sequelize.QueryTypes.SELECT, replacements: { timetableId } }
    );

    if (!slot) return "That timetable slot does not exist.";

    // The weekday the date actually falls on, read in UTC to match how
    // `att_date` is stored — a DATE column with no zone.
    const parsed = new Date(`${String(attDate).slice(0, 10)}T00:00:00Z`);

    if (Number.isNaN(parsed.getTime())) {
        return "att_date must be a valid date (YYYY-MM-DD).";
    }

    const weekday = SLOT_DAYS[parsed.getUTCDay()];

    if (slot.day_of_week !== weekday) {
        return `That period meets on ${slot.day_of_week}, but `
            + `${String(attDate).slice(0, 10)} is a ${weekday}.`;
    }

    if (Number(slot.subject_id) !== Number(subjectId)) {
        return `That period teaches ${slot.subject_code}, not the subject given.`;
    }

    if (student && Number(student.section_id) !== Number(slot.section_id)) {
        return "That student is not in the section this period is timetabled for.";
    }

    return null;
};

// ================= MARK ATTENDANCE =================

const markAttendance = async (req, res) => {

    try {

        const errors = validationResult(req);

        if (!errors.isEmpty()) {

            return res.status(400).json({
                success: false,
                errors: errors.array()
            });

        }

        const {
            student_id,
            subject_id,
            timetable_id,
            att_date,
            status,
            marked_by
        } = req.body;

        const student = await Student.findOne({

            where: {
                student_id,
                is_deleted: false
            }

        });

        if (!student) {

            return res.status(404).json({

                success: false,
                message: "Student not found."

            });

        }

        /*
         * The slot has to agree with the date, the subject and the student's
         * section. Checked before the duplicate test so an incoherent row is
         * rejected on its own terms rather than as a conflict.
         */
        const objection = await slotObjection({
            timetableId: timetable_id,
            subjectId: subject_id,
            attDate: att_date,
            student
        });

        if (objection) {

            return res.status(400).json({

                success: false,
                message: objection

            });

        }

        // Check duplicate attendance
        const existingAttendance = await Attendance.findOne({

            where: {
                student_id,
                timetable_id,
                att_date
            }

        });

        if (existingAttendance) {

            return res.status(409).json({

                success: false,
                message: "Attendance already marked for this student."

            });

        }

        const attendance = await Attendance.create({

            student_id,
            subject_id,
            timetable_id,
            att_date,
            status,
            marked_by

        });

        // `student` is already loaded above, so this adds no query.
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ATTENDANCE_MARKED,
            module: audit.MODULES.ATTENDANCE,
            entity: `attendance#${attendance.attendance_id}`,
            after: attendanceSnapshot(attendance, student),
            req
        });

        if (attendance.status === "Absent") {
            await notifyAbsence({
                studentId: attendance.student_id,
                subjectId: attendance.subject_id,
                date: attendance.att_date,
                actorUserId: req.user?.user_id
            });
        }

        return res.status(201).json({

            success: true,
            message: "Attendance Marked Successfully",
            attendance

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= GET ALL ATTENDANCE =================

const getAttendance = async (req, res) => {

    try {

        const {
            student_id,
            subject_id,
            timetable_id,
            status,
            att_date,
            date_from,
            date_to,
            page,
            limit
        } = req.query;

        const where = {};

        if (student_id) where.student_id = student_id;
        if (subject_id) where.subject_id = subject_id;
        if (timetable_id) where.timetable_id = timetable_id;
        if (status) where.status = status;

        // A single day wins over a range when both are supplied.
        if (att_date) {
            where.att_date = att_date;
        } else if (date_from || date_to) {
            where.att_date = {};
            if (date_from) where.att_date[Op.gte] = date_from;
            if (date_to) where.att_date[Op.lte] = date_to;
        }

        // Pagination is applied only when asked for, so existing callers that
        // expect the full list keep working unchanged.
        const query = {
            where,
            order: [["att_date", "DESC"]]
        };

        const pageNum = Number.parseInt(page, 10);
        const limitNum = Number.parseInt(limit, 10);

        if (Number.isInteger(limitNum) && limitNum > 0) {
            query.limit = limitNum;
            query.offset = Number.isInteger(pageNum) && pageNum > 1
                ? (pageNum - 1) * limitNum
                : 0;
        }

        const { count: total, rows: attendance } =
            await Attendance.findAndCountAll(query);

        return res.status(200).json({

            success: true,
            count: attendance.length,
            total,
            page: query.limit
                ? (Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1)
                : undefined,
            limit: query.limit,
            attendance

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= GET ATTENDANCE BY ID =================

const getAttendanceById = async (req, res) => {

    try {

        const { id } = req.params;

        const attendance = await Attendance.findByPk(id);

        if (!attendance) {

            return res.status(404).json({

                success: false,
                message: "Attendance record not found."

            });

        }

        return res.status(200).json({

            success: true,
            attendance

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= GET STUDENT ATTENDANCE =================

const getStudentAttendance = async (req, res) => {

    try {

        const { id } = req.params;

        /*
         * The PERIOD, not just the date.
         *
         * This returned the bare `attendance` rows: a date, a status and a
         * `timetable_id` the reader had no way to resolve. So a student
         * looking at their own record saw "6 Sep — Absent" twice over with
         * nothing to distinguish the two, on a day their class genuinely meets
         * twice. The slot is the thing that makes the row specific, and it was
         * one join away the whole time.
         *
         * Raw SQL rather than an include: no Attendance -> Timetable
         * association is declared in the models, and adding one would change
         * the shape of every other query that includes Attendance. The
         * timetable columns are lifted to the top level so the existing
         * response shape is a strict subset of this one — nothing that reads
         * `att_date` or `status` today needs to change.
         */
        const attendance = await sequelize.query(
            `SELECT a.attendance_id,
                    a.student_id,
                    a.subject_id,
                    a.timetable_id,
                    a.att_date,
                    a.status,
                    a.marked_by,
                    a.created_at,
                    sub.subject_code,
                    sub.subject_name,
                    t.day_of_week,
                    t.start_time,
                    t.end_time,
                    t.classroom_id,
                    cr.room_name
               FROM attendance a
          LEFT JOIN timetables t ON t.timetable_id = a.timetable_id
          LEFT JOIN subjects sub ON sub.subject_id = a.subject_id
          LEFT JOIN classrooms cr ON cr.classroom_id = t.classroom_id
              WHERE a.student_id = :studentId
              ORDER BY a.att_date DESC, t.start_time ASC`,
            { type: sequelize.QueryTypes.SELECT, replacements: { studentId: id } }
        );

        return res.status(200).json({

            success: true,
            attendance

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= UPDATE ATTENDANCE =================

const updateAttendance = async (req, res) => {

    try {

        const { id } = req.params;

        const attendance = await Attendance.findByPk(id);

        if (!attendance) {

            return res.status(404).json({

                success: false,
                message: "Attendance record not found."

            });

        }

        const { status } = req.body;

        const student = await studentFor(attendance.student_id);

        // "Absent became Present" is the fact worth keeping; the row after the
        // save can only say "Present".
        const before = attendanceSnapshot(attendance, student);

        attendance.status = status;

        await attendance.save();

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ATTENDANCE_UPDATED,
            module: audit.MODULES.ATTENDANCE,
            entity: `attendance#${attendance.attendance_id}`,
            before,
            after: attendanceSnapshot(attendance, student),
            req
        });

        /*
         * An amendment is worth a notice in both directions, and only when the
         * status actually moved — re-saving Present as Present is not news.
         *
         * A correction that CLEARS an absence is the one families chase the
         * office about, so it is emitted rather than left silent; it is the only
         * way they learn the dispute went their way without ringing up.
         */
        if (before.status !== attendance.status) {
            if (attendance.status === "Absent") {
                await notifyAbsence({
                    studentId: attendance.student_id,
                    subjectId: attendance.subject_id,
                    date: attendance.att_date,
                    actorUserId: req.user?.user_id
                });
            } else if (before.status === "Absent") {
                const subject = await Subject.findByPk(attendance.subject_id).catch(() => null);
                const subjectName = subject?.subject_name || "one of your subjects";

                await notify.notifyStudent({
                    studentId: attendance.student_id,
                    type: notify.TYPES.ATTENDANCE,
                    subject: "attendance",
                    actorUserId: req.user?.user_id,
                    title: "Attendance corrected",
                    ownMessage: `An absence in ${subjectName} has been amended to `
                        + `${attendance.status}.`,
                    guardianMessage: (role, who) =>
                        `An absence for ${who} in ${subjectName} has been amended to `
                        + `${attendance.status}.`
                });
            }
        }

        return res.status(200).json({

            success: true,
            message: "Attendance Updated Successfully",
            attendance

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= DELETE ATTENDANCE =================

const deleteAttendance = async (req, res) => {

    try {

        const { id } = req.params;

        const attendance = await Attendance.findByPk(id);

        if (!attendance) {

            return res.status(404).json({

                success: false,
                message: "Attendance record not found."

            });

        }

        // Hard delete — the audit entry becomes the only record that the
        // session was ever marked, which is what makes deleting one auditable
        // at all.
        const before = attendanceSnapshot(
            attendance,
            await studentFor(attendance.student_id)
        );

        await attendance.destroy();

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ATTENDANCE_DELETED,
            module: audit.MODULES.ATTENDANCE,
            entity: `attendance#${id}`,
            before,
            req
        });

        return res.status(200).json({

            success: true,
            message: "Attendance deleted successfully."

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= ATTENDANCE PERCENTAGE =================

const getAttendancePercentage = async (req, res) => {

    try {

        const { id } = req.params;

        const totalClasses = await Attendance.count({

            where: {
                student_id: id
            }

        });

        const presentClasses = await Attendance.count({

            where: {
                student_id: id,
                status: "Present"
            }

        });

        const percentage = totalClasses === 0
            ? 0
            : ((presentClasses / totalClasses) * 100).toFixed(2);

        return res.status(200).json({

            success: true,

            totalClasses,

            presentClasses,

            attendancePercentage: percentage + "%"

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= ATTENDANCE REPORT =================

const getAttendanceReport = async (req, res) => {

    try {

        const { student_id } = req.params;

        const totalClasses = await Attendance.count({

            where: {
                student_id
            }

        });

        const present = await Attendance.count({

            where: {
                student_id,
                status: "Present"
            }

        });

        const absent = await Attendance.count({

            where: {
                student_id,
                status: "Absent"
            }

        });

        const late = await Attendance.count({

            where: {
                student_id,
                status: "Late"
            }

        });

        const leave = await Attendance.count({

            where: {
                student_id,
                status: "Leave"
            }

        });

        const holiday = await Attendance.count({

            where: {
                student_id,
                status: "Holiday"
            }

        });

        const percentage = totalClasses === 0
            ? 0
            : ((present / totalClasses) * 100).toFixed(2);

        return res.status(200).json({

            success: true,

            student_id,

            report: {

                total_classes: totalClasses,

                present,

                absent,

                late,

                leave,

                holiday,

                attendance_percentage: percentage + "%"

            }

        });

    }

    catch (error) {

        return res.status(500).json({

            success: false,

            message: error.message

        });

    }

};

module.exports = {

    markAttendance,
    getAttendance,
    getAttendanceById,
    getStudentAttendance,
    updateAttendance,
    deleteAttendance,
    getAttendancePercentage,
    getAttendanceReport

};
