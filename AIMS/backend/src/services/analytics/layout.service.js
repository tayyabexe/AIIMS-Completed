/*
 * Where the cards sit.
 *
 * WHY THE WHOLE LAYOUT IS WRITTEN AT ONCE
 * ---------------------------------------
 * Saving is a replace, not a diff: every card for one account on one surface
 * is deleted and rewritten inside a transaction. Dragging one card in a
 * reflowing grid moves its neighbours too, so "the user moved one card" is
 * never one row's worth of change — a per-card PATCH would have meant five
 * requests for one drag, arriving in an order nothing guarantees, each one a
 * chance to persist a half-moved grid.
 *
 * The layouts are small (a dozen rows), the write is one statement plus one
 * insert, and the result is that what is stored is always a whole arrangement
 * somebody actually saw.
 *
 * WHY A FRESH ACCOUNT HAS NO ROWS
 * -------------------------------
 * An account that has never touched the pencil menu gets the factory layout
 * computed from config/dashboardCards.js, and nothing is written. So turning
 * this feature on adds no rows for anybody, the default arrangement can be
 * changed later in one config file rather than in every account's stored copy,
 * and "Reset layout" is a delete rather than a rewrite.
 */

const { sequelize } = require("../../database/connection");
const surfaces = require("../../config/dashboardCards");
const DashboardCard = require("../../models/dashboardCard.model");
const SavedQuery = require("../../models/savedQuery.model");

/*
 * Only the row-to-JSON shaping, borrowed so the strip's chips have one
 * definition rather than a second copy that drifts. The dependency runs one
 * way — savedQueries.service knows nothing about layouts.
 */
const { present: presentSaved } = require("./savedQueries.service");

class LayoutError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = "LayoutError";
        this.status = status;
    }
}

/*
 * Grid arithmetic, clamped rather than rejected.
 *
 * A browser sending w=19 on a 12-column grid is a UI bug, not an attack, and
 * refusing the whole save would lose the user's other twelve placements to
 * punish one. The card is pulled back inside the grid and the save proceeds.
 */
/*
 * `h` is a pixel height now, not a row count — see GRID_ROW_HEIGHT in
 * config/dashboardCards.js. The ceiling is therefore a tall-but-sane card
 * rather than a handful of rows.
 */
const MAX_CARD_HEIGHT = 2000;
const MIN_CARD_HEIGHT = 80;

const clampGeometry = (card, breakpoint = "lg") => {
    const cols = surfaces.BREAKPOINTS[breakpoint]?.columns ?? surfaces.GRID_COLUMNS;

    const int = (value, fallback) => {
        const n = Math.trunc(Number(value));
        return Number.isFinite(n) ? n : fallback;
    };

    const w = Math.min(Math.max(int(card.w, 6), 1), cols);
    const x = Math.min(Math.max(int(card.x, 0), 0), cols - w);
    const y = Math.max(int(card.y, 0), 0);
    const h = Math.min(Math.max(int(card.h, 336), MIN_CARD_HEIGHT), MAX_CARD_HEIGHT);

    return { grid_x: x, grid_y: y, grid_w: w, grid_h: h };
};

/** The untouched arrangement of a surface, straight from config. */
const factoryLayout = (surface) =>
    (surfaces.BUILTINS[surface] || []).map((b) => ({
        cardId: null,
        kind: "builtin",
        builtinKey: b.key,
        label: b.label,
        savedQueryId: null,
        visual: null,
        // Never true for a factory card: nobody has sized it, so it is free to
        // be exactly as tall as whatever it turns out to draw.
        userSized: false,
        x: b.x, y: b.y, w: b.w, h: b.h
    }));

/*
 * The desktop arrangement, flattened into a single column.
 *
 * Used until somebody actually arranges at the narrow width. Reading order —
 * top to bottom, then left to right — is what a person flattening this by hand
 * would produce, so the derived stack is not a placeholder to be tolerated but
 * the arrangement they would most likely have built.
 *
 * Heights are carried across unchanged: a card's content does not need less
 * room because the window is narrower. It usually needs more, and the client's
 * own measurement raises it where that is true.
 */
