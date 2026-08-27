/*
 * Turning marks into results — the step that had no screen.
 *
 * WHAT WAS MISSING
 * ----------------
 * Teachers could enter marks and every portal could READ results, but nothing
 * in the product ever created one. `resultsApi` had zero callers in the front
 * end, so `results` stayed empty for ever: the student's Result screen, the
 * parent's Results view, the admin's CGPA columns and every GPA figure on
 * every dashboard were reading a table nobody could write to.
 *
 * WHY THIS DOES NOT USE POST /api/results/calculate
 * -------------------------------------------------
 * That endpoint exists and is wrong in ways that would be invisible on screen:
 *
 *   - It selects marks by student and ignores the semester it was given, so a
 *     second-semester GPA is computed from every mark the student has ever had.
 *   - It averages grade points per EXAM, unweighted, so a 1-credit lab quiz
 *     counts as much as a 4-credit final.
 *   - It writes `cgpa: gpa`, so the CGPA is only ever the latest semester.
 *   - It always INSERTs, and `results` has UNIQUE (student_id, semester_id),
 *     so the second run fails rather than correcting the first.
 *
 * `sp_publish_semester_results` — in the database since the beginning, and
 * never called from anywhere — does the same job correctly: credit-hour
 * weighted GPA, CGPA carried across prior Published semesters, an upsert so
 * re-publishing corrects rather than duplicates, and the whole thing in one
 * transaction. This service is the missing wiring, not new arithmetic.
 */

const { sequelize } = require("../database/connection");
const notify = require("./notificationService");

const select = (sql, replacements) =>
    sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, replacements });

const fail = (status, message, extra = {}) => {
    const error = new Error(message);
    error.status = status;
    Object.assign(error, extra);
    return error;
};

/**
 * Every semester that has marks against it, and whether it can be published.
 *
 * The two numbers that decide that are counted here rather than left for the
 * procedure to refuse on: `draftMarks` is the blocker, and an admin needs to
 * see WHICH semester is blocked and by how much before pressing anything.
 */
const getPublishableSemesters = async () => {
    const rows = await select(
        `SELECT sm.semester_id,
                sm.semester_number,
                sm.program_id,
                p.program_name,
                COUNT(m.mark_id)                                   AS mark_count,
                SUM(m.status = 'Draft')                            AS draft_marks,
                SUM(m.status = 'Verified')                         AS verified_marks,
                SUM(m.status = 'Published')                        AS published_marks,
                COUNT(DISTINCT m.student_id)                       AS students_with_marks,
                (SELECT COUNT(*) FROM results r
                  WHERE r.semester_id = sm.semester_id
                    AND r.status = 'Published')                    AS published_results,
                (SELECT MAX(r.published_at) FROM results r
                  WHERE r.semester_id = sm.semester_id)            AS last_published_at
           FROM semesters sm
           LEFT JOIN programs p ON p.program_id = sm.program_id
           LEFT JOIN exams    e ON e.semester_id = sm.semester_id
           LEFT JOIN marks    m ON m.exam_id     = e.exam_id
          GROUP BY sm.semester_id, sm.semester_number, sm.program_id, p.program_name
         HAVING mark_count > 0
          ORDER BY p.program_name, sm.semester_number`
    );

    return rows.map((r) => {
        const draftMarks = Number(r.draft_marks || 0);

        return {
            semesterId: r.semester_id,
            semesterNumber: Number(r.semester_number),
            semesterLabel: `Semester ${r.semester_number}`,
            programId: r.program_id,
            program: r.program_name || null,
            markCount: Number(r.mark_count),
            draftMarks,
            // Marks the teachers have submitted and this publish will RELEASE
            // to students. The admin is about to make these visible, so the
            // screen has to be able to say how many before they press.
            awaitingRelease: Number(r.verified_marks || 0),
            releasedMarks: Number(r.published_marks || 0),
            studentsWithMarks: Number(r.students_with_marks),
            publishedResults: Number(r.published_results),
            lastPublishedAt: r.last_published_at || null,
            // The procedure refuses while any mark is still Draft: a Draft mark
            // is one the teacher has not finished, and a GPA computed from half
            // an entry is worse than no GPA at all.
            canPublish: draftMarks === 0,
            blockedReason: draftMarks > 0
                ? `${draftMarks} mark${draftMarks === 1 ? "" : "s"} still in Draft. `
                  + "The teacher must submit them for approval from the faculty "
                  + "Marks screen first."
                : null
        };
    });
};

