/*
 * Saved queries: keeping a question, and asking it again later.
 *
 * THE ONE IDEA THIS FILE IS BUILT ON
 * ---------------------------------
 * Saving a result saves the *plan*, and running a saved query re-executes that
 * plan against the live database. There is no stored row anywhere in here.
 *
 * That means a pinned card shows today's figures, not the figures that
 * happened to be true on the afternoon someone clicked Save — and, less
 * obviously but more importantly, it means the caller's permissions are
 * re-checked on every single view. A snapshot table would have been a copy of
 * query results sitting outside every grant in the system, readable by
 * whoever could reach the row.
 *
 * NO MODEL RUNS HERE
 * ------------------
 * The planner was called once, when the question was originally typed on the
 * canvas. Replaying costs a database round trip and nothing else. This is why
 * a dashboard of twelve pinned cards is affordable: twelve queries, zero
 * tokens.
 *
 * WHAT IS RE-CHECKED ON EVERY RUN
 * -------------------------------
 * Everything. The stored plan goes back through planValidator.validate()
 * against the *current* caller's catalogue, and generated SQL goes back
 * through sqlGuard inside the executor. A saved row is a note of what to
 * re-check, never a permission slip:
 *
 *   - An admin demoted to a role with a smaller catalogue stops being able to
 *     run the cards they saved as an admin.
 *   - A teacher's saved SQL is re-scoped to their roster on each run, so a
 *     card saved when they taught one section does not keep answering for it
 *     after they stop.
 */

const { Op } = require("sequelize");

const config = require("../../config/analytics");
const surfaces = require("../../config/dashboardCards");
const SavedQuery = require("../../models/savedQuery.model");
const DashboardCard = require("../../models/dashboardCard.model");
const planValidator = require("./planValidator");
const executor = require("./executor");
const catalogue = require("./catalogue");

const TEMPLATES = new Set(config.templates);

// A saved name has to fit the chip that displays it.
const MAX_NAME = 120;

/*
 * A failure the caller is meant to see, rather than a 500.
 *
 * Thrown rather than returned because these are all "the request was wrong"
 * conditions detected several calls deep, and threading a result type back up
 * through create/update would have obscured the happy path for no gain.
 */
class SavedQueryError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = "SavedQueryError";
        this.status = status;
    }
}

// ------------------------------------------------------------- validation --

/*
 * The templates a card may be shown as.
 *
 * Only the closed list of templates the frontend implements. Whether the DATA
 * supports a given template was settled on the canvas — the save dialog offers
 * exactly the options the /ask response marked available — and cannot be
 * rechecked here without running the query, so it is not pretended to be.
 * What can be checked is that nothing outside the seven names gets stored, and
 * that is checked.
 */
const cleanVisuals = (input) => {

    const list = Array.isArray(input) ? input : [];

    const visuals = [...new Set(
        list.map((v) => String(v).trim()).filter((v) => TEMPLATES.has(v))
    )];

    if (!visuals.length) {
        throw new SavedQueryError(
            "Pick at least one way to show this query."
        );
    }

    return visuals;
};

const cleanName = (input) => {

    const name = String(input || "").trim().replace(/\s+/g, " ");

    if (!name) throw new SavedQueryError("Give this query a name.");

    if (name.length > MAX_NAME) {
        throw new SavedQueryError(
            `That name is too long. Keep it under ${MAX_NAME} characters.`
        );
    }

    return name;
};

/*
 * The plan half of a save request.
 *
 * This is the `source` object the /ask response already handed the browser,
 * sent back unchanged. It is not trusted on the way in — a caller could post
 * any SQL they liked here — which is exactly why `run()` puts it back through
 * validate() and sqlGuard rather than treating a stored row as vetted. Saving
 * arbitrary SQL grants nothing that typing it into the canvas would not.
 */
const cleanSource = (source) => {

    const kind = String(source?.kind || "").trim();

    if (kind === "tool") {
        const name = String(source.name || "").trim();
        if (!name) throw new SavedQueryError("That result has no tool to save.");

        return {
            source_kind: "tool",
            tool_name: name.slice(0, 80),
            tool_args: source.args && typeof source.args === "object" ? source.args : {},
            sql_text: null
        };
    }

    if (kind === "sql") {
        const sql = String(source.sql || "").trim();
        if (!sql) throw new SavedQueryError("That result has no query to save.");

        return {
            source_kind: "sql",
            tool_name: null,
            tool_args: null,
            sql_text: sql
        };
    }

    throw new SavedQueryError("That result cannot be saved.");
};

/*
 * The shape the frontend gets. snake_case columns become the camelCase the
 * rest of the API speaks, and the SQL is deliberately included: an admin who
 * pinned a generated query is entitled to see what it does, and the canvas
 * already shows them the same string under "How this was answered".
 */
