/*
 * One handler per admin portal screen.
 *
 * These are thin: the whole point of the module is that the shaping happens in
 * SQL, so a controller here only unwraps the request and wraps the response.
 */

const service = require("../services/adminPortalService");
const provisioning = require("../services/provisioningService");
const audit = require("../services/auditService");
const notify = require("../services/notificationService");

// Every handler has the same shape, so the try/catch lives in one place rather
// than being copied eleven times.
const handler = (name, load) => async (req, res) => {
    try {
        const data = await load(req);
        return res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error(`[admin/${name}]`, error);
        return res.status(500).json({
            success: false,
            message: `Failed to load ${name}`
        });
    }
};

const getDashboard = handler("dashboard", () => service.getDashboard());

const getStudents = handler("students", (req) => service.getStudentsPage(req.query));

const exportStudents = handler("students export", (req) => service.exportStudents(req.query));

const getStudentProfile = async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: "A numeric student id is required"
        });
    }

    try {
        const student = await service.getStudentProfile(id);

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        return res.status(200).json({ success: true, student });

    } catch (error) {
        console.error("[admin/student-profile]", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load student profile"
        });
    }
};

/*
 * How many students sit in each department, programme, batch, section and
 * semester — every level in one response, so they always add up. Filters:
 * department_id, program_id, batch_id, section_id, semester_id.
 *
 * The roster behind any of those numbers is GET /api/admin/students with the
 * same filters, which is why there is no second endpoint here: one list of
 * students, one set of filters, and a count that is guaranteed to describe the
 * rows the drill-down returns.
 */
const getEnrollment = handler("enrolment", (req) => service.getEnrollmentOverview(req.query));

const getAttendance = handler("attendance", (req) => service.getAttendancePage(req.query));
const getFees = handler("fees", (req) => service.getFeesPage(req.query));
const getExamination = handler("examination", (req) => service.getExaminationPage(req.query));
const getParents = handler("parents", (req) => service.getParentsPage(req.query));
const getTeachers = handler("teachers", (req) => service.getTeachersPage(req.query));
const getAiAnalytics = handler("ai-analytics", (req) => service.getAiAnalytics(req.query));
const getReports = handler("reports", () => service.getReports());
const getActivity = handler("activity", (req) => service.getActivity(req.query));

// The audit trail. Read-only by construction: there is no route that edits or
// deletes an entry, because a record an administrator can rewrite is not one.
const getAuditLogs = handler("audit log", (req) => audit.list(req.query));

/*
 * ------------------------------------------------------------ provisioning
 *
 * These three are the only writes in this module, and they exist here rather
 * than on /api/students and /api/teachers because they are not "insert a row" —
 * each one creates a person, their login, and in the student's case their
 * parent and the link between them, in a single transaction.
 *
 * All three return a plaintext password in their response. That is the whole
 * point: it is the only moment it exists in readable form. Nothing logs the
 * response body, and no GET endpoint can retrieve it afterwards.
 */

const admitStudent = async (req, res) => {
    const { first_name, last_name, cnic_bform, program_id, batch_id } = req.body;

    const missing = Object.entries({ first_name, last_name, cnic_bform, program_id, batch_id })
        .filter(([, value]) => value === undefined || value === null || value === "")
        .map(([key]) => key);

    if (missing.length) {
        return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missing.join(", ")}`
        });
    }

    // A parent is optional, but a half-specified one is a mistake worth
    // catching before the transaction opens.
    const parent = req.body.parent;
    if (parent && (parent.email || parent.first_name)) {
        if (!parent.email || !parent.first_name || !parent.last_name) {
            return res.status(400).json({
                success: false,
                message: "A parent needs first name, last name and email."
            });
        }
    }

    try {
        const result = await provisioning.admitStudent(req.body, req.user?.user_id);

        /*
         * Recorded AFTER the transaction commits, so an entry exists only for an
         * admission that actually happened. The plaintext passwords in `result`
         * are stripped by auditService before the row is written — what is kept
         * is who was created, by whom, and whether the guardian was a new
         * account or an existing one being linked to another child.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.STUDENT_ADMITTED,
            module: audit.MODULES.PROVISIONING,
            entity: `students#${result.student.studentId}`,
            after: {
                student: {
                    studentId: result.student.studentId,
                    userId: result.student.userId,
                    registrationNumber: result.student.registrationNumber,
                    name: result.student.name,
                    email: result.student.email,
                    programId: req.body.program_id,
                    batchId: req.body.batch_id
                },
                parent: result.parent ? {
                    parentId: result.parent.parentId,
                    userId: result.parent.userId,
                    email: result.parent.email,
                    // The distinction the admin needs later: a linked parent
                    // kept their existing password, a created one did not.
                    accountCreated: result.parent.created
                } : null
            },
            req
        });

        /*
         * Admission emits to the two accounts it just created, separately rather
         * than through notifyStudent: the guardian's row is only correct when a
         * guardian account was actually created, and a parent LINKED to a second
         * child kept their existing password, so the two sentences differ.
         */
        await notify.emit({
            audience: await notify.userAudience(result.student.userId),
            type: notify.TYPES.REGISTRATION,
            subject: "courses",
            title: "Welcome to AIMS",
            message: `You are enrolled with registration number `
                + `${result.student.registrationNumber}.`
        });

        if (result.parent?.userId) {
            await notify.emit({
                audience: await notify.userAudience(result.parent.userId),
                type: notify.TYPES.REGISTRATION,
                subject: "profile",
                title: result.parent.created ? "Guardian account created" : "Child linked",
                message: `${result.student.name} (${result.student.registrationNumber}) `
                    + "is linked to your account."
            });
        }

        return res.status(201).json({
            success: true,
            message: "Student admitted and accounts created.",
            ...result
        });

    } catch (error) {
        console.error("[admin/admit-student]", error);

        // A supplied registration number that is malformed (400) or already
        // taken (409) is the caller's mistake, and bulk import reports it
        // against the CSV line it came from — so the real reason has to survive.
        if (error.status === 400 || error.status === 409) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({
                success: false,
                message: "That registration number, CNIC or email is already in use."
            });
        }

        return res.status(500).json({ success: false, message: "Could not admit the student." });
    }
};

