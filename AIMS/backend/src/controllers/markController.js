const { validationResult } = require("express-validator");
const Mark = require("../models/mark.model");
const { sequelize } = require("../database/connection");
const audit = require("../services/auditService");
const notify = require("../services/notificationService");
const { ADMIN_TEACHER } = require("../config/roles");

/*
 * Who may read a mark that has not been released yet.
 *
 * Everyone who works at the institute — the two admin roles and the teacher —
 * as opposed to the student the mark is about and their parent. Built from
 * ADMIN_TEACHER so it cannot drift from the role table.
 */
const STAFF_ROLE_IDS = new Set(ADMIN_TEACHER);

/*
 * The names behind a mark row.
 *
 * `marks` holds two foreign keys and a number, so an audit entry built from the
 * row alone reads "Marks updated — marks#8812". The point of the trail is that
 * an administrator can see a student's score was changed WITHOUT going to the
 * database, so the student and the exam are looked up and carried into the
 * entry. One indexed query per write, on a path that writes one row.
 *
 * A lookup failure must not fail the mark: it returns nulls and the entry falls
 * back to the entity reference.
 */
const markContext = async (mark) => {
    try {
        const rows = await sequelize.query(
            `SELECT CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                    s.registration_number,
                    e.exam_name,
                    e.total_marks,
                    sub.subject_name
               FROM marks m
               JOIN students s   ON s.student_id  = m.student_id
               JOIN exams    e   ON e.exam_id     = m.exam_id
          LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
              WHERE m.mark_id = :markId
              LIMIT 1`,
            {
                type: sequelize.QueryTypes.SELECT,
                replacements: { markId: mark.mark_id }
            }
        );

        if (!rows.length) return {};

        return {
            studentName: rows[0].student_name,
            registrationNumber: rows[0].registration_number,
            examTitle: rows[0].exam_name,
            subjectName: rows[0].subject_name,
            totalMarks: rows[0].total_marks
        };
    } catch {
        return {};
    }
};

// ================= ENTER MARKS =================