const stackForNarrow = (cards) =>
    [...cards]
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .map((card, i) => ({ ...card, cardId: null, x: 0, y: i, w: 1 }));

const present = (row, labels) => ({
    cardId: row.card_id,
    kind: row.builtin_key ? "builtin" : "query",
    builtinKey: row.builtin_key,
    label: row.builtin_key ? labels.get(row.builtin_key) || row.builtin_key : null,
    savedQueryId: row.saved_query_id,
    visual: row.visual,
    userSized: !!row.user_sized,
    x: row.grid_x, y: row.grid_y, w: row.grid_w, h: row.grid_h
});

/**
 * One surface's layout for one account.
 *
 * Also returns the surface's rules and its built-in catalogue, because the
 * client needs both to render the pencil menu — which panels exist, which of
 * them may be removed — and having it read them from the same response that
 * carries the layout means the two cannot disagree.
 */
const get = async (userId, surface) => {

    if (!surfaces.isSurface(surface)) {
        throw new LayoutError("Unknown screen.", 404);
    }

    const rules = surfaces.SURFACES[surface];
    const builtins = surfaces.BUILTINS[surface];
    const labels = new Map(builtins.map((b) => [b.key, b.label]));

    /*
     * The cards and the saved-query library in one round trip.
     *
     * The browser needs both to draw the screen — a card carries a saved-query
     * id and nothing else, so without the library there is no name to put on
     * it — and it used to fetch them as two requests. Against a remote
     * database each HTTP call is a network round trip whether it asks for one
     * row or a hundred, so that was a whole RTT spent on a second question
     * that was always asked at the same moment as the first.
     *
     * Promise.all rather than sequentially: these are two independent reads,
     * and awaiting them in turn would trade the round trip just saved for a
     * second database one.
     */
    const [allRows, savedRows] = await Promise.all([
        DashboardCard.findAll({
            where: { user_id: userId, surface },
            order: [["grid_y", "ASC"], ["grid_x", "ASC"]]
        }),
        SavedQuery.findAll({
            where: { user_id: userId },
            order: [["created_at", "DESC"]]
        })
    ]);

    /*
     * A stored layout predating a new built-in would silently hide it, so any
     * built-in the config knows about but the stored rows do not is appended
     * at the bottom — shipping a new panel puts it on screen for accounts that
     * have already customised theirs, not only for new ones.
     *
     * ONLY WHERE BUILT-INS ARE PERMANENT, though, and that condition is the
     * whole point. On the Dashboard a missing built-in can only mean "this
     * layout is older than that panel", because removing one is refused. On AI
     * Insights it much more likely means "the user removed it", and back-
     * filling there put every removed panel straight back on the next reload —
     * which made the remove button on that screen do nothing that survived a
     * refresh.
     *
     * A genuinely new panel is therefore not forced onto a customised AI
     * Insights. It appears in the toolbar's hidden-panels menu instead, which
     * lists exactly the built-ins not currently on screen, so it is one click
     * away rather than dropped into an arrangement someone deliberately made.
     */
    // Both widths come back in the one read; the index leads with user_id and
    // surface, so splitting here is cheaper than asking twice.
    const rows = allRows.filter((r) => r.breakpoint === "lg");
    const narrowRows = allRows.filter((r) => r.breakpoint === "sm");

    let cards = rows.length ? rows.map((r) => present(r, labels)) : factoryLayout(surface);

    if (rows.length && !rules.builtinsRemovable) {
        const seen = new Set(cards.map((c) => c.builtinKey).filter(Boolean));
        const missing = builtins.filter((b) => !seen.has(b.key));

        if (missing.length) {
            const bottom = cards.reduce((max, c) => Math.max(max, c.y + c.h), 0);
            cards = cards.concat(missing.map((b, i) => ({
                cardId: null,
                kind: "builtin",
                builtinKey: b.key,
                label: b.label,
                savedQueryId: null,
                visual: null,
                userSized: false,
                x: b.x, y: bottom + i * b.h, w: b.w, h: b.h
            })));
        }
    }

    /*
     * The narrow layout, stored if it has ever been arranged and derived from
     * the desktop one if not.
     *
     * Derived rather than written on first sight for the same reason a fresh
     * account gets the factory layout without any rows: an arrangement nobody
     * has made is a computed default, and keeping it computed means it tracks
     * the desktop layout as that changes instead of freezing a snapshot of it
     * taken the first time somebody happened to open a laptop.
     */
    const narrowCards = narrowRows.length
        ? narrowRows.map((r) => present(r, labels))
        : stackForNarrow(cards);

    return {
        surface,
        customised: rows.length > 0,
        /*
         * Keyed by breakpoint, in react-grid-layout's own `layouts` shape, so
         * the client hands it straight to ResponsiveGridLayout rather than
         * rebuilding it.
         */
        layouts: { lg: cards, sm: narrowCards },
        narrowCustomised: narrowRows.length > 0,
        // The strip's contents, so opening a screen is one request rather than
        // two. Presented through the saved-query service so there is one
        // definition of that shape rather than a second copy here.
        saved: savedRows.map(presentSaved),
        rules: {
            columns: surfaces.GRID_COLUMNS,
            rowHeight: surfaces.GRID_ROW_HEIGHT,
            margin: surfaces.GRID_MARGIN,
            // The vertical gap the client must add to a measured height, so a
            // card it sizes itself matches the defaults written here.
            gap: surfaces.GRID_GAP,
            minHeight: MIN_CARD_HEIGHT,
            builtinsRemovable: rules.builtinsRemovable,
            builtinsResizable: rules.builtinsResizable,
            builtinsAutoHeight: rules.builtinsAutoHeight,
            allowTables: rules.allowTables,
            breakpoints: surfaces.BREAKPOINTS
        },
        builtins,
        cards
    };
};

