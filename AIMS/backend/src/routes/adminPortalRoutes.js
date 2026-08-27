/*
 * The admin portal's own read surface: one route per screen.
 *
 * Everything here is Admin / Super Admin only. Writes over ordinary resources
 * stay on the existing routes (/api/students, /api/teachers,
 * /api/announcements and so on) — this module exists to stop each screen
 * downloading the whole database.
 *
 * The exceptions are the provisioning routes at the bottom and the people CRUD
 * beneath them, and both are exceptions for the same reason: they act on a
 * person across several tables at once (a login plus an employee record, a
 * parent plus their guardian links), so there is no single resource route they
 * could belong to.
 */

const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS } = require("../config/roles");

const {
    getDashboard,
    getStudents,
    exportStudents,
    getStudentProfile,
    getAttendance,
    getEnrollment,
    getFees,
    getExamination,
    getParents,
    getTeachers,
    getAiAnalytics,
    getReports,
    getActivity,
    getAuditLogs,
    admitStudent,
    onboardTeacher,
    reissueCredentials
} = require("../controllers/adminPortalController");

const { cached, TAGS, TTL } = require("../middlewares/cache.middleware");

const people = require("../controllers/peopleAdminController");

// Applied once rather than per route, so a route added later cannot be
// accidentally left unguarded.
router.use(authenticate, authorize(...ADMINS));

/*
 * Stat tiles only. A few hundred bytes regardless of institute size — but the
 * bytes are not the cost. Behind them are multi-join aggregates over students,
 * fees and attendance, re-run in full every time an admin reloads the tab or
 * navigates back to the dashboard.
 *
 * Cached on the 60-second AGGREGATE ttl, not the 10-minute reference one. A
 * dashboard is expected to be roughly current, and an admin who admits a
 * student and returns to the dashboard should see the count move — sixty
 * seconds is short enough that they will, and academic-structure writes drop
 * these entries by tag immediately anyway.
 *
 * Scoped per ROLE rather than per user: the figures are institute-wide and
 * identical for every admin, so keying by user id would give each of them a
 * private copy of the same numbers and cut the hit rate for nothing. Not
 * global — Admin and Super Admin are both here, and the response is allowed to
 * differ between them.
 */
router.get(
    "/dashboard",
    cached({ ttl: TTL.AGGREGATE, tags: [TAGS.DASHBOARD], scope: "role" }),
    getDashboard
);

/*
 * The dashboard's activity feed (announcements, payments, results, enrolments).
 *
 * Deliberately on the SHORT ttl rather than AGGREGATE: this is a feed of
 * things that just happened, and it is the one place on the dashboard where
 * being a minute behind is noticeable — a payment approved moments ago should
 * appear. Fifteen seconds damps a reload storm without the feed reading as
 * stale.
 */
router.get(
    "/activity",
    cached({ ttl: TTL.SHORT, tags: [TAGS.DASHBOARD], scope: "role" }),
    getActivity
);

// Students list. Filters: q, program_id, batch_id, section_id, semester_id,
// status, page, limit.
router.get("/students", getStudents);

// Every student matching the current filters, for the CSV / PDF / ID-card
// exports. Declared BEFORE /students/:id or "export" would be read as an id.
router.get("/students/export", exportStudents);

// One student's full profile.
router.get("/students/:id", getStudentProfile);

/*
 * Enrolment counts by department, programme, batch, section and semester — all
 * five levels in one response so they cannot disagree with each other. Filters:
 * department_id, program_id, batch_id, section_id, semester_id.
 *
 * The students behind any figure come from /students with the same filters.
 */
router.get("/enrollment", getEnrollment);

// Attendance register summary. Extra filters: risk=low|good, sort=attendance.
router.get("/attendance", getAttendance);

// Fee table, totals, category distribution and monthly collection.
// Extra filters: fee_status=Paid|Partial|Unpaid|Overdue, sort=due.
router.get("/fees", getFees);

// Exam standing, grade distribution and per-programme aggregates.
router.get("/examination", getExamination);

// Parents with their linked children. Filter: q.
router.get("/parents", getParents);

// Teacher directory with real weekly load. Filters: q, department_id.
router.get("/teachers", getTeachers);

