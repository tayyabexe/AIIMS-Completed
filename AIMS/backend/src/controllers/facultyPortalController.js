// HTTP layer for the teacher portal's Dashboard, My Classes and Attendance
// screens. Every handler resolves the teacher from the token first, so no
// route takes a teacher id from the client except for an Admin explicitly
// viewing a named teacher's portal.

const facultyPortal = require("../services/facultyPortalService");
const facultyAcademics = require("../services/facultyAcademicsService");
const userPreferences = require("../services/userPreferenceService");
const audit = require("../services/auditService");

// Resolves the caller, or answers 403 and returns null.
const requireTeacher = async (req, res) => {

    const teacher = await facultyPortal.resolveTeacher(
        req.user,
        req.query.teacher_id
    );

    if (!teacher) {
        res.status(403).json({
            success: false,
            message: "No teacher record is linked to this account."
        });
        return null;
    }

    return teacher;
};

const fail = (res, error) => {
    console.error(error);
    return res.status(500).json({
        success: false,
        message: "Internal Server Error"
    });
};

// ================= GET /api/faculty/dashboard =================

const getDashboard = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const dashboard = await facultyPortal.getDashboard(teacher);

        return res.status(200).json({ success: true, data: dashboard });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/classes =================

const getClasses = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const classes = await facultyPortal.getClasses(teacher.teacher_id);

        return res.status(200).json({
            success: true,
            count: classes.length,
            teacher: {
                teacher_id: teacher.teacher_id,
                full_name: [teacher.first_name, teacher.last_name]
                    .filter(Boolean).join(" "),
                department_name: teacher.department_name
            },
            data: classes
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/classes/:subjectId/:sectionId =================

const getClassRoster = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const klass = await facultyPortal.getClassRoster(
            teacher.teacher_id,
            req.params.subjectId,
            req.params.sectionId
        );

        // Not "not found": the class may well exist, it is simply not one this
        // teacher is timetabled for.
        if (!klass) {
            return res.status(403).json({
                success: false,
                message: "You are not assigned to this class."
            });
        }

        return res.status(200).json({ success: true, data: klass });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/attendance =================

const getAttendanceSheet = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        // `timetable_id` names WHICH PERIOD's register to open. A class that
        // meets twice on the same weekday has two registers that day, and
        // before this the second one could not be reached at all.
        const { subject_id, section_id, att_date, timetable_id } = req.query;

        if (!subject_id || !section_id) {
            return res.status(400).json({
                success: false,
                message: "subject_id and section_id are required."
            });
        }

        const sheet = await facultyPortal.getAttendanceSheet(
            teacher.teacher_id,
            subject_id,
            section_id,
            att_date,
            timetable_id
        );

        if (!sheet) {
            return res.status(403).json({
                success: false,
                message: "You are not assigned to this class."
            });
        }

        return res.status(200).json({ success: true, data: sheet });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= POST /api/faculty/attendance =================

const saveAttendance = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const { subject_id, section_id, att_date, timetable_id, records } = req.body;

        if (!subject_id || !section_id) {
            return res.status(400).json({
                success: false,
                message: "subject_id and section_id are required."
            });
        }

        if (!Array.isArray(records) || !records.length) {
            return res.status(400).json({
                success: false,
                message: "records must be a non-empty array."
            });
        }

        const result = await facultyPortal.saveAttendance(teacher, {
            subject_id,
            section_id,
            att_date,
            timetable_id,
            records
        });

        if (result.error === "forbidden") {
            return res.status(403).json({
                success: false,
                message: "You are not assigned to this class."
            });
        }

        if (result.error) {
            return res.status(400).json({
                success: false,
                message: result.error
            });
        }

        /*
         * One entry per register, not per student. A teacher marking a section
         * of forty is one act and reads as one line — the count is what makes
         * it meaningful, and the per-student detail is in the attendance table
         * itself, which this row points at.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ATTENDANCE_MARKED,
            module: audit.MODULES.ATTENDANCE,
            entity: `sections#${section_id}`,
            after: {
                subjectId: Number(subject_id),
                subjectName: result.subject_name ?? null,
                sectionId: Number(section_id),
                sectionName: result.section_name ?? null,
                date: att_date ?? null,
                created: result.created,
                updated: result.updated,
                count: result.created + result.updated,
                teacherId: teacher.teacher_id
            },
            req
        });

        return res.status(200).json({
            success: true,
            message: `Attendance saved for ${result.created + result.updated} students.`,
            data: result
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/attendance/trend =================

const getAttendanceTrend = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const trend = await facultyPortal.getAttendanceTrend(
            teacher.teacher_id,
            req.query
        );

        return res.status(200).json({ success: true, data: trend });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/notifications =================

const getNotifications = async (req, res) => {
    try {
        // Not gated on a teacher record: the feed is the account's own
        // notifications plus the announcements addressed to their role.
        const feed = await facultyPortal.getNotificationFeed(
            req.user,
            req.query.limit
        );

        return res.status(200).json({
            success: true,
            count: feed.items.length,
            unread: feed.unread,
            data: feed.items
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/activity =================

const getActivity = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const items = await facultyPortal.getActivity(teacher, req.query.limit);

        return res.status(200).json({
            success: true,
            count: items.length,
            data: items
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/exams =================

const getExams = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const exams = await facultyAcademics.getExams(teacher.teacher_id, req.query);

        return res.status(200).json({
            success: true,
            count: exams.length,
            data: exams
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= POST /api/faculty/exams =================

const createExam = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const result = await facultyAcademics.createExam(teacher, req.body);

        if (result.error === "forbidden") {
            return res.status(403).json({
                success: false,
                message: "You do not teach this subject."
            });
        }

        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.EXAM_CREATED,
            module: audit.MODULES.EXAMS,
            entity: `exams#${result.exam_id ?? result.examId ?? ""}`,
            after: {
                examId: result.exam_id ?? result.examId ?? null,
                examTitle: result.exam_name ?? result.examName ?? null,
                subjectId: result.subject_id ?? null,
                examDate: result.exam_date ?? null,
                totalMarks: result.total_marks ?? null,
                teacherId: teacher.teacher_id
            },
            req
        });

        return res.status(201).json({
            success: true,
            message: "Exam created.",
            data: result
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/marks =================

const getMarksSheet = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const { exam_id, section_id } = req.query;

        if (!exam_id || !section_id) {
            return res.status(400).json({
                success: false,
                message: "exam_id and section_id are required."
            });
        }

        const sheet = await facultyAcademics.getMarksSheet(
            teacher.teacher_id,
            exam_id,
            section_id
        );

        if (sheet.error === "not_found") {
            return res.status(404).json({ success: false, message: "Exam not found." });
        }

        if (sheet.error === "forbidden") {
            return res.status(403).json({
                success: false,
                message: "You are not assigned to this class."
            });
        }

        return res.status(200).json({ success: true, data: sheet });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= POST /api/faculty/marks =================

const saveMarks = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const { exam_id, section_id, records } = req.body;

        if (!exam_id || !section_id) {
            return res.status(400).json({
                success: false,
                message: "exam_id and section_id are required."
            });
        }

        if (!Array.isArray(records) || !records.length) {
            return res.status(400).json({
                success: false,
                message: "records must be a non-empty array."
            });
        }

        const result = await facultyAcademics.saveMarks(teacher, req.body);

        if (result.error === "not_found") {
            return res.status(404).json({ success: false, message: "Exam not found." });
        }

        if (result.error === "forbidden") {
            return res.status(403).json({
                success: false,
                message: "You are not assigned to this class."
            });
        }

        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }

        /*
         * THE entry this trail was extended for.
         *
         * A teacher changing a mark is the single most consequential act in the
         * portal that an administrator cannot otherwise see: the marks table
         * keeps `entered_by`, but it keeps only the LATEST one, so a score
         * raised after publication overwrote every trace of what it had been.
         *
         * `count` is what makes the row readable at a glance — a section sheet
         * is one save, not forty.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: result.updated > 0
                ? audit.ACTIONS.MARKS_UPDATED
                : audit.ACTIONS.MARKS_ENTERED,
            module: audit.MODULES.EXAMS,
            entity: `exams#${result.context?.examId ?? exam_id}`,
            after: {
                ...result.context,
                created: result.created,
                updated: result.updated,
                count: result.created + result.updated,
                status: result.status,
                // Rows this save did not take because an admin had already
                // released them. Worth the trail: "38 saved" and "38 saved,
                // 2 already released" are different events.
                skippedAsPublished: result.lockedCount || 0,
                teacherId: teacher.teacher_id
            },
            req
        });

        const saved = result.created + result.updated;

        /*
         * The message says which of the two things happened, because they are
         * no longer the same thing: Draft is work in progress, Verified is
         * "submitted, waiting on an administrator to release it". A teacher who
         * presses Submit is entitled to know their marks are not on the
         * student's screen yet.
         */
        const message = result.status === "Verified"
            ? `${saved} mark${saved === 1 ? "" : "s"} submitted for approval. `
              + "An administrator releases them to students when the semester result is published."
            : `${saved} mark${saved === 1 ? "" : "s"} saved as a draft. Not visible to students.`;

        return res.status(200).json({
            success: true,
            message: result.lockedCount
                ? `${message} ${result.lockedCount} already-released `
                  + `mark${result.lockedCount === 1 ? " was" : "s were"} left unchanged.`
                : message,
            data: result
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/students =================

const getStudents = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const result = await facultyAcademics.getStudents(teacher.teacher_id);

        return res.status(200).json({
            success: true,
            count: result.students.length,
            totals: result.totals,
            filters: result.filters,
            data: result.students
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/reports =================

const getReport = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const report = await facultyAcademics.getReport(teacher, req.query);

        if (report.error) {
            return res.status(400).json({ success: false, message: report.error });
        }

        return res.status(200).json({ success: true, data: report });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/profile =================

const getProfile = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const profile = await facultyPortal.getProfile(teacher);

        return res.status(200).json({ success: true, data: profile });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= PUT /api/faculty/profile =================

const updateProfile = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        // An Admin viewing a teacher's portal with ?teacher_id= is reading it,
        // not standing in for them; HR edits belong on PUT /api/teachers/:id.
        if (req.user.user_id !== teacher.user_id) {
            return res.status(403).json({
                success: false,
                message: "You can only edit your own profile."
            });
        }

        const result = await facultyPortal.updateProfile(teacher, req.body);

        if (result.error) {
            return res.status(result.status || 400).json({
                success: false,
                message: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: "Profile updated",
            data: result.profile
        });

    } catch (error) {
        return fail(res, error);
    }
};

// ================= GET /api/faculty/badges =================
//
// The unread/new counts behind the sidebar bubbles, in one call so the shell
// does not need a request per module.

const getBadges = async (req, res) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return undefined;

        const preferences = await userPreferences.getPreferences(req.user.user_id);
        const badges = await facultyPortal.getBadges(teacher, req.user, preferences);

        return res.status(200).json({ success: true, data: badges });

    } catch (error) {
        return fail(res, error);
    }
};

module.exports = {
    getDashboard,
    getNotifications,
    getActivity,
    getClasses,
    getClassRoster,
    getAttendanceSheet,
    saveAttendance,
    getAttendanceTrend,
    getExams,
    createExam,
    getMarksSheet,
    saveMarks,
    getStudents,
    getReport,
    getProfile,
    updateProfile,
    getBadges
};