/*
 * The write half of `save`, with one retry.
 *
 * WHY A RETRY IS NEEDED AT ALL
 * ----------------------------
 * This deletes every row for one user, surface and breakpoint and re-inserts
 * them. InnoDB takes gap locks over that index range for the DELETE, so two of
 * these overlapping for the SAME user deadlock — MySQL picks a victim, rolls it
 * back, and the client sees a 500 on a layout it successfully arranged.
 *
 * The client no longer issues overlapping saves (see the autosave chain in
 * usePinnedSurface), which removes the cause in the normal case. This covers
 * the ones it cannot: the same account open in two tabs, or a retry landing on
 * top of a request that had not finished.
 *
 * ONE retry, and only for a deadlock. A deadlock is transient by definition —
 * the other transaction has been rolled back, so the second attempt runs
 * alone. Anything else is a real failure and retrying it would only delay the
 * error the caller needs to see.
 */
const DEADLOCK = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

const isDeadlock = (err) =>
    DEADLOCK.has(err?.parent?.code) || DEADLOCK.has(err?.original?.code);

const writeRows = async (userId, surface, breakpoint, rows) => {
    const attempt = () => sequelize.transaction(async (transaction) => {
        /*
         * Scoped to this breakpoint. Without it, arranging on a tablet would
         * delete the desktop arrangement — the exact flattening that having
         * two layouts exists to prevent.
         */
        await DashboardCard.destroy({
            where: { user_id: userId, surface, breakpoint },
            transaction
        });

        if (rows.length) {
            await DashboardCard.bulkCreate(rows, { transaction });
        }
    });

    try {
        await attempt();
    } catch (err) {
        if (!isDeadlock(err)) throw err;
        await attempt();
    }
};

/**
 * Replace a surface's layout.
 *
 * Everything the client sends is checked against what this account may
 * actually place: a saved query id it does not own, a built-in key the screen
 * does not have, or a template the saved query does not offer are all refused
 * outright rather than silently dropped — a save that quietly discards a card
 * looks to the user like the drag never happened.
 */
