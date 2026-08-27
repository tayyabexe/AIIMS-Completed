/*
 * HTTP surface for pinned analytics: the saved-query library, and the two
 * customisable screens' layouts.
 *
 * Everything here is scoped to req.user. There is no endpoint that reads
 * another account's saved queries or another account's layout, and no id in a
 * URL is trusted — the lookups are all WHERE user_id = me AND id = that, so a
 * guessed id returns 404 rather than someone else's card.
 *
 * WHY THIS IS A SEPARATE CONTROLLER FROM analyticsController
 * ----------------------------------------------------------
 * That one is the model's front door: a question goes in, a plan comes back,
 * and the interesting risk is the planner. This one never calls a model at
 * all. Keeping them apart means the rate limiter that protects the token
 * budget sits on /ask alone, and opening a dashboard of twelve pinned cards is
 * not throttled as though it were twelve questions — because it is not.
 */

const config = require("../config/analytics");
const scopeService = require("../services/assistant/scope.service");
const { ROLES } = require("../config/roles");
const savedQueries = require("../services/analytics/savedQueries.service");
const layouts = require("../services/analytics/layout.service");
const surfaces = require("../config/dashboardCards");
const auditLog = require("../services/assistant/auditLog");

/*
 * The caller's data scope, or a 403.
 *
 * Same gate the canvas uses. A saved card is a query and is treated as one:
 * an account that may not ask questions may not replay them either.
 */
const requireScope = async (req, res) => {

    let scope;

    try {
        scope = await scopeService.resolveFor(req.user);
    } catch (error) {
        /*
         * The resolver reads through the assistant's read-only pool, so this
         * is where a missing or misgranted `aims_ai_ro` surfaces. It is not
         * the caller's request being wrong and it is not this service being
         * broken, so it is neither a 403 nor a 500: it is a dependency being
         * unavailable, said plainly enough that whoever sees it knows where to
         * look.
         */
        console.error("[analytics] scope resolution failed:", error);

        res.status(503).json({
            success: false,
            message: "Analytics is temporarily unavailable. Please try again shortly."
        });
        return null;
    }

    if (!scope.ok) {
        res.status(403).json({ success: false, message: scope.reason });
        return null;
    }

    return scope;
};

/*
 * The caller's right to arrange THIS screen, or a 403.
 *
 * The route gate answers "may this account pin anything at all"; it cannot
 * answer "onto which board", because the board is a URL parameter. Both
 * questions have to be asked, and this is the second one.
 *
 * It matters now that teachers can pin. The two original surfaces are built
 * out of institute-wide figures - fee collection, the whole student roll, the
 * institute pass rate - and a teacher who PUT a layout for "dashboard" would
 * be arranging a screen made of numbers they are not entitled to. The map in
 * config/dashboardCards.js is the single place that says who owns which board.
 *
 * An unknown surface is left to the layout service, which already answers 404
 * for one - distinguishing "no such screen" from "not yours" here would leak
 * which screens exist.
 *
 * WHY THIS ASKS THE ROLE AND NOT THE SCOPE RESOLVER
 * ------------------------------------------------
 * It used to call requireScope, which resolves the caller's full assistant
 * scope — their teacher_id, their department, the values every tool filters
 * on — through the read-only pool. Arranging a screen needs none of that. All
 * this gate asks is "which portal is this account", and the JWT already says
 * so.
 *
 * The cost of asking the harder question was a hard dependency: when the
 * read-only account could not reach the database, resolveFor threw, and every
 * layout read became a 500. The faculty dashboard then rendered its header
 * from a healthy endpoint and its body as "Every panel has been hidden",
 * because the layout it needed had failed for a reason that had nothing to do
 * with layouts. A broken assistant account should cost you the assistant, not
 * the dashboard.
 *
 * Arranging is not reading. A card is a stored reference to a saved query, and
 * running one still goes through requireScope in runSaved — so an account the
 * resolver cannot place can move panels around and still gets nothing back
 * from them.
 */
const SCOPE_KIND_BY_ROLE = {
    [ROLES.SUPER_ADMIN]: "admin",
    [ROLES.ADMIN]: "admin",
    [ROLES.TEACHER]: "teacher",
    [ROLES.STUDENT]: "student"
};

const requireSurface = (req, res) => {

    const kind = SCOPE_KIND_BY_ROLE[req.user?.role_id] || null;
    const surface = String(req.params.surface || "");

    if (surfaces.isSurface(surface) && !surfaces.mayUseSurface(kind, surface)) {
        res.status(403).json({
            success: false,
            message: "That screen does not belong to your portal."
        });
        return false;
    }

    return true;
};

/*
 * Turns the two service error types into their intended status codes and lets
 * everything else become a 500.
 *
 * The distinction matters: a SavedQueryError is a sentence written to be read
 * by the person who triggered it, and a stray TypeError is not. Passing the
 * latter through to the client would leak internals in the name of being
 * helpful.
 */
const fail = (res, error, context) => {

    if (error?.status && error?.message
        && (error.name === "SavedQueryError" || error.name === "LayoutError")) {
        return res.status(error.status).json({
            success: false,
            message: error.message
        });
    }

    console.error(`[analytics] ${context} failed:`, error);

    return res.status(500).json({
        success: false,
        message: "That could not be completed. Please try again."
    });
};

