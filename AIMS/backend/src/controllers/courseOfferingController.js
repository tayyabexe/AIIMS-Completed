/*
 * HTTP for the timetable management module: terms, classes, staffing,
 * enrolment and placement.
 *
 * Thin on purpose. Every rule - who may teach what, which room fits, whether a
 * period is free, whether a term is still open - lives in
 * courseOfferingService and schedulingService, because those rules are also
 * reached from the seeders and the test suites, and a rule enforced in a
 * controller is a rule that only applies to requests.
 *
 * Both services raise errors carrying `statusCode` and, where a refusal has
 * structure worth rendering, `details`. sendError() turns those into the right
 * response, so nothing here needs its own try/catch ladder.
 */

const { sendError } = require("../utils/apiError");
const offerings = require("../services/courseOfferingService");
const scheduling = require("../services/schedulingService");

const ok = (res, data, extra = {}) =>
    res.status(200).json({ success: true, data, ...extra });

const created = (res, data, extra = {}) =>
    res.status(201).json({ success: true, data, ...extra });

// Wraps a handler so a thrown service error becomes its own status rather than
// an unhandled rejection. Express 4 does not catch async throws.
const handle = (fn, fallback) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        sendError(res, error, fallback);
    }
};

// =====================================================================
// TERMS
// =====================================================================

const listTerms = handle(async (req, res) => {
    const includeClosed = req.query.include_closed !== "false";
    const data = await offerings.listTerms({ includeClosed });

    return ok(res, data, { count: data.length });
}, "Could not list academic terms");

const getCurrentTerm = handle(async (req, res) => {
    const term = await offerings.getCurrentTerm();

    if (!term) {
        return res.status(404).json({
            success: false,
            message:
                "No academic term is active or planned. Create one before " +
                "building a timetable."
        });
    }

    return ok(res, term);
}, "Could not resolve the current term");

const createTerm = handle(
    async (req, res) => created(res, await offerings.createTerm(req.body)),
    "Could not create the academic term"
);

const setTermStatus = handle(
    async (req, res) =>
        ok(res, await offerings.setTermStatus(req.params.id, req.body.status)),
    "Could not change the term status"
);

// =====================================================================
// OFFERINGS
// =====================================================================

/*
 * The term defaults to the one running when the caller does not name it. Every
 * screen in this module is term-scoped, and making each of them resolve "which
 * term am I looking at" independently is how two screens end up disagreeing.
 */
const resolveTermId = async (req) => {
    if (req.query.term_id) return Number(req.query.term_id);

    const current = await offerings.getCurrentTerm();

    return current ? current.term_id : null;
};

const listOfferings = handle(async (req, res) => {
    const termId = await resolveTermId(req);

    const data = await offerings.listOfferings({
        term_id: termId,
        section_id: req.query.section_id,
        subject_id: req.query.subject_id,
        teacher_id: req.query.teacher_id,
        batch_id: req.query.batch_id,
        program_id: req.query.program_id,
        status: req.query.status,
        unstaffed: req.query.unstaffed
    });

    return ok(res, data, { count: data.length, term_id: termId });
}, "Could not list course offerings");

const getOffering = handle(
    async (req, res) => ok(res, await offerings.getOffering(req.params.id)),
    "Could not load the course offering"
);

const createOffering = handle(async (req, res) => {
    const term_id = req.body.term_id || (await resolveTermId(req));

    return created(res, await offerings.createOffering({ ...req.body, term_id }));
}, "Could not create the course offering");

// Every class a section needs for one curriculum semester, in one call. See
// createOfferingsForSection for why this exists as its own operation.
const createOfferingsForSection = handle(async (req, res) => {
    const term_id = req.body.term_id || (await resolveTermId(req));

    const result = await offerings.createOfferingsForSection({
        term_id,
        section_id: req.body.section_id,
        semester_id: req.body.semester_id
    });

    return created(res, result, {
        message:
            `Created ${result.created.length} class(es); skipped ` +
            `${result.skipped.length} that already existed.`
    });
}, "Could not create the section's classes");

const updateOffering = handle(
    async (req, res) => ok(res, await offerings.updateOffering(req.params.id, req.body)),
    "Could not update the course offering"
);

const deleteOffering = handle(async (req, res) => {
    const result = await offerings.deleteOffering(req.params.id);

    return ok(res, result, { message: result.message });
}, "Could not remove the course offering");

// =====================================================================
// STAFFING
// =====================================================================

