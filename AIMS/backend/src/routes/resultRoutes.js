const express = require("express");

const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS } = require("../config/roles");
const {
    requireStudentAccess
} = require("../middlewares/selfScope.middleware");

const publishing = require("../services/resultPublishingService");

const {

    calculateGPA,
    calculateCGPA,
    publishResult,
    getTranscript,
    getGradingScale,
    getExamReport

} = require("../controllers/resultController");

router.post(
    "/calculate",
    authenticate,
    calculateGPA
);

// The grading scale is reference data every portal reads.
router.get(
    "/grades",
    authenticate,
    getGradingScale
);

router.get(
    "/cgpa/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    calculateCGPA
);

router.put(
    "/publish/:id",
    authenticate,
    publishResult
);
router.get(
    "/transcript/:student_id",
    authenticate,
    requireStudentAccess("student_id"),
    getTranscript
);
router.get(
    "/report/:exam_id",
    authenticate,
    getExamReport
);
/*
 * SEMESTER RESULT PUBLISHING
 * --------------------------
 * The step between "the teacher entered marks" and "the student has a GPA".
 * Nothing in the product performed it: `results` could be read by four portals
 * and written by none, so every GPA and CGPA on every screen was reading an
 * empty table.
 *
 * These three are deliberately separate from /calculate above, which computes a
 * single student's GPA incorrectly (see resultPublishingService for what is
 * wrong with it). They delegate to sp_publish_semester_results, which has been
 * in the database since the beginning and does the job properly.
 *
 * Admin-only: publishing a semester writes a GPA for every student in it and is
 * immediately visible to those students and their parents.
 */
router.get(
    "/publishable-semesters",
    authenticate,
    authorize(...ADMINS),
    async (req, res, next) => {
        try {
            res.status(200).json({
                success: true,
                data: await publishing.getPublishableSemesters()
            });
        } catch (error) { next(error); }
    }
);

router.get(
    "/semester/:semester_id",
    authenticate,
    authorize(...ADMINS),
    async (req, res, next) => {
        try {
            res.status(200).json({
                success: true,
                data: await publishing.getSemesterResults(req.params.semester_id)
            });
        } catch (error) { next(error); }
    }
);

router.post(
    "/publish-semester",
    authenticate,
    authorize(...ADMINS),
    async (req, res, next) => {
        try {
            const summary = await publishing.publishSemesterResults(
                req.body.semester_id,
                req.user?.user_id ?? null
            );

            /*
             * The message names BOTH halves of what just happened, because this
             * one press now does both: it compiles the semester GPA, and it
             * releases the marks that GPA was computed from to the students and
             * their parents. An admin has to be able to see from the response
             * that marks went out, not just that a number was written.
             */
            const results = summary.created
                ? `Published ${summary.created} result(s) for ${summary.semesterLabel}.`
                : `Recalculated ${summary.recalculated} result(s) for ${summary.semesterLabel}.`;

            res.status(200).json({
                success: true,
                message: summary.marksReleased
                    ? `${results} ${summary.marksReleased} mark(s) are now visible to students.`
                    : results,
                data: summary
            });
        } catch (error) { next(error); }
    }
);

module.exports = router;