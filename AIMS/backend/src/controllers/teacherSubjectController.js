/*
 * HTTP for the qualification registry.
 *
 * Thin, like courseOfferingController: every rule lives in
 * teacherSubjectService, because the same rules are reached from provisioning
 * and from the test suites, and a rule enforced in a controller is a rule that
 * only applies to requests.
 *
 * What this replaces was three hand-written try/catch blocks that answered
 * **500 for everything** - a missing teacher, a duplicate row and a dead
 * database were indistinguishable to the caller. The service now raises errors
 * carrying `statusCode` and `details`, and sendError turns those into the
 * right response.
 */

const { sendError } = require("../utils/apiError");
const registry = require("../services/teacherSubjectService");

const ok = (res, data, extra = {}) =>
    res.status(200).json({ success: true, data, ...extra });

// Express 4 does not catch async throws.
const handle = (fn, fallback) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        sendError(res, error, fallback);
    }
};

/*
 * Filters: teacher_id, department_id, q, unqualified_only.
 * One row per teacher, subjects nested - see the service for why.
 */
const listQualifications = handle(async (req, res) => {
    const data = await registry.listQualifications(req.query);
    ok(res, data, { count: data.length });
}, "Could not read the qualification registry.");

const listTeachersForSubject = handle(async (req, res) => {
    const data = await registry.listTeachersForSubject(req.params.subjectId);
    ok(res, data);
}, "Could not read who is qualified for that subject.");

const grant = handle(async (req, res) => {
    const result = await registry.grant(req.body);
    // 200, not 201: the call is idempotent and "already recorded" did not
    // create anything. The outcome field says which happened.
    ok(res, result, { message: result.message });
}, "Could not record the qualification.");

const setQualifications = handle(async (req, res) => {
    const result = await registry.setQualifications(
        req.params.teacherId,
        req.body.subject_ids
    );
    ok(res, result, { message: result.message });
}, "Could not save the qualifications.");

const revoke = handle(async (req, res) => {
    const result = await registry.revoke(
        req.params.teacherId,
        req.params.subjectId
    );
    ok(res, result, { message: "Qualification removed." });
}, "Could not remove the qualification.");

module.exports = {
    listQualifications,
    listTeachersForSubject,
    grant,
    setQualifications,
    revoke
};