const onboardTeacher = async (req, res) => {
    const { first_name, last_name } = req.body;

    if (!first_name || !last_name) {
        return res.status(400).json({
            success: false,
            message: "A teacher needs a first and last name."
        });
    }

    try {
        const result = await provisioning.onboardTeacher(req.body);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.TEACHER_ONBOARDED,
            module: audit.MODULES.PROVISIONING,
            entity: `teachers#${result.teacher.teacherId}`,
            after: {
                teacherId: result.teacher.teacherId,
                employeeId: result.teacher.employeeId,
                userId: result.teacher.userId,
                employeeCode: result.teacher.employeeCode,
                name: result.teacher.name,
                email: result.teacher.email,
                departmentId: req.body.department_id ?? null,
                designation: req.body.designation ?? null,
                assignmentCount: result.teacher.assignmentCount
            },
            req
        });

        // The first thing in a new teacher's feed, waiting for them when they
        // first sign in. Their subject assignments are the other half of
        // onboarding, so the notice points at the classes screen.
        await notify.emit({
            audience: await notify.userAudience(result.teacher.userId),
            type: notify.TYPES.HR,
            subject: "courses",
            title: "Welcome to AIMS",
            message: `Your faculty account is active (${result.teacher.employeeCode}). `
                + "Your assigned classes are on the My Classes screen."
        });

        return res.status(201).json({
            success: true,
            message: "Teacher created and account issued.",
            ...result
        });

    } catch (error) {
        console.error("[admin/onboard-teacher]", error);

        if (error.status === 409) {
            return res.status(409).json({ success: false, message: error.message });
        }

        return res.status(500).json({ success: false, message: "Could not create the teacher." });
    }
};

const reissueCredentials = async (req, res) => {
    const userId = Number.parseInt(req.params.userId, 10);

    if (!Number.isInteger(userId) || userId < 1) {
        return res.status(400).json({ success: false, message: "A numeric user id is required." });
    }

    try {
        const result = await provisioning.reissueCredentials(userId);

        if (!result) {
            return res.status(404).json({ success: false, message: "Account not found." });
        }

        /*
         * The single most important entry in this table.
         *
         * Reissuing replaces someone's password with one an administrator has
         * just read off their own screen. Without a record of it, an admin can
         * take over any account in the institute and leave no trace — the
         * account holder would only see that their password stopped working.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.CREDENTIALS_REISSUED,
            module: audit.MODULES.PROVISIONING,
            entity: `users#${result.userId}`,
            after: {
                targetUserId: result.userId,
                targetEmail: result.email,
                targetRole: result.role,
                mustChangePassword: true
            },
            req
        });

        /*
         * The account holder's own copy of the entry above.
         *
         * The audit row answers "which admin did this" for an investigator. This
         * answers "did I ask for this" for the person it was done to — who
         * otherwise learns about it only by finding their password no longer
         * works, which is indistinguishable from a takeover. The new password is
         * never in here; it is shown once on the admin's screen and handed over
         * out of band.
         *
         * No `actorUserId`: the recipient is the target, never the admin, so
         * there is nothing to suppress.
         */
        await notify.emit({
            audience: await notify.userAudience(result.userId),
            type: notify.TYPES.ACCOUNT,
            priority: notify.PRIORITY.HIGH,
            subject: "account",
            title: "New password issued",
            message: "An administrator has issued a new password for your account. "
                + "You will be asked to change it at your next sign-in."
        });

        return res.status(200).json({
            success: true,
            message: "New password issued. It is shown once and cannot be retrieved again.",
            credentials: result
        });

    } catch (error) {
        console.error("[admin/reissue-credentials]", error);
        return res.status(500).json({ success: false, message: "Could not issue new credentials." });
    }
};

module.exports = {
    getDashboard,
    getStudents,
    exportStudents,
    getStudentProfile,
    admitStudent,
    onboardTeacher,
    reissueCredentials,
    getAttendance,
    getEnrollment,
    getFees,
    getExamination,
    getParents,
    getTeachers,
    getAiAnalytics,
    getReports,
    getActivity,
    getAuditLogs
};
