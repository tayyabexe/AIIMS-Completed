const { Op } = require("sequelize");
const Subject = require("../models/subject.model");
const { sequelize } = require("../database/connection");

/*
 * A clash with a row that is already there is the caller's input being
 * refused, not the server failing. Without a status the controller had no way
 * to tell the two apart and reported every duplicate subject code as HTTP 500.
 */
const conflict = (message) => {
    const error = new Error(message);
    error.status = 409;
    return error;
};

/*
 * How often a class meets, stated once — here, on the subject.
 *
 * A period on this grid is 90 minutes (config/timetableSlots.js), so one credit
 * hour of weekly contact costs two thirds of a period: 2 CH meets once, 3 CH
 * twice, 4 CH three times.
 *
 * It is DERIVED on write rather than accepted from the caller, because the
 * column carries a DEFAULT of 2. A create that simply omitted it produced a
 * subject claiming two 90-minute meetings a week whatever its credit hours,
 * and that number is what the timetable screen counts as "periods required" —
 * so a 1-credit lab silently demanded twice the room time it needs.
 *
 * An explicit value is still honoured, so a subject that genuinely departs from
 * the rule can be recorded; it just cannot happen by accident.
 */
const deriveSessionsPerWeek = (data) => {
    if (data.sessions_per_week !== undefined && data.sessions_per_week !== null
        && data.sessions_per_week !== "") {
        return data;
    }

    const ch = Number(data.credit_hours);
    if (!Number.isFinite(ch) || ch <= 0) return data;

    return { ...data, sessions_per_week: Math.max(1, Math.round(ch / 1.5)) };
};

// Get all subjects
const getAllSubjects = async () => {
    return await Subject.findAll({
        where: {
            is_deleted: false
        }
    });
};

// Get subject by ID
const getSubjectById = async (id) => {
    return await Subject.findOne({
        where: {
            subject_id: id,
            is_deleted: false
        }
    });
};

// Create subject
const createSubject = async (subjectData) => {

    /*
     * The clash check ignores soft-deleted rows, and a soft-deleted row holding
     * the wanted code is REVIVED rather than duplicated.
     *
     * Without this, deleting a subject made its code and name unusable for
     * ever: the checks below matched the hidden row, so creating CS-101 again
     * was refused with "Subject code already exists" while the subject list
     * showed no CS-101 at all. There was no way out of that from the UI — the
     * row could not be seen, restored, or renamed.
     *
     * Reviving is safe precisely because deleteSubject refuses while anything
     * still references the subject, so a soft-deleted row has no offerings,
     * timetable slots, enrolments, exams or qualifications hanging off it.
     */
    const clash = async (field) => Subject.findOne({
        where: { [field]: subjectData[field], is_deleted: false }
    });

    if (subjectData.subject_code && await clash("subject_code")) {
        throw conflict("Subject code already exists");
    }

    if (subjectData.subject_name && await clash("subject_name")) {
        throw conflict("Subject name already exists");
    }

    const values = deriveSessionsPerWeek(subjectData);

    const revivable = await Subject.findOne({
        where: { subject_code: values.subject_code, is_deleted: true }
    });

    if (revivable) {
        await revivable.update({ ...values, is_deleted: false });
        return revivable;
    }

    return await Subject.create(values);
};