const getEligibleTeachers = handle(
    async (req, res) => ok(res, await offerings.getEligibleTeachers(req.params.id)),
    "Could not list eligible teachers"
);

const assignTeacher = handle(
    async (req, res) =>
        ok(res, await offerings.assignTeacher(req.params.id, req.body.teacher_id)),
    "Could not assign the teacher"
);

// =====================================================================
// ENROLMENT
// =====================================================================

const enrolCohort = handle(async (req, res) => {
    const result = await offerings.enrolCohort(req.params.id);

    return ok(res, result, {
        message:
            `Enrolled ${result.enrolled} student(s); ${result.already_enrolled} ` +
            "were already in the class."
    });
}, "Could not enrol the cohort");

const enrolCohortForSection = handle(async (req, res) => {
    const term_id = req.body.term_id || (await resolveTermId(req));

    const result = await offerings.enrolCohortForSection(term_id, req.body.section_id);

    return ok(res, result, {
        message: `Enrolled ${result.total_enrolled} place(s) across ${result.classes} class(es).`
    });
}, "Could not enrol the section");

const getRoster = handle(async (req, res) => {
    const data = await offerings.getRoster(req.params.id);

    return ok(res, data, { count: data.count });
}, "Could not load the class roster");

/*
 * A student's classes and who teaches them.
 *
 * A student caller is forced onto their own record regardless of what they
 * ask for. `req.ownStudentId` is set by scopeStudentToSelf, the same guard the
 * enrollment routes use - without it, a student could read any classmate's
 * timetable and teacher list by changing the id in the URL.
 */
const getStudentClasses = handle(async (req, res) => {
    const studentId = req.ownStudentId ?? req.params.student_id;

    const data = await offerings.getStudentClasses(studentId, req.query.term_id || null);

    return ok(res, data, { count: data.count });
}, "Could not load the student's classes");

// =====================================================================
// SCHEDULING
// =====================================================================

/*
 * The whole answer for one class: every day, every period, and either why it
 * is blocked or which rooms would work in it. This is what the placement UI
 * renders; the admin picks from it rather than guessing and being refused.
 */
const getPlacementOptions = handle(async (req, res) => {
    const data = await scheduling.getPlacementOptions(req.params.id, {
        excludeTimetableId: req.query.exclude_timetable_id || null
    });

    return ok(res, data);
}, "Could not work out where this class can be placed");

const placeSession = handle(
    async (req, res) =>
        created(
            res,
            await scheduling.placeSession(req.params.id, {
                day_of_week: req.body.day_of_week,
                slot_number: req.body.slot_number,
                classroom_id: req.body.classroom_id
            })
        ),
    "Could not place the class on the timetable"
);

const moveSession = handle(
    async (req, res) =>
        ok(
            res,
            await scheduling.moveSession(req.params.timetableId, {
                day_of_week: req.body.day_of_week,
                slot_number: req.body.slot_number,
                classroom_id: req.body.classroom_id
            })
        ),
    "Could not move the class"
);

const unplaceSession = handle(
    async (req, res) => ok(res, await scheduling.unplaceSession(req.params.timetableId)),
    "Could not remove the period from the timetable"
);

// The admin's worklist: what is unstaffed, what is half-placed, what is done.
const getSchedulingStatus = handle(async (req, res) => {
    const termId = await resolveTermId(req);

    if (!termId) {
        return res.status(404).json({
            success: false,
            message: "No academic term is active or planned."
        });
    }

    return ok(res, await scheduling.getTermSchedulingStatus(termId));
}, "Could not load the scheduling status");

// The estate's week - which rooms are free when, and which stand empty.
const getRoomOccupancy = handle(async (req, res) => {
    const termId = await resolveTermId(req);

    if (!termId) {
        return res.status(404).json({
            success: false,
            message: "No academic term is active or planned."
        });
    }

    return ok(
        res,
        await scheduling.getRoomOccupancy(termId, {
            classroomId: req.query.classroom_id || null
        })
    );
}, "Could not load room occupancy");

module.exports = {
    listTerms,
    getCurrentTerm,
    createTerm,
    setTermStatus,

    listOfferings,
    getOffering,
    createOffering,
    createOfferingsForSection,
    updateOffering,
    deleteOffering,

    getEligibleTeachers,
    assignTeacher,

    enrolCohort,
    enrolCohortForSection,
    getRoster,
    getStudentClasses,

    getPlacementOptions,
    placeSession,
    moveSession,
    unplaceSession,
    getSchedulingStatus,
    getRoomOccupancy
};
