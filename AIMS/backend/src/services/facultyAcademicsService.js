// Marks, Students and Reports for the teacher portal.
//
// Same scoping rule as facultyPortalService: a teacher only ever reaches the
// (subject, section) pairs they are timetabled for, and that is checked on the
// server rather than filtered in the browser.
//
// What these replace:
//   Marks    - the screen read `data.marks`, which the loader always set to []
//              because there was no bulk marks endpoint. It rendered an empty
//              table, and its Save Draft / Submit buttons only raised a toast.
//   Students - read the same loader's student list, whose program, department,
//              email and cgpa were all null, so half the columns were blank.
//   Reports  - seven tabs computed in the browser from those two empty
//              collections plus `submissions` and `fees`, which are [] for a
//              teacher by design.

const { sequelize } = require("../database/connection");
const {
    isoDate,
    pct,
    classKey,
    sectionRoster,
    findClass,
    getClasses,
    gradingScale
} = require("./facultyPortalService");

const SELECT = { type: sequelize.QueryTypes.SELECT };

/** Letter grade for a percentage, from the institute's own `grades` table. */
const gradeFor = (grades, percentage) => {
    if (percentage === null || percentage === undefined) return null;
    const hit = grades.find(
        (g) => percentage >= Number(g.min_percentage)
            && percentage <= Number(g.max_percentage)
    );
    return hit
        ? { letter: hit.grade_letter, point: Number(hit.grade_point) }
        : null;
};

// ------------------------------------------------------------------- exams

/**
 * The exams sitting on this teacher's subjects, with how many marks have been
 * entered against each. `exams` is per-subject, so an exam belongs to every
 * section that takes the subject; the marks sheet is chosen by exam + section.
 */
const getExams = async (teacherId, { subject_id, exam_type } = {}) => {

    const classes = await getClasses(teacherId);
    const subjectIds = [...new Set(classes.map((c) => c.subject_id))];

    if (!subjectIds.length) return [];

    const wanted = subject_id
        ? subjectIds.filter((id) => Number(id) === Number(subject_id))
        : subjectIds;

    if (!wanted.length) return [];

    const where = ["e.subject_id IN (:subjectIds)"];
    const replacements = { subjectIds: wanted };

    if (exam_type) {
        where.push("e.exam_type = :examType");
        replacements.examType = exam_type;
    }

    const rows = await sequelize.query(
        `SELECT e.exam_id,
                e.exam_name,
                e.exam_type,
                e.exam_date,
                e.total_marks,
                e.semester_id,
                e.subject_id,
                sub.subject_code,
                sub.subject_name,
                COUNT(m.mark_id) AS marks_entered,
                SUM(m.status = 'Published') AS marks_published,
                cr.room_name
           FROM exams e
           JOIN subjects sub ON sub.subject_id = e.subject_id
      LEFT JOIN marks m ON m.exam_id = e.exam_id
      LEFT JOIN classrooms cr ON cr.classroom_id = e.classroom_id
          WHERE ${where.join(" AND ")}
          GROUP BY e.exam_id, e.exam_name, e.exam_type, e.exam_date,
                   e.total_marks, e.semester_id, e.subject_id,
                   sub.subject_code, sub.subject_name, cr.room_name
          ORDER BY e.exam_date DESC, e.exam_id DESC`,
        { ...SELECT, replacements }
    );

    // Which sections this teacher takes the subject with, so the screen can
    // offer the right section list per exam without a second round trip.
    const sectionsBySubject = new Map();
    for (const c of classes) {
        if (!sectionsBySubject.has(c.subject_id)) sectionsBySubject.set(c.subject_id, []);
        sectionsBySubject.get(c.subject_id).push({
            section_id: c.section_id,
            section_name: c.section_name,
            student_count: c.student_count
        });
    }

    return rows.map((r) => ({
        exam_id: r.exam_id,
        exam_name: r.exam_name,
        exam_type: r.exam_type,
        exam_date: isoDate(r.exam_date),
        total_marks: Number(r.total_marks),
        semester_id: r.semester_id,
        subject_id: r.subject_id,
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        room_name: r.room_name,
        marks_entered: Number(r.marks_entered),
        marks_published: Number(r.marks_published || 0),
        sections: sectionsBySubject.get(r.subject_id) || []
    }));
};