// Update subject
const updateSubject = async (id, subjectData) => {

    const subject = await Subject.findByPk(id);

    if (!subject || subject.is_deleted) {
        return null;
    }

    if (subjectData.subject_code) {

        const existingCode = await Subject.findOne({
            where: {
                subject_code: subjectData.subject_code,
                is_deleted: false
            }
        });

        if (
            existingCode &&
            existingCode.subject_id != id
        ) {
            throw conflict("Subject code already exists");
        }
    }

    if (subjectData.subject_name) {

        const existingName = await Subject.findOne({
            where: {
                subject_name: subjectData.subject_name,
                is_deleted: false
            }
        });

        if (
            existingName &&
            existingName.subject_id != id
        ) {
            throw conflict("Subject name already exists");
        }
    }

    /*
     * Moving a subject to a different semester has to take its enrollments
     * with it.
     *
     * `enrollments.semester_id` is a denormalised copy of this column, written
     * once when the cohort was enrolled and, until now, never reconciled. The
     * update below used to change the subject alone, which left every existing
     * enrollment pointing at the OLD stage: the course vanished from the
     * student's current semester and materialised a phantom semester to hold
     * itself. A student registered for two Semester 1 courses saw one.
     *
     * `marks` and `results` do not carry the subject's stage as a copy, so
     * enrollments is the whole of the cascade. Both writes run in one
     * transaction, because a subject that has moved and enrollments that have
     * not is the exact state this exists to prevent.
     */
    const nextSemesterId = subjectData.semester_id;

    const semesterChanged = nextSemesterId !== undefined
        && nextSemesterId !== null
        && Number(nextSemesterId) !== Number(subject.semester_id);

    const previousSemesterId = subject.semester_id;

    await sequelize.transaction(async (transaction) => {

        await subject.update(
            subjectData.credit_hours !== undefined
                ? deriveSessionsPerWeek(subjectData)
                : subjectData,
            { transaction }
        );

        if (semesterChanged) {

            await sequelize.query(
                `UPDATE enrollments
                    SET semester_id = :nextSemesterId
                  WHERE subject_id = :subjectId
                    AND semester_id = :previousSemesterId`,
                {
                    replacements: {
                        nextSemesterId,
                        subjectId: subject.subject_id,
                        previousSemesterId
                    },
                    type: sequelize.QueryTypes.UPDATE,
                    transaction
                }
            );

        }

    });

    return subject;
};

// Soft delete subject
/*
 * Deleting a subject refuses while anything still points at it, and says what.
 *
 * Every other row on the academic structure screen behaves this way, and a
 * subject is the most heavily referenced of them: a class (course_offering) is
 * a section studying THIS subject, and its timetable rows, enrolments, exams
 * and marks all hang off that. Soft-deleting it regardless — which is what this
 * used to do — hid the subject from every dropdown while leaving the classes
 * teaching it in place, so a running timetable referred to a subject the portal
 * would no longer name.
 *
 * The counts come back with the refusal because "could not delete" without the
 * reasons leaves the admin nothing to do next.
 */
const deleteSubject = async (id) => {
    const subject = await Subject.findByPk(id);

    if (!subject || subject.is_deleted) {
        return null;
    }

    const [counts] = await sequelize.query(
        `SELECT
            (SELECT COUNT(*) FROM course_offerings WHERE subject_id = :id) AS offerings,
            (SELECT COUNT(*) FROM enrollments      WHERE subject_id = :id) AS enrollments,
            (SELECT COUNT(*) FROM exams            WHERE subject_id = :id) AS exams,
            (SELECT COUNT(*) FROM timetables       WHERE subject_id = :id) AS timetables,
            (SELECT COUNT(*) FROM teacher_subjects WHERE subject_id = :id) AS qualifications`,
        { type: sequelize.QueryTypes.SELECT, replacements: { id } }
    );

    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

    const blockedBy = [
        [counts.offerings, "class"],
        [counts.timetables, "timetable slot"],
        [counts.enrollments, "enrolment"],
        [counts.exams, "exam"],
        [counts.qualifications, "teacher qualification"]
    ]
        .filter(([n]) => Number(n) > 0)
        .map(([n, word]) => plural(Number(n), word));

    if (blockedBy.length) {
        const error = new Error(
            `This subject is still in use: ${blockedBy.join(", ")}. Move or remove those first.`
        );
        error.status = 409;
        error.blockedBy = blockedBy;
        throw error;
    }

    await subject.update({
        is_deleted: true
    });

    return subject;
};

// Search subjects
const searchSubjects = async (keyword) => {
    return await Subject.findAll({
        where: {
            is_deleted: false,
            [Op.or]: [
                {
                    subject_name: {
                        [Op.like]: `%${keyword}%`
                    }
                },
                {
                    subject_code: {
                        [Op.like]: `%${keyword}%`
                    }
                }
            ]
        }
    });
};

module.exports = {
    getAllSubjects,
    getSubjectById,
    createSubject,
    updateSubject,
    deleteSubject,
    searchSubjects
};