const enterMarks = async (req, res) => {

    try {

        const errors = validationResult(req);

        if (!errors.isEmpty()) {

            return res.status(400).json({
                success: false,
                errors: errors.array()
            });

        }

        const {
            exam_id,
            student_id,
            obtained_marks,
            entered_by
        } = req.body;

        // Prevent duplicate marks
        const existingMark = await Mark.findOne({

            where: {
                exam_id,
                student_id
            }

        });

        if (existingMark) {

            return res.status(409).json({

                success: false,
                message: "Marks already entered for this student."

            });

        }

        const mark = await Mark.create({

            exam_id,
            student_id,
            obtained_marks,
            entered_by

        });

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.MARKS_ENTERED,
            module: audit.MODULES.EXAMS,
            entity: `marks#${mark.mark_id}`,
            after: {
                markId: mark.mark_id,
                examId: mark.exam_id,
                studentId: mark.student_id,
                obtainedMarks: mark.obtained_marks,
                enteredBy: mark.entered_by,
                ...(await markContext(mark))
            },
            req
        });

        return res.status(201).json({

            success: true,
            message: "Marks entered successfully.",
            mark

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= GET STUDENT MARKS =================

/*
 * A mark row on its own is unreadable: `marks` stores only obtained_marks and
 * an exam_id, so every screen that rendered a score showed "0%" or "null%"
 * because the denominator (exams.total_marks) and the subject were never sent.
 *
 * The exam and its subject are joined in here so one request answers "what did
 * this student score, out of what, in which subject".
 */
const getStudentMarks = async (req, res) => {

    try {

        const { student_id } = req.params;

        /*
         * TASK 10 — the step that decides when a mark becomes visible.
         *
         * This query never looked at `m.status`, so it returned every row for
         * the student regardless of where it stood in the workflow. A mark
         * reached the student's Result page — and their parent's — the moment a
         * teacher pressed "Save Draft". Verified with Playwright before this
         * change: a teacher saved 31/50 as a DRAFT and it was on the student's
         * screen seconds later, dragging their displayed grade from A down to
         * B. The teacher's "Publish" button and the whole
         * Draft -> Verified -> Published enum were read by nobody on this path.
         *
         * The status now gates the read, and WHO is asking decides what that
         * means:
         *
         *   student / parent  ->  Published only. A mark is theirs to see once
         *                         an administrator has released it, which is
         *                         the point of the workflow.
         *   staff             ->  every status. A teacher must always be able
         *                         to see what they entered, and an admin has to
         *                         see what is waiting before releasing it.
         *
         * `requireStudentAccess` on the route has already established that the
         * caller may read THIS student; it does not say what they may read
         * about them. That is decided here.
         */
        const isStaff = STAFF_ROLE_IDS.has(Number(req.user?.role_id));

        const marks = await sequelize.query(
            `SELECT m.mark_id,
                    m.exam_id,
                    m.student_id,
                    m.obtained_marks,
                    m.status,
                    e.exam_name,
                    e.exam_type,
                    e.exam_date,
                    e.total_marks,
                    e.semester_id,
                    e.subject_id,
                    s.subject_code,
                    s.subject_name,
                    s.credit_hours
               FROM marks m
               LEFT JOIN exams e    ON e.exam_id = m.exam_id
               LEFT JOIN subjects s ON s.subject_id = e.subject_id
              WHERE m.student_id = :studentId
                ${isStaff ? "" : "AND m.status = 'Published'"}
              ORDER BY e.exam_date ASC, m.exam_id ASC`,
            {
                type: sequelize.QueryTypes.SELECT,
                replacements: { studentId: student_id }
            }
        );

        return res.status(200).json({

            success: true,
            count: marks.length,
            // Stated rather than implied, so a caller can tell an empty list
            // that means "nothing released yet" from one that means "no marks
            // exist" without having to know the rule.
            scope: isStaff ? "all" : "published",
            marks

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};

// ================= STUDENT ASSESSMENT LEDGER =================

/*
 * Every assessment a student's registered courses carry, graded or not.
 *
 * WHY THIS IS NOT getStudentMarks
 * -------------------------------
 * That endpoint reads `marks`, and a `marks` row only exists once a teacher has
 * typed a score into it. So a sitting that has been SCHEDULED and not yet
 * marked — the Final that is on the calendar, the quiz sat last week whose
 * papers are still with the teacher — is invisible to it. A parent reading that
 * list cannot tell "there is no final exam in this course" from "the final has
 * not been marked yet", which are opposite facts.
 *
 * The roster is therefore the spine of this query, not the marks table:
 *
 *   enrollments   what the student is registered for      (always present)
 *     -> exams    what assessments those courses carry    (LEFT JOIN)
 *       -> marks  what the student scored in each one     (LEFT JOIN)
 *
 * Every LEFT, so a course with no exams still comes back, and an exam with no
 * mark still comes back. `exams` is keyed by (subject_id, semester_id) with no
 * section column, so the assessments for a registered course are exactly the
 * exams filed against that subject in that semester.
 *
 * THE PUBLISHED GATE, AND WHY IT IS ON THE JOIN
 * --------------------------------------------
 * getStudentMarks applies `m.status = 'Published'` in the WHERE clause, which
 * is right for it: a row that is not released is not a mark the family may see.
 * Here the same predicate has to sit on the JOIN instead. In the WHERE it would
 * discard the whole exam along with the unreleased mark, and the assessment
 * would vanish from the parent's table entirely — exactly the confusion above,
 * reintroduced by the fix for it. On the JOIN it discards only the score, and
 * the sitting is reported as awaiting a result, which is the truth.
 *
 * So for a family, a Draft or Verified mark is indistinguishable from an
 * ungraded one, and that is deliberate. Staff see every status, as they do
 * everywhere else on this controller.
 *
 * Each assessment comes back with a `state`:
 *
 *   graded     a score the caller is entitled to see
 *   pending    the date has passed and no releasable score exists
 *   scheduled  the date is still ahead
 *
 * The percentage per subject is computed over `graded` sittings alone. Counting
 * a pending final as a zero would report a child who has passed everything
 * marked so far as failing.
 */

// One short label per exam type, numbered within its own column so a parent
// reads "Q1, Q2" rather than three rows all called "Quiz".
const ASSESSMENT_PREFIX = {
    Assignment: "A",
    Quiz: "Q",
    "Mid-Term": "MT",
    Final: "F",
    Practical: "P",
    Viva: "V"
};

const getStudentAssessments = async (req, res) => {

    try {

        const { student_id } = req.params;

        const isStaff = STAFF_ROLE_IDS.has(Number(req.user?.role_id));

        const rows = await sequelize.query(
            `SELECT en.enrollment_id,
                    en.subject_id,
                    en.semester_id,
                    en.status              AS enrollment_status,
                    sub.subject_code,
                    sub.subject_name,
                    sub.credit_hours,
                    sem.semester_number,
                    ex.exam_id,
                    ex.exam_name,
                    ex.exam_type,
                    ex.exam_date,
                    ex.total_marks,
                    mk.mark_id,
                    mk.obtained_marks,
                    mk.status              AS mark_status
               FROM enrollments en
               JOIN subjects  sub ON sub.subject_id  = en.subject_id
          LEFT JOIN semesters sem ON sem.semester_id = en.semester_id
          LEFT JOIN exams     ex  ON ex.subject_id   = en.subject_id
                                 AND ex.semester_id  = en.semester_id
          LEFT JOIN marks     mk  ON mk.exam_id      = ex.exam_id
                                 AND mk.student_id   = en.student_id
                                 ${isStaff ? "" : "AND mk.status = 'Published'"}
              WHERE en.student_id = :studentId
                AND en.status <> 'Dropped'
                AND (sub.is_deleted = 0 OR sub.is_deleted IS NULL)
              ORDER BY sem.semester_number ASC,
                       sub.subject_code ASC,
                       ex.exam_date ASC,
                       ex.exam_id ASC`,
            {
                type: sequelize.QueryTypes.SELECT,
                replacements: { studentId: student_id }
            }
        );

        // Compared date-only. An exam sat this morning is not "scheduled".
        const today = new Date().toISOString().slice(0, 10);

        const bySubject = new Map();

        for (const row of rows) {

            let subject = bySubject.get(row.enrollment_id);

            if (!subject) {
                subject = {
                    enrollmentId: row.enrollment_id,
                    subjectId: row.subject_id,
                    subjectCode: row.subject_code,
                    subjectName: row.subject_name,
                    creditHours: row.credit_hours,
                    semesterId: row.semester_id,
                    semesterNumber: row.semester_number ?? null,
                    enrollmentStatus: row.enrollment_status,
                    assessments: [],
                    obtained: 0,
                    total: 0,
                    percent: null
                };
                bySubject.set(row.enrollment_id, subject);
            }

            // The LEFT JOIN's null row: a registered course with no assessment
            // filed against it at all.
            if (row.exam_id === null || row.exam_id === undefined) continue;

            const examDate = row.exam_date
                ? String(row.exam_date).slice(0, 10)
                : null;

            const obtained = row.obtained_marks === null
                || row.obtained_marks === undefined
                ? null
                : Number(row.obtained_marks);

            const state = obtained !== null
                ? "graded"
                : (examDate && examDate > today ? "scheduled" : "pending");

            const totalMarks = Number(row.total_marks);

            if (state === "graded" && Number.isFinite(totalMarks) && totalMarks > 0) {
                subject.obtained += obtained;
                subject.total += totalMarks;
            }

            subject.assessments.push({
                examId: row.exam_id,
                examName: row.exam_name,
                examType: row.exam_type,
                examDate,
                totalMarks: Number.isFinite(totalMarks) ? totalMarks : null,
                obtained,
                // Sent through so a staff caller can tell a Draft from a
                // Verified one. Always null for a family, by the join above.
                markStatus: row.mark_status ?? null,
                state,
                // Filled in below, once every sitting of this type is known.
                label: null
            });
        }

        const subjects = [...bySubject.values()];

        for (const subject of subjects) {

            /*
             * Numbering runs per type, in the order the sittings are dated —
             * which the ORDER BY has already established. A subject with one
             * mid-term gets "MT", not "MT1": the number is only worth printing
             * when there is something to tell apart.
             */
            const counts = new Map();
            for (const a of subject.assessments) {
                counts.set(a.examType, (counts.get(a.examType) || 0) + 1);
            }

            const seen = new Map();
            for (const a of subject.assessments) {
                const prefix = ASSESSMENT_PREFIX[a.examType] || "?";
                const n = (seen.get(a.examType) || 0) + 1;
                seen.set(a.examType, n);
                a.label = counts.get(a.examType) > 1 ? `${prefix}${n}` : prefix;
            }

            subject.percent = subject.total > 0
                ? Math.round((subject.obtained / subject.total) * 100)
                : null;
        }

        return res.status(200).json({

            success: true,
            count: subjects.length,
            // Same contract as getStudentMarks: the caller is told which rule
            // produced this answer rather than having to know it.
            scope: isStaff ? "all" : "published",
            subjects

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};

// ================= UPDATE MARKS =================

const updateMarks = async (req, res) => {

    try {

        const { id } = req.params;

        const mark = await Mark.findByPk(id);

        if (!mark) {

            return res.status(404).json({

                success: false,
                message: "Marks not found."

            });

        }

        const { obtained_marks } = req.body;

        // The score as it stood. This is the entire reason the entry is worth
        // writing: "a mark was changed" is nothing, "78 became 91" is the fact.
        const previousMarks = mark.obtained_marks;

        mark.obtained_marks = obtained_marks;

        await mark.save();

        const context = await markContext(mark);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.MARKS_UPDATED,
            module: audit.MODULES.EXAMS,
            entity: `marks#${mark.mark_id}`,
            before: { obtainedMarks: previousMarks, ...context },
            after: {
                markId: mark.mark_id,
                examId: mark.exam_id,
                studentId: mark.student_id,
                obtainedMarks: mark.obtained_marks,
                ...context
            },
            req
        });

        return res.status(200).json({

            success: true,
            message: "Marks updated successfully.",
            mark

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= VERIFY MARKS =================

const verifyMarks = async (req, res) => {

    try {

        const { id } = req.params;

        const { verified_by } = req.body;

        const mark = await Mark.findByPk(id);

        if (!mark) {

            return res.status(404).json({

                success: false,
                message: "Marks not found."

            });

        }

        const previousStatus = mark.status;

        mark.verified_by = verified_by;
        mark.status = "Verified";

        await mark.save();

        // Verification is the step that makes a mark count towards a result,
        // so who signed it off is a separate fact from who entered it.
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.MARKS_VERIFIED,
            module: audit.MODULES.EXAMS,
            entity: `marks#${mark.mark_id}`,
            before: { status: previousStatus },
            after: {
                markId: mark.mark_id,
                examId: mark.exam_id,
                studentId: mark.student_id,
                obtainedMarks: mark.obtained_marks,
                status: mark.status,
                verifiedBy: mark.verified_by,
                ...(await markContext(mark))
            },
            req
        });

        /*
         * Addressed to the teacher who ENTERED the mark, not to the student.
         *
         * Verification is an internal step: it makes a mark count towards a
         * result, but the student hears nothing until the result is published,
         * which emits its own notice from resultController. Telling them at both
         * points would mean the second one — the one that actually matters —
         * arrives as a repeat.
         *
         * `mark.entered_by` is a teachers.teacher_id, which is why this goes
         * through teacherAudience rather than userAudience.
         */
        if (previousStatus !== "Verified" && mark.entered_by) {
            const context = await markContext(mark);

            await notify.emit({
                audience: await notify.teacherAudience(mark.entered_by),
                type: notify.TYPES.RESULT,
                subject: "results",
                actorUserId: req.user?.user_id,
                title: "Marks verified",
                message: `Marks you entered for ${context.examTitle || "an exam"}`
                    + `${context.subjectName ? ` (${context.subjectName})` : ""} have been verified.`
            });
        }

        return res.status(200).json({

            success: true,
            message: "Marks verified successfully.",
            mark

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};

// ================= MARKS SUMMARY (BULK) =================

/*
 * One aggregated exam score per student, for the screens that list many
 * students at once.
 *
 * This did not exist. The admin Examination view, the admin student profile
 * and the reports all wanted a per-student percentage, and the only route that
 * could answer was /marks/student/:id - one student per request. So those
 * screens read a `examScore` field that nothing ever populated and printed
 * "0%" for every student in the institute.
 *
 * The aggregate is done in SQL: total obtained over total available across
 * every exam the student has a mark for. A student with no graded sitting is
 * absent from the result rather than present with a zero.
 *
 * Staff only - a per-student list of everyone's scores is not something a
 * student or parent may read. `semester_id` narrows it to one semester.
 */
const getMarksSummary = async (req, res) => {

    try {

        const { semester_id } = req.query;

        const rows = await sequelize.query(
            `SELECT m.student_id,
                    SUM(m.obtained_marks)                  AS obtained,
                    SUM(e.total_marks)                     AS total,
                    COUNT(*)                               AS sittings,
                    ROUND(
                        SUM(m.obtained_marks) / NULLIF(SUM(e.total_marks), 0) * 100,
                        1
                    )                                      AS percentage
               FROM marks m
               JOIN exams e ON e.exam_id = m.exam_id
              WHERE e.total_marks > 0
                ${semester_id ? "AND e.semester_id = :semesterId" : ""}
              GROUP BY m.student_id`,
            {
                type: sequelize.QueryTypes.SELECT,
                replacements: { semesterId: semester_id }
            }
        );

        return res.status(200).json({
            success: true,
            count: rows.length,
            data: rows
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

module.exports = {

    enterMarks,
    getStudentMarks,
    getStudentAssessments,
    getMarksSummary,
    updateMarks,
    verifyMarks

};