/**
 * Creates an exam against one of this teacher's own subjects.
 *
 * POST /api/exams exists but is `authenticate` only and takes any subject_id,
 * so it cannot be handed to the portal — this checks the subject is one the
 * caller actually teaches before writing.
 */
const createExam = async (teacher, payload) => {

    const { exam_name, exam_type, subject_id, exam_date, total_marks, section_id } = payload;

    const classes = await getClasses(teacher.teacher_id);

    const owned = classes.find((c) => Number(c.subject_id) === Number(subject_id));

    if (!owned) return { error: "forbidden" };

    const types = ["Quiz", "Assignment", "Mid-Term", "Final", "Practical", "Viva"];

    if (!exam_name || !types.includes(exam_type)) {
        return { error: `exam_name is required and exam_type must be one of ${types.join(", ")}.` };
    }

    const date = isoDate(exam_date);
    const marks = Number(total_marks);

    if (!date) return { error: "exam_date is required (YYYY-MM-DD)." };
    if (!Number.isFinite(marks) || marks <= 0) {
        return { error: "total_marks must be a positive number." };
    }

    // The semester comes from the subject, not the client: `exams.semester_id`
    // has to agree with the subject it is set on.
    const [created] = await sequelize.query(
        `INSERT INTO exams
                (exam_name, exam_type, semester_id, subject_id,
                 exam_date, total_marks, invigilator_id)
         VALUES (:examName, :examType, :semesterId, :subjectId,
                 :examDate, :totalMarks, :invigilatorId)`,
        {
            replacements: {
                examName: exam_name,
                examType: exam_type,
                semesterId: owned.semester_id,
                subjectId: subject_id,
                examDate: date,
                totalMarks: marks,
                invigilatorId: teacher.teacher_id
            }
        }
    );

    return {
        exam_id: created,
        subject_id: Number(subject_id),
        section_id: section_id ? Number(section_id) : null
    };
};

// -------------------------------------------------------------- marks sheet

const examById = async (examId) => {
    const rows = await sequelize.query(
        `SELECT e.exam_id, e.exam_name, e.exam_type, e.exam_date,
                e.total_marks, e.semester_id, e.subject_id,
                sub.subject_code, sub.subject_name
           FROM exams e
           JOIN subjects sub ON sub.subject_id = e.subject_id
          WHERE e.exam_id = :examId
          LIMIT 1`,
        { ...SELECT, replacements: { examId } }
    );
    return rows.length ? rows[0] : null;
};

/**
 * One exam's marks for one section: every student in the section with their
 * mark, or null where nothing has been entered.
 */
const getMarksSheet = async (teacherId, examId, sectionId) => {

    const exam = await examById(examId);

    if (!exam) return { error: "not_found" };

    const klass = await findClass(teacherId, exam.subject_id, sectionId);

    if (!klass) return { error: "forbidden" };

    const [students, grades] = await Promise.all([
        sectionRoster(sectionId),
        gradingScale()
    ]);

    const ids = students.map((s) => s.student_id);

    const entered = ids.length
        ? await sequelize.query(
            `SELECT m.mark_id, m.student_id, m.obtained_marks, m.status,
                    m.entered_by, m.verified_by,
                    CONCAT(ee.first_name, ' ', ee.last_name) AS entered_by_name
               FROM marks m
          LEFT JOIN teachers t ON t.teacher_id = m.entered_by
          LEFT JOIN employees ee ON ee.employee_id = t.employee_id
              WHERE m.exam_id = :examId
                AND m.student_id IN (:studentIds)`,
            { ...SELECT, replacements: { examId, studentIds: ids } }
        )
        : [];

    const byStudent = new Map(entered.map((r) => [r.student_id, r]));

    const records = students.map((s) => {
        const row = byStudent.get(s.student_id) || null;
        const obtained = row ? Number(row.obtained_marks) : null;
        const percentage = obtained === null
            ? null
            : pct(obtained, Number(exam.total_marks));

        return {
            student_id: s.student_id,
            registration_number: s.registration_number,
            full_name: [s.first_name, s.last_name].filter(Boolean).join(" "),
            academic_status: s.academic_status,
            mark_id: row ? row.mark_id : null,
            // null is "not entered", which is not the same as a zero.
            obtained_marks: obtained,
            percentage,
            grade: gradeFor(grades, percentage),
            status: row ? row.status : null,
            entered_by_name: row ? row.entered_by_name : null,
            verified: row ? Boolean(row.verified_by) : false
        };
    });

    const scored = records.filter((r) => r.obtained_marks !== null);
    const values = scored.map((r) => r.obtained_marks);

    return {
        exam: {
            ...exam,
            exam_date: isoDate(exam.exam_date),
            total_marks: Number(exam.total_marks)
        },
        class: {
            subject_id: klass.subject_id,
            section_id: klass.section_id,
            subject_code: klass.subject_code,
            subject_name: klass.subject_name,
            section_name: klass.section_name,
            program_name: klass.program_name
        },
        summary: {
            students: records.length,
            entered: scored.length,
            pending: records.length - scored.length,
            average: values.length
                ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
                : null,
            highest: values.length ? Math.max(...values) : null,
            lowest: values.length ? Math.min(...values) : null,
            passed: scored.filter((r) => r.grade && r.grade.point > 0).length,
            pass_rate: scored.length
                ? Math.round(
                    (scored.filter((r) => r.grade && r.grade.point > 0).length / scored.length) * 100
                )
                : null
        },
        records
    };
};

