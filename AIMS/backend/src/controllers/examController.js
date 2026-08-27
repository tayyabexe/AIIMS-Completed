const { validationResult } = require("express-validator");
const Exam = require("../models/exam.model");
const audit = require("../services/auditService");
const notify = require("../services/notificationService");
const Subject = require("../models/subject.model");

/*
 * An exam is the one event in the system that is addressed to a CLASS rather
 * than a person, so its audience is resolved from the enrolment table — every
 * student actively taking the subject, plus their guardians. Scheduling one and
 * then moving it are both emitted; a date that moved after people had already
 * written it down is arguably the more important of the two.
 *
 * Never throws, for the same reason auditService doesn't: an exam must remain
 * schedulable when the notifications table is not cooperating.
 */
const notifyExamClass = async ({ exam, req, title, wording, priority }) => {
    try {
        if (!exam?.subject_id) return;

        const subject = await Subject.findByPk(exam.subject_id).catch(() => null);
        const subjectName = subject?.subject_name || "your subject";

        const when = exam.exam_date
            ? new Date(exam.exam_date).toLocaleDateString("en-PK", {
                weekday: "long", day: "numeric", month: "long", year: "numeric"
            })
            : null;

        await notify.emit({
            audience: await notify.subjectAudience(exam.subject_id, exam.semester_id),
            type: notify.TYPES.EXAM,
            priority: priority || notify.PRIORITY.NORMAL,
            subject: "exams",
            actorUserId: req.user?.user_id,
            title,
            message: wording({ subjectName, when, examName: exam.exam_name })
        });

    } catch (error) {
        console.error("[notify] exam notice failed:", error.message);
    }
};

/*
 * `exam_name` is what a person recognises an exam by, so it is carried into
 * every entry — an audit line reading "Exam updated: exams#41" is a row nobody
 * can act on without opening the database themselves.
 */
const examSnapshot = (exam) => (exam ? {
    examId: exam.exam_id,
    examTitle: exam.exam_name,
    examType: exam.exam_type,
    subjectId: exam.subject_id,
    semesterId: exam.semester_id,
    examDate: exam.exam_date,
    totalMarks: exam.total_marks
} : null);

// ================= CREATE EXAM =================

const createExam = async (req, res) => {

    try {

        const errors = validationResult(req);

        if (!errors.isEmpty()) {

            return res.status(400).json({
                success: false,
                errors: errors.array()
            });

        }

        const {
            exam_name,
            exam_type,
            semester_id,
            subject_id,
            exam_date,
            total_marks,
            classroom_id,
            invigilator_id
        } = req.body;

        const exam = await Exam.create({

            exam_name,
            exam_type,
            semester_id,
            subject_id,
            exam_date,
            total_marks,
            classroom_id,
            invigilator_id

        });

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.EXAM_CREATED,
            module: audit.MODULES.EXAMS,
            entity: `exams#${exam.exam_id}`,
            after: examSnapshot(exam),
            req
        });

        await notifyExamClass({
            exam,
            req,
            title: "Exam scheduled",
            wording: ({ subjectName, when, examName }) =>
                `${examName || "An exam"} for ${subjectName} `
                + `${when ? `is scheduled for ${when}` : "has been scheduled"}.`
        });

        return res.status(201).json({

            success: true,
            message: "Exam created successfully.",
            exam

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= GET ALL EXAMS =================

const getAllExams = async (req, res) => {

    try {

        const exams = await Exam.findAll({

            order: [["exam_date", "DESC"]]

        });

        return res.status(200).json({

            success: true,
            count: exams.length,
            exams

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= GET EXAM BY ID =================

const getExamById = async (req, res) => {

    try {

        const { id } = req.params;

        const exam = await Exam.findByPk(id);

        if (!exam) {

            return res.status(404).json({

                success: false,
                message: "Exam not found."

            });

        }

        return res.status(200).json({

            success: true,
            exam

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= UPDATE EXAM =================

const updateExam = async (req, res) => {

    try {

        const { id } = req.params;

        const exam = await Exam.findByPk(id);

        if (!exam) {

            return res.status(404).json({

                success: false,
                message: "Exam not found."

            });

        }

        // Taken before update() mutates the instance in place.
        const before = examSnapshot(exam);

        await exam.update(req.body);

        /*
         * Moving an exam's date or its total marks changes what every mark
         * already entered against it means, so this is recorded even though the
         * marks themselves are audited separately.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.EXAM_UPDATED,
            module: audit.MODULES.EXAMS,
            entity: `exams#${exam.exam_id}`,
            before,
            after: examSnapshot(exam),
            req
        });

        /*
         * Only a moved date or a changed paper total is emitted. Renaming an
         * exam or correcting its type changes nothing a student has to act on,
         * and every such edit would otherwise reach the whole class.
         *
         * High priority: this contradicts something people have already written
         * in a diary.
         */
        const dateMoved = String(before.examDate) !== String(exam.exam_date);
        const marksChanged = Number(before.totalMarks) !== Number(exam.total_marks);

        if (dateMoved || marksChanged) {
            await notifyExamClass({
                exam,
                req,
                priority: notify.PRIORITY.HIGH,
                title: dateMoved ? "Exam rescheduled" : "Exam updated",
                wording: ({ subjectName, when, examName }) => (dateMoved
                    ? `${examName || "An exam"} for ${subjectName} has moved`
                        + `${when ? ` to ${when}` : ""}.`
                    : `${examName || "An exam"} for ${subjectName} is now out of `
                        + `${exam.total_marks} marks.`)
            });
        }

        return res.status(200).json({

            success: true,
            message: "Exam updated successfully.",
            exam

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= DELETE EXAM =================

const deleteExam = async (req, res) => {

    try {

        const { id } = req.params;

        const exam = await Exam.findByPk(id);

        if (!exam) {

            return res.status(404).json({

                success: false,
                message: "Exam not found."

            });

        }

        // A hard delete: after this call the exam row is gone and the audit
        // entry is all that says it existed.
        const before = examSnapshot(exam);

        await exam.destroy();

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.EXAM_DELETED,
            module: audit.MODULES.EXAMS,
            entity: `exams#${id}`,
            before,
            req
        });

        /*
         * The destroyed instance still carries its values in memory, which is
         * what the audience query needs — and `enrollments` is untouched by
         * deleting an exam, so the class is still resolvable.
         *
         * High priority: turning up to a cancelled exam is the failure mode.
         */
        await notifyExamClass({
            exam,
            req,
            priority: notify.PRIORITY.HIGH,
            title: "Exam cancelled",
            wording: ({ subjectName, when, examName }) =>
                `${examName || "An exam"} for ${subjectName}`
                + `${when ? ` on ${when}` : ""} has been cancelled.`
        });

        return res.status(200).json({

            success: true,
            message: "Exam deleted successfully."

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
module.exports = {

    createExam,
    getAllExams,
    getExamById,
    updateExam,
    deleteExam

};