const present = (row) => ({
    id: row.saved_query_id,
    name: row.name,
    question: row.question,
    correctedQuestion: row.corrected_question || null,
    title: row.title || null,
    visuals: Array.isArray(row.visuals) ? row.visuals : [],
    defaultVisual: row.default_visual,
    source: row.source_kind === "tool"
        ? { kind: "tool", name: row.tool_name, args: row.tool_args || {} }
        : { kind: "sql", sql: row.sql_text },
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

// ------------------------------------------------------------------- CRUD --

/** Every saved query for one account, newest first. */
const list = async (userId) => {
    const rows = await SavedQuery.findAll({
        where: { user_id: userId },
        order: [["created_at", "DESC"]]
    });

    return rows.map(present);
};

/** One saved query, or null. Scoped to the owner — there is no other read. */
const findOwned = async (userId, id) =>
    SavedQuery.findOne({
        where: { user_id: userId, saved_query_id: Number(id) || 0 }
    });

const create = async (userId, payload) => {

    const name = cleanName(payload?.name);
    const visuals = cleanVisuals(payload?.visuals);
    const source = cleanSource(payload?.source);

    const question = String(payload?.question || "").trim();
    if (!question) throw new SavedQueryError("That result has no question to save.");

    /*
     * The starting template. Falls back to the first ticked option rather than
     * erroring, because "the default is not one of the choices" is a slip the
     * server can fix without bothering anyone.
     */
    const requested = String(payload?.defaultVisual || "").trim();
    const defaultVisual = visuals.includes(requested) ? requested : visuals[0];

    const axes = payload?.axes && typeof payload.axes === "object"
        ? {
            xKey: String(payload.axes.xKey || ""),
            yKeys: Array.isArray(payload.axes.yKeys)
                ? payload.axes.yKeys.map(String)
                : []
        }
        : null;

    try {
        const row = await SavedQuery.create({
            user_id: userId,
            name,
            question: question.slice(0, 500),
            corrected_question: String(payload?.correctedQuestion || "").trim() || null,
            title: String(payload?.title || "").trim().slice(0, 200) || null,
            visuals,
            default_visual: defaultVisual,
            axes,
            ...source
        });

        return present(row);

    } catch (error) {
        // The unique index on (user_id, name) doing its job.
        if (error?.name === "SequelizeUniqueConstraintError") {
            throw new SavedQueryError(
                `You already have a saved query called “${name}”.`, 409
            );
        }
        throw error;
    }
};

/*
 * Rename, or change which templates a query offers.
 *
 * The plan itself is immutable. Editing the SQL behind a saved name would let
 * a card quietly become a different question while every dashboard it sits on
 * kept the old label — if the question changes, it is a new saved query.
 */
const update = async (userId, id, patch) => {

    const row = await findOwned(userId, id);
    if (!row) throw new SavedQueryError("That saved query no longer exists.", 404);

    const changes = {};

    if (patch?.name !== undefined) changes.name = cleanName(patch.name);

    if (patch?.visuals !== undefined) changes.visuals = cleanVisuals(patch.visuals);

    // Checked against the NEW list when both arrive together, so a visual can
    // be removed and the default moved off it in one request.
    const visuals = changes.visuals || row.visuals || [];

    if (patch?.defaultVisual !== undefined) {
        const wanted = String(patch.defaultVisual).trim();
        changes.default_visual = visuals.includes(wanted) ? wanted : visuals[0];
    } else if (changes.visuals && !visuals.includes(row.default_visual)) {
        // The default was just un-ticked. Move it rather than leave the card
        // pointing at a template the query no longer offers.
        changes.default_visual = visuals[0];
    }

    if (!Object.keys(changes).length) return present(row);

    try {
        await row.update(changes);
    } catch (error) {
        if (error?.name === "SequelizeUniqueConstraintError") {
            throw new SavedQueryError(
                `You already have a saved query called “${changes.name}”.`, 409
            );
        }
        throw error;
    }

    /*
     * Cards drawing a template that has just been un-ticked are moved onto one
     * that survived.
     *
     * Without this, un-ticking "bar" while a bar card sat on the Dashboard
     * left a stored card referring to a view its own query no longer offers —
     * and the next layout save would be refused with "was not saved with a bar
     * view" for a card the user had not touched. The narrowing is what made
     * the card invalid, so the narrowing is what repairs it.
     *
     * Done in the same call rather than left to the browser because the rule
     * belongs to the data: a second admin session, or a tab open on the other
     * screen, has no idea this happened.
     */
    if (changes.visuals) {
        await DashboardCard.update(
            { visual: row.default_visual },
            {
                where: {
                    user_id: userId,
                    saved_query_id: row.saved_query_id,
                    visual: { [Op.notIn]: changes.visuals }
                }
            }
        );
    }

    return present(row);
};

/*
 * Forget a query.
 *
 * Its cards go with it, by the foreign key's ON DELETE CASCADE — a card that
 * points at a deleted query has nothing to draw, and leaving one behind would
 * put a permanent error panel on someone's dashboard.
 */
const remove = async (userId, id) => {

    const row = await findOwned(userId, id);
    if (!row) throw new SavedQueryError("That saved query no longer exists.", 404);

    await row.destroy();
    return { id: Number(id) };
};

// -------------------------------------------------------------------- run --

/**
 * Re-run one saved query and return the same envelope /ask returns.
 *
 * `visual` overrides the saved default, so the two cards a query can appear
 * as — a bar chart on the Dashboard, a table on AI Insights — are one row run
 * twice with a different template, not two saved queries.
 *
 * The response is the canvas's shape on purpose: the card renders through the
 * same ChartTemplates registry the canvas does, and a second envelope would
 * have meant a second renderer to keep in step with it.
 */
const run = async (scope, row, visual) => {

    const saved = present(row);

    const template = saved.visuals.includes(String(visual))
        ? String(visual)
        : saved.defaultVisual;

    /*
     * Back through the planner's own validator, against the catalogue THIS
     * caller has today. A stored tool name is worth no more than a freshly
     * generated one — if the account can no longer reach that tool, the card
     * stops working, which is the correct outcome and not a bug to route
     * around.
     */
    const { names } = await catalogue.forScope(scope, saved.question);

    const validated = planValidator.validate(
        {
            corrected_question: saved.correctedQuestion || saved.question,
            mode: saved.source.kind,
            tool: saved.source.kind === "tool" ? saved.source.name : undefined,
            args: saved.source.kind === "tool" ? saved.source.args : undefined,
            sql: saved.source.kind === "sql" ? saved.source.sql : undefined,
            title: saved.title || saved.name,
            render: {
                template,
                xKey: row.axes?.xKey || "",
                yKeys: row.axes?.yKeys || []
            }
        },
        scope,
        names
    );

    if (!validated.ok) {
        return {
            saved_query_id: saved.id,
            name: saved.name,
            question: saved.question,
            status: "refused",
            message: validated.reason,
            render: { template: "none" },
            rows: [],
            columns: []
        };
    }

    const started = Date.now();
    const outcome = await executor.execute(scope, validated);

    /*
     * A saved query that has stopped running is reported as itself rather than
     * as a broken page. The usual cause is a schema change under a generated
     * statement — a renamed column, a dropped view — and the card says so, so
     * the owner can delete it or ask the question again.
     *
     * There is deliberately no repair attempt here, unlike on the canvas. A
     * repair is a second model call, and firing one per broken card on every
     * dashboard load would turn a quiet failure into a recurring bill.
     */
    if (outcome.type === "refused" || outcome.type === "error") {
        return {
            saved_query_id: saved.id,
            name: saved.name,
            question: saved.question,
            status: outcome.type,
            message: outcome.message,
            render: { template: "none" },
            rows: [],
            columns: []
        };
    }

    const render = planValidator.reconcile(
        validated.render,
        outcome.columns,
        outcome.rowCount,
        outcome.rows
    );

    return {
        saved_query_id: saved.id,
        name: saved.name,
        question: saved.question,
        status: "ok",

        render,

        ...planValidator.describeOptions(
            outcome.columns,
            outcome.rows,
            outcome.rowCount
        ),

        columns: outcome.columns,
        rows: outcome.rows,
        row_count: outcome.rowCount,
        total_rows: outcome.totalRows,
        truncated: Boolean(outcome.truncated),

        timing_ms: Date.now() - started,

        // Zero, always, and stated rather than omitted: a replayed card is the
        // cheap path, and the number on screen is how you can tell.
        planner_tokens: 0
    };
};

/*
 * The templates one surface will accept from one saved query.
 *
 * The Dashboard takes charts only; see config/dashboardCards.js. Exposed so
 * the drag source can grey out the options a surface will refuse instead of
 * letting a drop fail on the server.
 */
const visualsForSurface = (saved, surfaceKey) => {
    const rules = surfaces.SURFACES[surfaceKey];
    if (!rules) return [];

    return rules.allowTables
        ? saved.visuals
        : saved.visuals.filter((v) => v !== "table");
};

module.exports = {
    SavedQueryError,
    list,
    findOwned,
    create,
    update,
    remove,
    run,
    present,
    visualsForSurface
};