/**
 * Saves a whole marks sheet in one transaction, upserting on the
 * (exam_id, student_id) unique key so re-submitting corrects the existing row
 * instead of failing. `entered_by` is the teacher resolved from the token.
 *
 * `status` is the `marks.status` ENUM. A TEACHER may move a mark between the
 * first two values only:
 *
 *   Draft     — still working on it. Nobody outside the faculty screen sees it.
 *   Verified  — submitted for approval. The teacher is finished; the marks are
 *               now waiting on an administrator.
 *
 * Published is deliberately NOT reachable from here. It is the state that makes
 * a mark visible to the student and their parent, and releasing it is the
 * administrator's decision — made on the admin Result Publishing screen, where
 * the semester's GPA is compiled from these same marks (see
 * resultPublishingService.publishSemesterResults).
 *
 * Before this, "Published" was accepted here and set directly by the teacher,
 * which read as a release and was not one: the student's read path ignored the
 * status entirely, so a Draft was already on their screen and pressing Publish
 * changed nothing for anybody. The status now means what it says on both ends.
 *
 * A teacher can still revise a submitted mark — the upsert below moves it back
 * down to Draft or re-submits it — right up until an admin releases it.
 */
const saveMarks = async (teacher, { exam_id, section_id, status, records }) => {

    const exam = await examById(exam_id);

    if (!exam) return { error: "not_found" };

    const klass = await findClass(teacher.teacher_id, exam.subject_id, section_id);

    if (!klass) return { error: "forbidden" };

    const roster = await sectionRoster(section_id);
    const allowed = new Set(roster.map((s) => s.student_id));

    const total = Number(exam.total_marks);

    /*
     * "Published" arriving from a teacher's screen is treated as a SUBMISSION,
     * not a release: it becomes Verified and waits for an administrator. It is
     * accepted rather than rejected so an older client, or a queued offline
     * save from before this change, still lands somewhere sensible instead of
     * erroring — and it can never over-reach, because the value it maps to is
     * one the teacher is allowed to set anyway.
     */
    const TEACHER_STATUSES = { Draft: "Draft", Verified: "Verified", Published: "Verified" };
    const nextStatus = TEACHER_STATUSES[status] || "Draft";

    const clean = [];

    for (const record of records || []) {
        if (!allowed.has(Number(record.student_id))) continue;

        // A blank cell means "not marked" and is skipped, not written as 0.
        if (record.obtained_marks === null
            || record.obtained_marks === undefined
            || record.obtained_marks === "") continue;

        const value = Number(record.obtained_marks);

        if (!Number.isFinite(value) || value < 0 || value > total) {
            return {
                error: `Marks must be between 0 and ${total}. `
                    + `Got "${record.obtained_marks}" for student ${record.student_id}.`
            };
        }

        clean.push({ student_id: Number(record.student_id), obtained_marks: value });
    }

    if (!clean.length) return { error: "No valid marks were supplied." };

    let created = 0;
    let updated = 0;

    /*
     * Marks an administrator has already RELEASED to students, which this save
     * left alone.
     *
     * The upsert below writes `status` unconditionally. Once Published means
     * "the student can see this", that would let an ordinary Save Draft pull a
     * result back off a student's screen without anyone deciding to — the
     * student sees a grade on Monday and an empty row on Tuesday, and nothing
     * anywhere records that it was withdrawn.
     *
     * So a released mark is not rewritten here. Correcting one is a real need,
     * but it is an administrator's action on the release screen, not a
     * side-effect of a teacher saving the sheet. The count is returned so the
     * screen can say which rows it did not take rather than reporting a clean
     * save that quietly skipped some.
     */
    const locked = [];

    await sequelize.transaction(async (transaction) => {
        for (const record of clean) {

            const [existing] = await sequelize.query(
                `SELECT mark_id, status FROM marks
                  WHERE exam_id = :examId AND student_id = :studentId
                  LIMIT 1`,
                {
                    ...SELECT,
                    transaction,
                    replacements: { examId: exam_id, studentId: record.student_id }
                }
            );

            if (existing && existing.status === "Published") {
                locked.push(record.student_id);
                continue;
            }

            if (existing) {
                await sequelize.query(
                    `UPDATE marks
                        SET obtained_marks = :obtained,
                            entered_by = :enteredBy,
                            status = :status
                      WHERE mark_id = :markId`,
                    {
                        transaction,
                        replacements: {
                            obtained: record.obtained_marks,
                            enteredBy: teacher.teacher_id,
                            status: nextStatus,
                            markId: existing.mark_id
                        }
                    }
                );
                updated += 1;
            } else {
                await sequelize.query(
                    `INSERT INTO marks
                            (exam_id, student_id, obtained_marks, entered_by, status)
                     VALUES (:examId, :studentId, :obtained, :enteredBy, :status)`,
                    {
                        transaction,
                        replacements: {
                            examId: exam_id,
                            studentId: record.student_id,
                            obtained: record.obtained_marks,
                            enteredBy: teacher.teacher_id,
                            status: nextStatus
                        }
                    }
                );
                created += 1;
            }
        }
    });

    /*
     * `context` exists for the audit entry the controller writes. Without it
     * the trail reads "Marks updated — exams#41", which names nothing a person
     * recognises; with it the same row reads "Marks updated — Midterm, Data
     * Structures (BSCS-2022-A), 38 students".
     */
    return {
        created,
        updated,
        status: nextStatus,
        lockedCount: locked.length,
        lockedStudentIds: locked,
        context: {
            examId: Number(exam_id),
            examTitle: exam.exam_name,
            subjectName: exam.subject_name,
            sectionId: Number(section_id),
            sectionName: klass.section_name ?? null,
            totalMarks: total
        }
    };
};