const save = async (userId, surface, incoming, breakpoint = "lg") => {

    if (!surfaces.isSurface(surface)) {
        throw new LayoutError("Unknown screen.", 404);
    }

    if (!surfaces.isBreakpoint(breakpoint)) {
        throw new LayoutError("Unknown screen width.", 400);
    }

    const rules = surfaces.SURFACES[surface];
    const known = surfaces.builtinKeys(surface);
    const list = Array.isArray(incoming) ? incoming : [];

    if (list.length > 60) {
        throw new LayoutError("That is too many cards for one screen.");
    }

    // Which saved queries this account actually owns. One query, so a layout
    // of twenty cards is not twenty ownership checks.
    const owned = new Map(
        (await SavedQuery.findAll({ where: { user_id: userId } }))
            .map((row) => [row.saved_query_id, row])
    );

    const seenBuiltins = new Set();
    const rows = [];

    for (const card of list) {

        const geometry = clampGeometry(card, breakpoint);

        if (card?.kind === "builtin") {

            const key = String(card.builtinKey || "");

            if (!known.has(key)) {
                throw new LayoutError(`“${key}” is not a panel on this screen.`);
            }

            // A panel placed twice would render twice and be impossible to
            // tell apart; the second one is the bug, so the save is refused.
            if (seenBuiltins.has(key)) {
                throw new LayoutError(`“${key}” appears twice in that layout.`);
            }

            seenBuiltins.add(key);

            rows.push({
                user_id: userId,
                surface,
                breakpoint,
                saved_query_id: null,
                builtin_key: key,
                visual: null,
                user_sized: card?.userSized === true,
                ...geometry
            });

            continue;
        }

        const savedId = Number(card?.savedQueryId);
        const saved = owned.get(savedId);

        if (!saved) {
            throw new LayoutError("That saved query is not yours to place.", 403);
        }

        const visuals = Array.isArray(saved.visuals) ? saved.visuals : [];
        const visual = String(card?.visual || saved.default_visual);

        if (!visuals.includes(visual)) {
            throw new LayoutError(
                `“${saved.name}” was not saved with a ${visual} view.`
            );
        }

        /*
         * The Dashboard's no-tables rule, enforced where it matters. The drag
         * source greys the option out, but the rule belongs to the surface and
         * a rule only the client knows is not a rule.
         */
        if (visual === "table" && !rules.allowTables) {
            throw new LayoutError(
                `The ${rules.label} does not take tables — pick a chart instead.`
            );
        }

        rows.push({
            user_id: userId,
            surface,
            breakpoint,
            saved_query_id: savedId,
            builtin_key: null,
            visual,
            user_sized: card?.userSized === true,
            ...geometry
        });
    }

    /*
     * On a surface whose built-ins are permanent, all of them must still be
     * there. This is the server half of "you cannot delete the Dashboard's own
     * cards" — the UI offers no remove button on them, and a request that
     * omits one anyway is rejected rather than quietly honoured.
     */
    if (!rules.builtinsRemovable) {
        const missing = [...known].filter((key) => !seenBuiltins.has(key));

        if (missing.length) {
            throw new LayoutError(
                `The ${rules.label}'s own panels cannot be removed.`
            );
        }
    }

    await writeRows(userId, surface, breakpoint, rows);

    return get(userId, surface);
};

/**
 * Back to the factory arrangement.
 *
 * Deletes the stored rows rather than rewriting them to the defaults, so a
 * reset account is indistinguishable from one that never customised — and a
 * later change to the default layout reaches both.
 */
const reset = async (userId, surface) => {

    if (!surfaces.isSurface(surface)) {
        throw new LayoutError("Unknown screen.", 404);
    }

    /*
     * Both widths. "Put this screen back the way it came" means the screen,
     * not the half of it that happens to match the window right now — and a
     * reset that left a stale narrow arrangement behind would look like it had
     * silently failed the next time the window got smaller.
     */
    await DashboardCard.destroy({ where: { user_id: userId, surface } });

    return get(userId, surface);
};

module.exports = { LayoutError, get, save, reset, factoryLayout };