/**
 * Publish one semester's results.
 *
 * Everything of substance happens inside sp_publish_semester_results; this
 * checks the semester exists, runs it, and reports what changed by counting
 * before and after — the procedure returns no result set, so "it worked" would
 * otherwise be an assumption.
 */
const publishSemesterResults = async (semesterId, releasedByUserId = null) => {
    const id = Number.parseInt(semesterId, 10);
    if (!Number.isInteger(id) || id < 1) {
        throw fail(400, "A numeric semester_id is required.");
    }

    const [semester] = await select(
        `SELECT sm.semester_id, sm.semester_number, p.program_name
           FROM semesters sm
           LEFT JOIN programs p ON p.program_id = sm.program_id
          WHERE sm.semester_id = :id`,
        { id }
    );
    if (!semester) throw fail(404, `Semester ${id} does not exist.`);

    const [{ n: marksHere }] = await select(
        `SELECT COUNT(*) AS n FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
          WHERE e.semester_id = :id`,
        { id }
    );
    if (Number(marksHere) === 0) {
        throw fail(
            422,
            `No marks have been entered for Semester ${semester.semester_number}`
            + `${semester.program_name ? ` of ${semester.program_name}` : ""}, `
            + "so there is nothing to publish."
        );
    }

    const [{ n: draft }] = await select(
        `SELECT COUNT(*) AS n FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
          WHERE e.semester_id = :id AND m.status = 'Draft'`,
        { id }
    );
    if (Number(draft) > 0) {
        // Refused here as well as inside the procedure, because SIGNAL comes
        // back as a raw SQLSTATE 45000 with the procedure's name in it — true,
        // but not something to show an administrator.
        throw fail(
            422,
            `${draft} mark${Number(draft) === 1 ? " is" : "s are"} still in Draft for this semester. `
            + "Results cannot be published until every mark has been published by its teacher."
        );
    }

    const before = await select(
        "SELECT COUNT(*) AS n FROM results WHERE semester_id = :id AND status = 'Published'",
        { id }
    );

    await sequelize.query("CALL sp_publish_semester_results(:id)", {
        replacements: { id }
    });

    /*
     * RELEASING THE MARKS THEMSELVES — the step that did not exist.
     *
     * Compiling the GPA and letting the student see the marks it was compiled
     * from are the same decision, so they are the same gesture. Until now they
     * were neither: the GPA was released here, and the marks were released by
     * nobody, because the student's read path never looked at `marks.status`
     * and showed them from the moment a teacher typed them.
     *
     * So this is where a mark becomes visible. Everything the teachers
     * submitted for this semester moves Verified -> Published, in the same
     * breath as the result computed from it. Draft rows cannot be here — the
     * checks above refuse the whole publish while any exist — which is what
     * makes it safe to release the rest wholesale.
     *
     * Who released them is recorded in the audit trail by the route, NOT in
     * `marks.verified_by`: that column is a foreign key onto
     * `teachers.teacher_id`, so writing an administrator's user id into it
     * would either fail the constraint or, worse, succeed by colliding with an
     * unrelated teacher whose id happens to match. The audit entry can name a
     * user; this column cannot.
     */
    const [{ n: releasable }] = await select(
        `SELECT COUNT(*) AS n FROM marks m
           JOIN exams e ON e.exam_id = m.exam_id
          WHERE e.semester_id = :id AND m.status = 'Verified'`,
        { id }
    );

    if (Number(releasable) > 0) {
        await sequelize.query(
            `UPDATE marks m
               JOIN exams e ON e.exam_id = m.exam_id
                SET m.status = 'Published'
              WHERE e.semester_id = :id AND m.status = 'Verified'`,
            { replacements: { id } }
        );
    }

    const after = await select(
        "SELECT COUNT(*) AS n FROM results WHERE semester_id = :id AND status = 'Published'",
        { id }
    );

    const publishedBefore = Number(before[0].n);
    const publishedAfter = Number(after[0].n);

    /*
     * Tell the students their result is out.
     *
     * Without this the release is silent and the only way to discover it is to
     * keep opening the Result page — which is exactly what students did, and
     * what made a Draft mark appearing early feel like a feature rather than
     * the defect it was.
     *
     * Guardians are included: a parent portal exists for this, and a released
     * semester result is the event it was built around.
     *
     * Notification failure must not fail the publish. The results are already
     * committed at this point, and an unsent notice is a smaller problem than
     * an administrator being told the publish failed when it did not — they
     * would press it again.
     */
    const notified = [];

    try {
        const recipients = await select(
            `SELECT r.student_id, r.gpa
               FROM results r
               JOIN students s ON s.student_id = r.student_id
              WHERE r.semester_id = :id
                AND r.status = 'Published'
                AND s.is_deleted = 0`,
            { id }
        );

        const label = `Semester ${semester.semester_number}`;

        for (const row of recipients) {
            await notify.notifyStudent({
                studentId: row.student_id,
                type: notify.TYPES.RESULT,
                subject: "results",
                actorUserId: releasedByUserId ?? null,
                title: `${label} result published`,
                ownMessage:
                    `Your ${label} result has been published`
                    + `${row.gpa === null ? "" : ` — GPA ${Number(row.gpa).toFixed(2)}`}`
                    + ". Your marks for this semester are now available on your Results page.",
                // resolve() calls a message function as (role, who) — the
                // student's name is the SECOND argument, not the first.
                guardianMessage: (_role, who) =>
                    `${who}'s ${label} result has been published`
                    + `${row.gpa === null ? "" : ` — GPA ${Number(row.gpa).toFixed(2)}`}`
                    + ". The marks for this semester are now available in the parent portal."
            });
            notified.push(row.student_id);
        }
    } catch (error) {
        console.error("publishSemesterResults: notifications failed", error.message);
    }

    return {
        semesterId: id,
        semesterLabel: `Semester ${semester.semester_number}`,
        program: semester.program_name || null,
        publishedBefore,
        publishedAfter,
        created: Math.max(0, publishedAfter - publishedBefore),
        // A re-publish recomputes rows that already existed. Reporting that as
        // "0 results" would read as a failure when it is the correct outcome of
        // correcting a mark and publishing again.
        recalculated: Math.min(publishedBefore, publishedAfter),
        marksReleased: Number(releasable)
    };
};

/** One semester's published results, for the admin to check what was produced. */
const getSemesterResults = async (semesterId) => {
    const id = Number.parseInt(semesterId, 10);
    if (!Number.isInteger(id) || id < 1) {
        throw fail(400, "A numeric semester_id is required.");
    }

    const rows = await select(
        `SELECT r.result_id, r.student_id, r.gpa, r.cgpa, r.status, r.published_at,
                s.registration_number,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name
           FROM results r
           JOIN students s ON s.student_id = r.student_id
          WHERE r.semester_id = :id AND s.is_deleted = 0
          ORDER BY r.gpa DESC, s.registration_number`,
        { id }
    );

    return rows.map((r) => ({
        resultId: r.result_id,
        studentId: r.student_id,
        registrationNumber: r.registration_number,
        studentName: r.student_name,
        gpa: r.gpa === null ? null : Number(r.gpa),
        cgpa: r.cgpa === null ? null : Number(r.cgpa),
        status: r.status,
        publishedAt: r.published_at || null
    }));
};

module.exports = {
    getPublishableSemesters,
    publishSemesterResults,
    getSemesterResults
};