const disabled = (res) =>
    res.status(503).json({
        success: false,
        message: "Analytics is currently disabled."
    });

// ------------------------------------------------------- the saved library --

/** GET /api/analytics/saved */
const listSaved = async (req, res) => {
    try {
        const saved = await savedQueries.list(req.user.user_id);
        return res.json({ success: true, saved });
    } catch (error) {
        return fail(res, error, "list saved queries");
    }
};

/**
 * POST /api/analytics/saved
 * { name, question, correctedQuestion?, title?, source, visuals[], defaultVisual?, axes? }
 *
 * `source` is the object the /ask response handed the browser, posted back
 * unchanged. It is not treated as vetted just because it round-tripped — see
 * savedQueries.service, which re-validates it on every run.
 */
const createSaved = async (req, res) => {

    if (!config.enabled) return disabled(res);

    try {
        const saved = await savedQueries.create(req.user.user_id, req.body || {});
        return res.status(201).json({ success: true, saved });
    } catch (error) {
        return fail(res, error, "save query");
    }
};

/** PATCH /api/analytics/saved/:id — rename, or change the offered templates. */
const updateSaved = async (req, res) => {
    try {
        const saved = await savedQueries.update(
            req.user.user_id, req.params.id, req.body || {}
        );
        return res.json({ success: true, saved });
    } catch (error) {
        return fail(res, error, "update saved query");
    }
};

/** DELETE /api/analytics/saved/:id — takes its cards with it. */
const deleteSaved = async (req, res) => {
    try {
        const removed = await savedQueries.remove(req.user.user_id, req.params.id);
        return res.json({ success: true, ...removed });
    } catch (error) {
        return fail(res, error, "delete saved query");
    }
};

/**
 * POST /api/analytics/saved/:id/run   { visual? }
 *
 * The card-refresh endpoint. Runs the stored plan and returns the canvas's
 * envelope, so a card renders through exactly the same templates the canvas
 * does.
 *
 * A POST rather than a GET because it executes a query with side effects on
 * the audit trail, and because a dashboard's worth of these should not be
 * sitting in a browser cache keyed by URL — the whole point is that the
 * figures are current.
 */
const runSaved = async (req, res) => {

    if (!config.enabled) return disabled(res);

    try {
        const row = await savedQueries.findOwned(req.user.user_id, req.params.id);

        if (!row) {
            return res.status(404).json({
                success: false,
                message: "That saved query no longer exists."
            });
        }

        const scope = await requireScope(req, res);
        if (!scope) return;

        const started = Date.now();
        const result = await savedQueries.run(scope, row, req.body?.visual);

        /*
         * Recorded in the same log a live question writes to. A pinned card
         * reads real data on a schedule nobody types, which is exactly the
         * kind of access that has to be answerable for later — and a card that
         * is refused is the more interesting entry of the two.
         */
        await auditLog.record({
            scope,
            toolName: row.source_kind === "tool" ? row.tool_name : "saved_query_sql",
            args: { savedQueryId: row.saved_query_id, name: row.name },
            result: {
                type: result.status === "ok" ? "table" : result.status,
                message: result.message,
                // Only the length is stored; auditLog never keeps the rows.
                rows: result.rows
            },
            durationMs: Date.now() - started
        }).catch(() => {});

        return res.json({ success: true, result });

    } catch (error) {
        return fail(res, error, "run saved query");
    }
};

// -------------------------------------------------------------- layouts ----

/** GET /api/analytics/layout/:surface */
const getLayout = async (req, res) => {
    try {
        if (!requireSurface(req, res)) return undefined;

        const layout = await layouts.get(req.user.user_id, req.params.surface);
        return res.json({ success: true, layout });
    } catch (error) {
        return fail(res, error, "read layout");
    }
};

/**
 * PUT /api/analytics/layout/:surface   { cards: [...] }
 *
 * The whole arrangement, every time. See layout.service for why this is a
 * replace rather than a diff.
 */
const saveLayout = async (req, res) => {
    try {
        /*
         * `breakpoint` says which width this arrangement describes. It
         * defaults to the desktop grid so a caller that omits it cannot
         * accidentally overwrite the narrow layout — and, more importantly,
         * cannot have its desktop arrangement filed under the wrong width.
         */
        if (!requireSurface(req, res)) return undefined;

        const layout = await layouts.save(
            req.user.user_id,
            req.params.surface,
            req.body?.cards,
            req.body?.breakpoint || "lg"
        );
        return res.json({ success: true, layout });
    } catch (error) {
        return fail(res, error, "save layout");
    }
};

/** DELETE /api/analytics/layout/:surface — back to the factory arrangement. */
const resetLayout = async (req, res) => {
    try {
        if (!requireSurface(req, res)) return undefined;

        const layout = await layouts.reset(req.user.user_id, req.params.surface);
        return res.json({ success: true, layout });
    } catch (error) {
        return fail(res, error, "reset layout");
    }
};

module.exports = {
    listSaved,
    createSaved,
    updateSaved,
    deleteSaved,
    runSaved,
    getLayout,
    saveLayout,
    resetLayout
};