// ---------------------------------------------------------------- students

/**
 * Every student in the sections this teacher takes, with the columns the
 * Students screen actually shows: programme, department, semester, email,
 * CGPA, attendance and marks — each resolved from its own table rather than
 * left null.
 */
const getStudents = async (teacherId) => {

    const classes = await getClasses(teacherId);
    const sectionIds = [...new Set(classes.map((c) => c.section_id))];

    if (!sectionIds.length) {
        return { students: [], totals: { students: 0, sections: 0, subjects: 0 }, filters: {} };
    }

    const pairs = classes.map((c) => [c.subject_id, c.section_id]);

    const [rows, attendance, marks, cgpa] = await Promise.all([

        sequelize.query(
            `SELECT st.student_id,
                    st.registration_number,
                    st.first_name,
                    st.last_name,
                    st.gender,
                    st.phone,
                    st.academic_status,
                    st.section_id,
                    st.current_semester_id,
                    sec.section_name,
                    p.program_id,
                    p.program_name,
                    d.department_id,
                    d.department_name,
                    b.batch_name,
                    sem.semester_number,
                    u.email
               FROM students st
          LEFT JOIN sections sec ON sec.section_id = st.section_id
          LEFT JOIN programs p ON p.program_id = st.program_id
          LEFT JOIN departments d ON d.department_id = p.department_id
          LEFT JOIN batches b ON b.batch_id = st.batch_id
          LEFT JOIN semesters sem ON sem.semester_id = st.current_semester_id
          LEFT JOIN users u ON u.user_id = st.user_id
              WHERE st.is_deleted = 0
                AND st.section_id IN (:sectionIds)
              ORDER BY st.registration_number`,
            { ...SELECT, replacements: { sectionIds } }
        ),

        // Scoped to this teacher's own subjects, so the percentage shown is
        // the student's attendance in *this teacher's* classes.
        sequelize.query(
            `SELECT a.student_id,
                    COUNT(*) AS total_sessions,
                    SUM(a.status = 'Present') AS present_count,
                    SUM(a.status = 'Late') AS late_count,
                    SUM(a.status = 'Absent') AS absent_count,
                    SUM(a.status = 'Leave') AS leave_count
               FROM attendance a
               JOIN students st ON st.student_id = a.student_id
              WHERE st.is_deleted = 0
                AND (a.subject_id, st.section_id) IN (:pairs)
              GROUP BY a.student_id`,
            { ...SELECT, replacements: { pairs } }
        ),

        sequelize.query(
            `SELECT m.student_id,
                    SUM(m.obtained_marks) AS obtained,
                    SUM(e.total_marks) AS total,
                    COUNT(*) AS exam_count
               FROM marks m
               JOIN exams e ON e.exam_id = m.exam_id
               JOIN students st ON st.student_id = m.student_id
              WHERE st.is_deleted = 0
                AND (e.subject_id, st.section_id) IN (:pairs)
              GROUP BY m.student_id`,
            { ...SELECT, replacements: { pairs } }
        ),

        // The published CGPA, newest result per student. The Students screen
        // had a CGPA column that was always blank because the loader never
        // read `results`.
        sequelize.query(
            `SELECT r.student_id, r.cgpa, r.gpa
               FROM results r
               JOIN (
                    SELECT student_id, MAX(result_id) AS latest
                      FROM results
                     GROUP BY student_id
               ) newest ON newest.latest = r.result_id
               JOIN students st ON st.student_id = r.student_id
              WHERE st.is_deleted = 0
                AND st.section_id IN (:sectionIds)`,
            { ...SELECT, replacements: { sectionIds } }
        ).catch(() => [])
    ]);

    const attById = new Map(attendance.map((r) => [r.student_id, r]));
    const marksById = new Map(marks.map((r) => [r.student_id, r]));
    const cgpaById = new Map(cgpa.map((r) => [r.student_id, r]));

    const students = rows.map((s) => {
        const att = attById.get(s.student_id) || null;
        const mk = marksById.get(s.student_id) || null;
        const gp = cgpaById.get(s.student_id) || null;

        const attended = att
            ? Number(att.present_count) + Number(att.late_count)
            : 0;

        return {
            student_id: s.student_id,
            registration_number: s.registration_number,
            full_name: [s.first_name, s.last_name].filter(Boolean).join(" "),
            first_name: s.first_name,
            last_name: s.last_name,
            gender: s.gender,
            phone: s.phone,
            email: s.email,
            academic_status: s.academic_status,
            section_id: s.section_id,
            section_name: s.section_name,
            program_id: s.program_id,
            program_name: s.program_name,
            department_id: s.department_id,
            department_name: s.department_name,
            batch_name: s.batch_name,
            semester_number: s.semester_number,
            current_semester_id: s.current_semester_id,
            cgpa: gp && gp.cgpa !== null ? Number(gp.cgpa) : null,
            gpa: gp && gp.gpa !== null ? Number(gp.gpa) : null,
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
    });

    const countBy = (key) => {
        const out = new Map();
        for (const s of students) {
            const value = s[key];
            if (value === null || value === undefined) continue;
            out.set(value, (out.get(value) || 0) + 1);
        }
        return [...out.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => String(a.value).localeCompare(String(b.value)));
    };

    const withAttendance = students.filter((s) => s.attendance && s.attendance.percentage !== null);

    return {
        students,
        totals: {
            students: students.length,
            sections: sectionIds.length,
            subjects: new Set(classes.map((c) => c.subject_id)).size,
            active: students.filter((s) => s.academic_status === "Active").length,
            with_attendance: withAttendance.length,
            average_attendance: withAttendance.length
                ? Math.round(
                    (withAttendance.reduce((sum, s) => sum + s.attendance.percentage, 0)
                        / withAttendance.length) * 10
                ) / 10
                : null,
            at_risk: withAttendance.filter((s) => s.attendance.percentage < 75).length
        },
        // The filter dropdowns, built from what is present rather than from a
        // hardcoded list.
        filters: {
            sections: countBy("section_name"),
            programs: countBy("program_name"),
            departments: countBy("department_name"),
            semesters: countBy("semester_number"),
            statuses: countBy("academic_status")
        }
    };
};

// ----------------------------------------------------------------- reports

/**
 * The report tables, generated on the server so the export and the screen can
 * never disagree, and so a report is not limited to whatever the browser had
 * already downloaded.
 *
 * Two of the old tabs are gone rather than kept as empty tables: Fee Reports,
 * because teachers are refused the fee endpoints by design, and the submission
 * columns of the assignment report, because aims_db has no submissions table —
 * an assignment's real record is the marks entered against it.
 */
const REPORT_TYPES = [
    "attendance",
    "marks",
    "grades",
    "assignments",
    "student-performance",
    "class-summary"
];

const getReport = async (teacher, { type, subject_id, section_id, date_from, date_to }) => {

    if (!REPORT_TYPES.includes(type)) {
        return { error: `type must be one of ${REPORT_TYPES.join(", ")}.` };
    }

    const classes = await getClasses(teacher.teacher_id);

    const selected = classes.filter(
        (c) => (!subject_id || Number(c.subject_id) === Number(subject_id))
            && (!section_id || Number(c.section_id) === Number(section_id))
    );

    if (!selected.length) {
        return { type, rows: [], generated_at: new Date().toISOString(), scope: null };
    }

    const pairs = selected.map((c) => [c.subject_id, c.section_id]);
    const sectionIds = [...new Set(selected.map((c) => c.section_id))];
    const grades = await gradingScale();

    const dateWhere = [];
    const dateReplacements = {};
    if (isoDate(date_from)) {
        dateWhere.push("a.att_date >= :dateFrom");
        dateReplacements.dateFrom = isoDate(date_from);
    }
    if (isoDate(date_to)) {
        dateWhere.push("a.att_date <= :dateTo");
        dateReplacements.dateTo = isoDate(date_to);
    }

    const scope = {
        classes: selected.map((c) => `${c.subject_code} · Sec ${c.section_name}`),
        students: selected.reduce((sum, c) => sum + c.student_count, 0),
        date_from: isoDate(date_from),
        date_to: isoDate(date_to)
    };

    const done = (rows) => ({
        type,
        rows,
        count: rows.length,
        scope,
        generated_at: new Date().toISOString(),
        teacher: [teacher.first_name, teacher.last_name].filter(Boolean).join(" ")
    });

    // ---------------------------------------------------------- attendance
    if (type === "attendance") {
        const rows = await sequelize.query(
            `SELECT st.student_id,
                    st.registration_number,
                    CONCAT(st.first_name, ' ', st.last_name) AS full_name,
                    sec.section_name,
                    sub.subject_code,
                    COUNT(*) AS total_sessions,
                    SUM(a.status = 'Present') AS present_count,
                    SUM(a.status = 'Absent') AS absent_count,
                    SUM(a.status = 'Late') AS late_count,
                    SUM(a.status = 'Leave') AS leave_count,
                    SUM(a.status = 'Holiday') AS holiday_count
               FROM attendance a
               JOIN students st ON st.student_id = a.student_id
          LEFT JOIN sections sec ON sec.section_id = st.section_id
               JOIN subjects sub ON sub.subject_id = a.subject_id
              WHERE st.is_deleted = 0
                AND (a.subject_id, st.section_id) IN (:pairs)
                ${dateWhere.length ? `AND ${dateWhere.join(" AND ")}` : ""}
              GROUP BY st.student_id, st.registration_number, st.first_name,
                       st.last_name, sec.section_name, sub.subject_code
              ORDER BY st.registration_number`,
            { ...SELECT, replacements: { pairs, ...dateReplacements } }
        );

        return done(rows.map((r) => {
            const attended = Number(r.present_count) + Number(r.late_count);
            const percentage = pct(attended, Number(r.total_sessions));
            return {
                id: `${r.student_id}-${r.subject_code}`,
                registration_number: r.registration_number,
                full_name: r.full_name,
                section_name: r.section_name,
                subject_code: r.subject_code,
                present: Number(r.present_count),
                absent: Number(r.absent_count),
                late: Number(r.late_count),
                leave: Number(r.leave_count),
                holiday: Number(r.holiday_count),
                total_sessions: Number(r.total_sessions),
                percentage,
                standing: percentage === null
                    ? "No records"
                    : percentage >= 75 ? "Meets requirement" : "Below requirement"
            };
        }));
    }

    // --------------------------------------------------------------- marks
    if (type === "marks") {
        const rows = await sequelize.query(
            `SELECT m.mark_id,
                    st.registration_number,
                    CONCAT(st.first_name, ' ', st.last_name) AS full_name,
                    sec.section_name,
                    sub.subject_code,
                    sub.subject_name,
                    e.exam_name,
                    e.exam_type,
                    e.exam_date,
                    e.total_marks,
                    m.obtained_marks,
                    m.status,
                    CONCAT(ee.first_name, ' ', ee.last_name) AS entered_by_name
               FROM marks m
               JOIN exams e ON e.exam_id = m.exam_id
               JOIN subjects sub ON sub.subject_id = e.subject_id
               JOIN students st ON st.student_id = m.student_id
          LEFT JOIN sections sec ON sec.section_id = st.section_id
          LEFT JOIN teachers t ON t.teacher_id = m.entered_by
          LEFT JOIN employees ee ON ee.employee_id = t.employee_id
              WHERE st.is_deleted = 0
                AND (e.subject_id, st.section_id) IN (:pairs)
              ORDER BY e.exam_date DESC, st.registration_number`,
            { ...SELECT, replacements: { pairs } }
        );

        return done(rows.map((r) => {
            const percentage = pct(Number(r.obtained_marks), Number(r.total_marks));
            const grade = gradeFor(grades, percentage);
            return {
                id: r.mark_id,
                registration_number: r.registration_number,
                full_name: r.full_name,
                section_name: r.section_name,
                subject: `${r.subject_code} ${r.subject_name}`,
                exam_name: r.exam_name,
                exam_type: r.exam_type,
                exam_date: isoDate(r.exam_date),
                obtained_marks: Number(r.obtained_marks),
                total_marks: Number(r.total_marks),
                percentage,
                grade: grade ? grade.letter : "—",
                status: r.status,
                entered_by_name: r.entered_by_name
            };
        }));
    }

    // -------------------------------------------------------------- grades
    if (type === "grades") {
        const rows = await sequelize.query(
            `SELECT st.student_id,
                    st.registration_number,
                    CONCAT(st.first_name, ' ', st.last_name) AS full_name,
                    sec.section_name,
                    COUNT(*) AS exams_taken,
                    SUM(m.obtained_marks) AS obtained,
                    SUM(e.total_marks) AS total
               FROM marks m
               JOIN exams e ON e.exam_id = m.exam_id
               JOIN students st ON st.student_id = m.student_id
          LEFT JOIN sections sec ON sec.section_id = st.section_id
              WHERE st.is_deleted = 0
                AND (e.subject_id, st.section_id) IN (:pairs)
              GROUP BY st.student_id, st.registration_number, st.first_name,
                       st.last_name, sec.section_name
              ORDER BY st.registration_number`,
            { ...SELECT, replacements: { pairs } }
        );

        return done(rows.map((r) => {
            const percentage = pct(Number(r.obtained), Number(r.total));
            const grade = gradeFor(grades, percentage);
            return {
                id: r.student_id,
                registration_number: r.registration_number,
                full_name: r.full_name,
                section_name: r.section_name,
                exams_taken: Number(r.exams_taken),
                obtained: Number(r.obtained),
                total: Number(r.total),
                percentage,
                grade: grade ? grade.letter : "—",
                grade_point: grade ? grade.point : null,
                result: grade && grade.point > 0 ? "Pass" : "Fail"
            };
        }));
    }

    // ---------------------------------------------------------- assignments
    // Assignments are `exams` rows with exam_type = 'Assignment'. There is no
    // submissions table, so the honest measure of progress is how many of the
    // section's students have a mark against the assignment.
    if (type === "assignments") {
        const subjectIds = [...new Set(selected.map((c) => c.subject_id))];

        const [exams, counts] = await Promise.all([
            sequelize.query(
                `SELECT e.exam_id, e.exam_name, e.exam_type, e.exam_date,
                        e.total_marks, e.subject_id,
                        sub.subject_code, sub.subject_name
                   FROM exams e
                   JOIN subjects sub ON sub.subject_id = e.subject_id
                  WHERE e.subject_id IN (:subjectIds)
                    AND e.exam_type IN ('Assignment', 'Quiz', 'Practical')
                  ORDER BY e.exam_date DESC`,
                { ...SELECT, replacements: { subjectIds } }
            ),
            sequelize.query(
                `SELECT m.exam_id,
                        st.section_id,
                        COUNT(*) AS marked,
                        SUM(m.obtained_marks) AS obtained,
                        SUM(e.total_marks) AS total
                   FROM marks m
                   JOIN exams e ON e.exam_id = m.exam_id
                   JOIN students st ON st.student_id = m.student_id
                  WHERE st.is_deleted = 0
                    AND (e.subject_id, st.section_id) IN (:pairs)
                  GROUP BY m.exam_id, st.section_id`,
                { ...SELECT, replacements: { pairs } }
            )
        ]);

        const countsByKey = new Map(
            counts.map((r) => [`${r.exam_id}:${r.section_id}`, r])
        );

        const rows = [];

        for (const exam of exams) {
            for (const klass of selected.filter((c) => c.subject_id === exam.subject_id)) {
                const hit = countsByKey.get(`${exam.exam_id}:${klass.section_id}`) || null;
                const marked = hit ? Number(hit.marked) : 0;
                rows.push({
                    id: `${exam.exam_id}-${klass.section_id}`,
                    exam_name: exam.exam_name,
                    exam_type: exam.exam_type,
                    subject_code: exam.subject_code,
                    section_name: klass.section_name,
                    exam_date: isoDate(exam.exam_date),
                    total_marks: Number(exam.total_marks),
                    students: klass.student_count,
                    marked,
                    pending: Math.max(0, klass.student_count - marked),
                    completion: klass.student_count
                        ? Math.round((marked / klass.student_count) * 100)
                        : 0,
                    average_percentage: hit
                        ? pct(Number(hit.obtained), Number(hit.total))
                        : null
                });
            }
        }

        return done(rows);
    }

    // ------------------------------------------------- student performance
    if (type === "student-performance") {
        const { students } = await getStudents(teacher.teacher_id);

        const inScope = students.filter((s) => sectionIds.includes(s.section_id));

        return done(inScope.map((s) => {
            const grade = gradeFor(grades, s.marks ? s.marks.percentage : null);
            const attendance = s.attendance ? s.attendance.percentage : null;

            return {
                id: s.student_id,
                registration_number: s.registration_number,
                full_name: s.full_name,
                section_name: s.section_name,
                program_name: s.program_name,
                semester_number: s.semester_number,
                attendance_percentage: attendance,
                marks_percentage: s.marks ? s.marks.percentage : null,
                exams_taken: s.marks ? s.marks.exam_count : 0,
                cgpa: s.cgpa,
                grade: grade ? grade.letter : "—",
                tier: attendance === null
                    ? "No data"
                    : attendance >= 80 && (s.marks?.percentage ?? 0) >= 60
                        ? "Good"
                        : attendance >= 60 ? "Average" : "At Risk"
            };
        }));
    }

    // ------------------------------------------------------- class summary
    const marksByClass = await sequelize.query(
        `SELECT e.subject_id, st.section_id,
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

    const marksMap = new Map(
        marksByClass.map((r) => [classKey(r.subject_id, r.section_id), r])
    );

    return done(selected.map((c) => {
        const mk = marksMap.get(c.key) || null;
        const marksPct = mk ? pct(Number(mk.obtained), Number(mk.total)) : null;
        const grade = gradeFor(grades, marksPct);

        return {
            id: c.key,
            subject_code: c.subject_code,
            subject_name: c.subject_name,
            section_name: c.section_name,
            program_name: c.program_name,
            semester_number: c.semester_number,
            credit_hours: c.credit_hours,
            students: c.student_count,
            weekly_slots: c.slots.length,
            attendance_percentage: c.attendance ? c.attendance.percentage : null,
            attendance_records: c.attendance ? c.attendance.totalSessions : 0,
            graded_students: mk ? Number(mk.graded_students) : 0,
            marks_percentage: marksPct,
            class_grade: grade ? grade.letter : "—"
        };
    }));
};

module.exports = {
    REPORT_TYPES,
    getExams,
    createExam,
    getMarksSheet,
    saveMarks,
    getStudents,
    getReport
};
