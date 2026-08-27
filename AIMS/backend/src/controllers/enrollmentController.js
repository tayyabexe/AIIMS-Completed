// The courses a student is registered for.
//
// `enrollments` is the roster: one row per student per subject per semester,
// with a status of Active, Completed or Dropped. It had no route, so the
// portals had no way to ask what a student is actually taking and were left
// inferring it from whatever else mentioned a subject - the section timetable,
// or the attendance rows themselves. Both are wrong: a section timetable
// carries subjects a given student is not registered for, and building the
// list out of attendance hides any course whose first session has not been
// marked yet.
//
// The subject and semester are joined in so one request answers the whole
// question: what am I taking, how many credit hours, in which semester.

const { sequelize } = require("../database/connection");

/*
 * The curriculum stage a course belongs to is `subjects.semester_id`.
 *
 * `enrollments.semester_id` is a COPY of it, taken once when the cohort was
 * enrolled (services/courseOfferingService.js -> enrolCohort) and never
 * reconciled afterwards. Moving a subject between semesters updated the
 * subject and left every enrollment behind, so a course silently dropped out
 * of the student's semester and reappeared as a phantom semester of its own --
 * which is exactly what put one of two Semester 1 courses on a student's
 * dashboard and invented a "Semester 2" to hold the other.
 *
 * Reads resolve the stage from the subject now, and the enrollment's own
 * column is returned alongside it as `enrollment_semester_id` so a stale row
 * is visible rather than merely absent. updateSubject cascades the change (see
 * services/subjectService.js) and the migration backfills what had already
 * drifted; this join is the belt to those braces -- a row written by any path
 * that has not been found cannot misfile a course again.
 */
const SELECT_ENROLLMENTS = `
    SELECT e.enrollment_id,
           e.student_id,
           e.subject_id,
           s.semester_id,
           e.semester_id AS enrollment_semester_id,
           e.enrollment_date,
           e.status,
           s.subject_code,
           s.subject_name,
           s.credit_hours,
           s.prerequisite_subject_id,
           pre.subject_code AS prerequisite_subject_code,
           pre.subject_name AS prerequisite_subject_name,
           sem.semester_number,
           sem.start_date AS semester_start_date,
           sem.end_date   AS semester_end_date,
           sem.is_archived AS semester_is_archived
      FROM enrollments e
      JOIN subjects s        ON s.subject_id = e.subject_id
 LEFT JOIN subjects pre      ON pre.subject_id = s.prerequisite_subject_id
 LEFT JOIN semesters sem     ON sem.semester_id = s.semester_id
`;

const runQuery = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

// ================= GET ENROLLMENTS =================
//
// Filters: student_id, semester_id, subject_id, status.
//
// A student may only ask for their own roster. requireStudentAccess guards the
// /student/:student_id route; here the caller's own id is forced in, so a
// student calling GET /api/enrollments without a filter gets their own courses
// rather than all 10,000 rows.

const getEnrollments = async (req, res) => {

    try {

        const { semester_id, subject_id, status } = req.query;

        // req.ownStudentId is set by scopeStudentToSelf for a STUDENT caller.
        const studentId = req.ownStudentId ?? req.query.student_id;

        const where = [];
        const replacements = {};

        if (studentId) {
            where.push("e.student_id = :studentId");
            replacements.studentId = studentId;
        }

        if (semester_id) {
            where.push("s.semester_id = :semesterId");
            replacements.semesterId = semester_id;
        }

        if (subject_id) {
            where.push("e.subject_id = :subjectId");
            replacements.subjectId = subject_id;
        }

        if (status) {
            where.push("e.status = :status");
            replacements.status = status;
        }

        const sql = `${SELECT_ENROLLMENTS}
            ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY s.semester_id DESC, s.subject_code ASC`;

        const enrollments = await runQuery(sql, replacements);

        return res.status(200).json({
            success: true,
            count: enrollments.length,
            data: enrollments
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });

    }

};

// ================= GET A STUDENT'S ENROLLMENTS =================

const getStudentEnrollments = async (req, res) => {

    try {

        const { student_id } = req.params;
        const { semester_id, status } = req.query;

        const where = ["e.student_id = :studentId"];
        const replacements = { studentId: student_id };

        if (semester_id) {
            where.push("s.semester_id = :semesterId");
            replacements.semesterId = semester_id;
        }

        if (status) {
            where.push("e.status = :status");
            replacements.status = status;
        }

        const enrollments = await runQuery(
            `${SELECT_ENROLLMENTS}
              WHERE ${where.join(" AND ")}
           ORDER BY s.semester_id DESC, s.subject_code ASC`,
            replacements
        );

        return res.status(200).json({
            success: true,
            student_id: Number(student_id),
            count: enrollments.length,
            data: enrollments
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });

    }

};

module.exports = {
    getEnrollments,
    getStudentEnrollments
};