/*
 * Risk cohorts and the named at-risk students.
 *
 * Cached for the same reason and on the same terms as /dashboard above: it is
 * a multi-join aggregate over every student, every fee voucher, every mark and
 * every attendance session, and the AI Insights screen re-ran the whole thing
 * on every open, every navigation back to the tab, and every refresh.
 * Uncached it cost 2.5 seconds a time; served from the cache it is immediate.
 *
 * Nothing here is a figure whose staleness would read as a WRONG number in the
 * sense utils/cache.js warns about — there is no balance to settle and no mark
 * to correct on this screen. It is a statistical picture of the institute, and
 * a picture up to a minute old is what the screen already was: the query took
 * long enough that the figures were seconds stale by the time they were drawn.
 *
 * The DASHBOARD and STUDENTS tags mean an admission, an edit or a withdrawal
 * drops this entry immediately rather than leaving it to the TTL, because
 * studentRoutes flushes both — so the cohort counts move when the student body
 * does, which is the only case where a minute would have been noticeable.
 */
router.get(
    "/ai-analytics",
    cached({
        ttl: TTL.AGGREGATE,
        tags: [TAGS.DASHBOARD, TAGS.STUDENTS],
        // 'role' rather than 'user': every admin sees the same institute-wide
        // figures, and the response depends on no property of the caller.
        scope: "role"
    }),
    getAiAnalytics
);

// Institute-wide reporting aggregates.
router.get("/reports", getReports);

/*
 * The audit trail: who created which account, who issued which password, who
 * approved which payment.
 *
 * Filters: module, action, user_id, from, to, page, limit.
 *
 * There is no POST, PUT or DELETE counterpart, and that is the point — entries
 * are written by the services that perform the acts, and nothing in the API can
 * amend or remove one afterwards.
 */
router.get("/audit-logs", getAuditLogs);

/*
 * ------------------------------------------------------------ provisioning
 *
 * The three write routes in this module. Each creates a person AND the login
 * they need, in one transaction, and returns a generated password exactly once.
 *
 * They are POSTs under /api/admin rather than on /api/students and
 * /api/teachers because they are not row inserts — admitting a student also
 * creates their user account, their parent's account and the guardian link
 * between them. Splitting that across the existing resource routes is what let
 * two students end up in the database with no login at all.
 */

// Admit a student: generates the registration number, creates the student's
// login, creates or links the parent, and returns both sets of credentials.
router.post("/students/admit", admitStudent);

// Onboard a teacher: creates users + employees + teachers rows and any class
// assignments, and returns the teacher's credentials.
router.post("/teachers/onboard", onboardTeacher);

// Issue a NEW password for an existing account, for when the one-time popup
// was lost. The old password cannot be retrieved — only replaced.
router.post("/credentials/:userId/reissue", reissueCredentials);

/*
 * ------------------------------------------------------------- people CRUD
 *
 * Staff accounts and parents. See peopleAdminService for what each guard is
 * for; the short version is that these two are the only people in the system
 * nothing could amend or remove, and the consequences were visible in the data:
 * eight administrators called admin1@ … admin100@ with no name attached, and a
 * guardian link that could be created by an admission and never corrected.
 *
 * `authorize(...ADMINS)` at the top of this file covers them. The finer rules —
 * that only a Super Admin may touch a Super Admin row, and that nobody may
 * delete their own account — cannot be expressed as a role list, because they
 * depend on which row is being changed, so they live in the service.
 */

// Every staff account: Super Admin, Admin, HR, Accountant and Library Staff.
// Filters: q, role_id, is_active.
router.get("/admins", people.listAdmins);

// Creates the login and, when a department is named, the staff record that
// holds the person's name. Returns the password exactly once.
router.post("/admins", people.createAdmin);

router.put("/admins/:userId", people.updateAdmin);

// Soft-deletes the row AND disables the login — both, always. See the service.
router.delete("/admins/:userId", people.deleteAdmin);

/*
 * Parents. The list is GET /parents above, which already returns them with
 * their children; these are the writes it never had.
 */
router.post("/parents", people.createParent);
router.put("/parents/:id", people.updateParent);

// Refuses while children are still linked, and names them.
router.delete("/parents/:id", people.deleteParent);

// The guardian link itself — the thing an admission writes once and nothing
// could ever correct.
router.post("/parents/:id/children", people.linkChild);
router.delete("/parents/:id/children/:studentId", people.unlinkChild);

module.exports = router;
