/*
 * The two customisable surfaces, and the rules each one plays by.
 *
 * WHY THIS LIVES ON THE SERVER
 * ----------------------------
 * The built-in panels are React components, and their keys could plausibly
 * have stayed in React. They are here because the server is the thing that has
 * to refuse a bad layout: "you may not delete the Dashboard's own tiles" and
 * "the Dashboard does not take tables" are constraints, and a constraint the
 * client alone knows is a suggestion. The frontend reads this list back from
 * GET /api/analytics/layout/:surface, so both ends decide what is removable
 * from the same sentence.
 *
 * WHY THE TWO SURFACES DIFFER
 * ---------------------------
 * The Dashboard is the institute at a glance. Its four figures, three
 * proportions and activity feed are the answer to "what is the state of the
 * place", and an account that has deleted them is looking at a dashboard that
 * no longer does the job the screen exists for. So they can be rearranged and
 * added to, but not thrown away, and they keep their sizes because a stat tile
 * stretched to half the screen is not a better stat tile.
 *
 * AI Insights is a workspace. Everything on it is analysis, all of it is
 * optional, and an admin who wants only their own pinned queries there should
 * get exactly that. So every panel on it can be moved, resized and removed —
 * and restored from the same menu that removed it.
 */

// Columns in the grid. Both surfaces use twelve, which divides by 2, 3 and 4 —
// so halves, thirds and quarters are all expressible without a remainder.
const GRID_COLUMNS = 12;

/*
 * THE TWO WIDTHS A LAYOUT CAN BE ARRANGED AT.
 *
 * 'lg' is the twelve-column desktop grid. 'sm' is a single full-width column,
 * because a three-column stat tile is a comfortable ~340px on a monitor and
 * about 150px once the window is laptop-narrow with the sidebar open — narrow
 * enough that a figure like "Rs 108.3M" wraps and the tile stops being
 * readable at a glance, which is the only thing a stat tile is for.
 *
 * 900px is where that happens with the sidebar open, so that is where the
 * grid stops pretending to be a grid.
 *
 * Both are arrangeable and each is stored separately — see the breakpoint
 * migration for why one set of coordinates cannot serve both.
 */
const BREAKPOINTS = {
    lg: { key: "lg", minWidth: 900, columns: GRID_COLUMNS },
    sm: { key: "sm", minWidth: 0, columns: 1 }
};

const BREAKPOINT_KEYS = Object.keys(BREAKPOINTS);

const isBreakpoint = (bp) => Object.hasOwn(BREAKPOINTS, String(bp));

/*
 * ONE GRID ROW IS ONE PIXEL, AND THE VERTICAL GAP IS INSIDE THE CELL.
 * ------------------------------------------------------------------
 * react-grid-layout computes an item's height as
 *
 *     h * rowHeight + (h - 1) * verticalMargin
 *
 * so the smallest height difference expressible is `rowHeight + margin`. The
 * first version of this used rowHeight 30 with a 16px margin, which made every
 * card's height a multiple of 46px — and a stat tile whose real content is
 * 150px tall could only be 138px (clipped) or 184px (a third of it empty).
 * That is why the Dashboard's tiles came out as long rectangles: the grid had
 * no way to express the height they actually wanted.
 *
 * With rowHeight 1 and NO vertical margin, `h` is simply the item's height in
 * pixels and any height is expressible exactly. The 16px gap between rows that
 * the margin used to provide is now padding inside each cell (see .pin-cell in
 * pinned.css), which keeps the spacing identical while leaving the arithmetic
 * exact.
 *
 * So every `h` below is READ AS PIXELS, and includes that 16px gap.
 */
const GRID_ROW_HEIGHT = 1;

// Horizontal gutter between columns. Vertical spacing is the cell padding
// described above, so the margin's second component is deliberately zero.
const GRID_MARGIN = 16;

// The gap baked into each card's height. Kept here so the client computes
// measured heights with the same number the defaults below were written with.
const GRID_GAP = 16;

/*
 * Built-ins, in the order they occupy an untouched screen.
 *
 * `x/y/w/h` is the factory layout: what a user who has never opened the pencil
 * menu sees, and what "Reset layout" returns them to. It reproduces the
 * previous hardcoded arrangement of both screens — four tiles across, three
 * proportions across, the feed full width — so turning the feature on changes
 * nothing until someone drags something.
 *
 * `autoHeight` is per panel, not per screen, because it is a fact about the
 * PANEL. A stat tile, a proportion panel and the activity feed each have a
 * natural height — a figure, a bar and a legend, a list with its own ceiling —
 * so they are measured and become exactly that tall. A chart has no natural
 * height at all (it fills whatever box it is given) and a long table would
 * grow to thousands of pixels if allowed to size itself, so those two keep the
 * height the grid gives them and scroll inside it.
 *
 * Getting this wrong the other way was visible immediately: with AI Insights
 * declaring `autoHeight: false` for the whole screen, its four stat tiles were
 * pinned at 166px while "Rs. 108.3M" and a three-clause supporting line needed
 * more, and the figures were clipped mid-character.
 *
 * The heights are starting values, not the last word. Where `autoHeight` is
 * set the client measures what the panel actually renders to
 * and corrects `h` to match, so a tile whose supporting line wraps onto a
 * second line grows by exactly one line rather than being clipped or padded.
 * These numbers only need to be close enough that nothing visibly jumps on the
 * first paint.
 */
const BUILTINS = {
    dashboard: [
        // Tier 1 — four figures across the top.
        { key: "stat_students", label: "Students", x: 0, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_pass_rate", label: "Pass rate", x: 3, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_fees", label: "Fees collected", x: 6, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_attendance", label: "Attendance", x: 9, y: 0, w: 3, h: 166, autoHeight: true },

        // Tier 2 — three proportions.
        { key: "panel_fee_collection", label: "Fee collection", x: 0, y: 166, w: 4, h: 266, autoHeight: true },
        { key: "panel_student_roll", label: "Student roll", x: 4, y: 166, w: 4, h: 266, autoHeight: true },
        { key: "panel_academic_standing", label: "Academic standing", x: 8, y: 166, w: 4, h: 266, autoHeight: true },

        // Tier 3 — the feed. Its list caps at 26rem and scrolls inside itself.
        { key: "feed_recent_activity", label: "Recent activity", x: 0, y: 432, w: 12, h: 502, autoHeight: true }
    ],

    /*
     * The faculty surface ships EMPTY, and that is the design rather than
     * an unfinished bit.
     *
     * Every built-in on the two admin surfaces is an institute-wide figure
     * - fee collection, the whole roll, the institute pass rate. A teacher
     * is not entitled to any of them, so there is no subset to inherit and
     * a faculty copy of them would be a permission boundary maintained in
     * a layout file, which is the wrong place for one.
     *
     * What a teacher pins instead is their own saved questions, which are
     * re-scoped to their roster on every run (savedQueries.service.run ->
     * executor.execute -> scopedSql). The screen therefore starts as an
     * empty board with an explanation on it, and fills with exactly what
     * that teacher chose to keep.
     */
    faculty_insights: [],

    /*
     * The faculty portal's landing screen, panel by panel.
     *
     * WHY THESE ARE BUILT-INS WHERE `faculty_insights` HAS NONE
     * ---------------------------------------------------------
     * The objection that keeps the insights board empty is that every admin
     * panel is an institute-wide figure a teacher may not see. It does not
     * apply here. All ten of these are the faculty dashboard's OWN panels,
     * already drawn by that screen and already served by
     * GET /api/faculty/dashboard, which resolves the teacher from their token
     * and counts nothing outside their roster. Making them arrangeable exposes
     * no figure that was not already on the screen.
     *
     * WHAT IS NOT HERE: the red welcome hero. It is the screen's greeting, it
     * is full-bleed by design, and a greeting that can be dragged into the
     * middle of the board stops reading as one. It stays fixed above the grid,
     * exactly as the admin Dashboard's greeting row does.
     *
     * The two chart panels are the only ones with `autoHeight: false`. A chart
     * fills whatever box it is given and so has no natural height to measure;
     * measuring one would just report back the height it was already told to
     * be. Everything else is text or a list and is measured.
     */
    faculty_dashboard: [
        // Tier 1 — four figures across the top, same shape as the admin's.
        { key: "stat_my_classes", label: "My classes", x: 0, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_my_students", label: "Students", x: 3, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_lectures_today", label: "Today's lectures", x: 6, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_avg_attendance", label: "Average attendance", x: 9, y: 0, w: 3, h: 166, autoHeight: true },

        // Tier 2 — the two charts.
        { key: "chart_class_performance", label: "Class performance", x: 0, y: 166, w: 7, h: 400, autoHeight: false },
        { key: "chart_grade_distribution", label: "Grade distribution", x: 7, y: 166, w: 5, h: 400, autoHeight: false },

        // Tier 3 — today, and what has been announced.
        { key: "panel_today_schedule", label: "Today's schedule", x: 0, y: 566, w: 7, h: 260, autoHeight: true },
        { key: "panel_notifications", label: "Recent notifications", x: 7, y: 566, w: 5, h: 420, autoHeight: true },

        // Tier 4 — the two long panels.
        { key: "panel_academic_insights", label: "Academic insights", x: 0, y: 986, w: 6, h: 520, autoHeight: true },
        { key: "feed_recent_activity", label: "Recent activity", x: 6, y: 986, w: 6, h: 520, autoHeight: true }
    ],

    /*
     * The Attendance screen's analytics board, panel by panel.
     *
     * WHAT IS NOT HERE, AND WHY
     * -------------------------
     * The class picker, the register table and Submit. Those are a task with an
     * order — choose, mark, submit — and an order is not something to arrange.
     * A Submit button dragged away from the table it submits is a hazard rather
     * than a preference, so everything above the analytics heading stays fixed.
     *
     * WHY 'stat_avg_attendance' IS WIDER THAN THE OTHER THREE
     * -------------------------------------------------------
     * It is the only one of the four the institute has a RULE about: 75%, the
     * same threshold facultyPortalService flags students against. The other
     * three are counts you read; this one is a figure you judge. It opens at
     * w:3 like its neighbours but its panel draws the threshold, so it earns
     * the first position rather than a bigger box.
     *
     * The two charts are the only panels with `autoHeight: false`, for the
     * reason the dashboard's charts are: a chart fills whatever box it is given
     * and so has no natural height to measure. Measuring one reports back the
     * height it was already told to be.
     */
    faculty_attendance: [
        // Tier 1 — the four figures, in the order the register is read:
        // who came, who was late, who was missing, who was excused.
        { key: "stat_avg_attendance", label: "Average attendance", x: 0, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_late_arrivals", label: "Late arrivals", x: 3, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_absences", label: "Absences", x: 6, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_leave_holiday", label: "Leave and holiday", x: 9, y: 0, w: 3, h: 166, autoHeight: true },

        // Tier 2 — the trend against the 75% line, and what the marks were.
        { key: "chart_attendance_trend", label: "Attendance trend", x: 0, y: 166, w: 7, h: 400, autoHeight: false },
        { key: "chart_status_split", label: "Status split", x: 7, y: 166, w: 5, h: 400, autoHeight: false }
    ],

    ai_insights: [
        { key: "stat_at_risk", label: "At-risk students", x: 0, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_avg_attendance", label: "Average attendance", x: 3, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_fee_collection", label: "Fee collection", x: 6, y: 0, w: 3, h: 166, autoHeight: true },
        { key: "stat_pass_rate", label: "Pass rate", x: 9, y: 0, w: 3, h: 166, autoHeight: true },

        { key: "chart_attendance_bands", label: "Attendance distribution", x: 0, y: 166, w: 6, h: 336, autoHeight: false },
        { key: "chart_monthly_collection", label: "Monthly fee collection", x: 6, y: 166, w: 6, h: 336, autoHeight: false },

        { key: "table_at_risk", label: "Students at risk", x: 0, y: 502, w: 12, h: 416, autoHeight: false },

        { key: "panel_recommendations", label: "Recommendations", x: 0, y: 918, w: 6, h: 456, autoHeight: true },
        { key: "panel_quick_stats", label: "Quick stats", x: 6, y: 918, w: 6, h: 456, autoHeight: true }
    ]
};

const SURFACES = {
    dashboard: {
        key: "dashboard",
        label: "Dashboard",

        // The screen's own panels stay. See the header.
        builtinsRemovable: false,

        /*
         * They DO resize. The rule that matters on this screen is "you cannot
         * throw the institute's figures away", not "you cannot decide how much
         * room the activity feed gets" — an admin who wants the feed at half
         * height and the fee panel at double is arranging their own desk, and
         * nothing about that damages the screen's job.
         *
         * What protects the content is the floor, not a ban: a card can never
         * be dragged shorter than the height its contents actually need. See
         * builtinsAutoHeight.
         */
        builtinsResizable: true,

        /*
         * Each built-in is exactly as tall as what it draws.
         *
         * These are the tiles, proportion panels and activity feed that used to
         * sit in a plain CSS grid, where their height was whatever their
         * content came to. Pinning them to a grid row count made them all the
         * same height, which is precisely the hierarchy the Dashboard is built
         * on — 32px figures, then 20px panels, then a 13px feed — flattened
         * into a wall of equal boxes.
         *
         * So the client measures each one and the measurement does two jobs:
         * it sets the card's STARTING height, and it is that card's permanent
         * MINIMUM. A tile opens at exactly the height its figure and
         * supporting line need, can be pulled taller by anyone who wants more
         * air, and cannot be pulled shorter than its own content — so no
         * arrangement, however enthusiastic, can hide information.
         *
         * Once someone has sized a card by hand the measurement stops driving
         * its height and only keeps raising the floor, because the height is
         * now a decision rather than a default.
         */
        builtinsAutoHeight: true,

        /*
         * Charts only. A hundred-row table dropped between the stat tiles
         * would own the screen and bury the four figures the dashboard exists
         * to show; the same query is one click away on AI Insights, which is
         * the screen for reading rows.
         */
        allowTables: false
    },

    /*
     * The faculty portal's pinboard.
     *
     * `builtinsRemovable` and the rest describe built-ins, and this
     * surface has none, so they are true only to keep the shape uniform -
     * nothing reads them for a card the user added.
     */
    faculty_insights: {
        key: "faculty_insights",
        label: "My Insights",
        builtinsRemovable: true,
        builtinsResizable: true,
        builtinsAutoHeight: false,
        allowTables: true
    },

    /*
     * The faculty portal's dashboard.
     *
     * Removable built-ins, unlike the admin Dashboard's. The rule there is
     * that an administrator cannot throw the institute's headline figures
     * away, because those figures are the screen's reason to exist and are
     * read by more people than the one arranging them. A teacher's dashboard
     * is one person's desk: a teacher who never looks at Grade Distribution
     * should be able to reclaim the room, and get it back from Customise when
     * they want it. Nothing is destroyed by hiding a panel — the card row is
     * deleted, and the panel returns to the "hidden" list.
     */
    faculty_dashboard: {
        key: "faculty_dashboard",
        label: "Dashboard",
        builtinsRemovable: true,
        builtinsResizable: true,

        /*
         * Measured, like the admin Dashboard's and unlike AI Insights'.
         *
         * These panels are text and lists whose height is a fact about their
         * contents: a schedule with four lectures is taller than one with
         * none, and a stat tile is as tall as its figure needs. The
         * measurement sets the starting height and then acts only as a floor,
         * so no arrangement can drag a panel shorter than the information it
         * holds. The two charts opt out per-panel — see BUILTINS above.
         */
        builtinsAutoHeight: true,

        /*
         * Tables allowed. The admin Dashboard forbids them because a
         * hundred-row table dropped between the stat tiles would bury the four
         * institute figures the screen exists to show. A teacher's tables are
         * their own roster — thirty rows about their own students — and this
         * is the only dashboard they have, so there is no second screen to
         * send them to for reading rows.
         */
        allowTables: true
    },

    /*
     * The Attendance screen's analytics board.
     *
     * Removable and resizable like the faculty dashboard's, and for the same
     * reason: this is one teacher's desk, not an institute-wide figure anyone
     * else depends on them keeping.
     *
     * `builtinsAutoHeight` is true so the four stat tiles open at the height
     * their figure needs and can never be dragged shorter than it. The two
     * charts opt out per-panel above.
     *
     * Tables are NOT allowed here, and this is the one place the faculty scope
     * says no. The register table is already on this screen, thirty rows of it,
     * directly above the board. A second table pinned among six summaries of
     * that same register is a duplicate of the thing it summarises. Saved
     * questions still pin here — as charts and figures, which is what a summary
     * board is for.
     */
    faculty_attendance: {
        key: "faculty_attendance",
        label: "Attendance analytics",
        builtinsRemovable: true,
        builtinsResizable: true,
        builtinsAutoHeight: true,
        allowTables: false
    },

    ai_insights: {
        key: "ai_insights",
        label: "AI Insights",
        builtinsRemovable: true,
        builtinsResizable: true,

        /*
         * Fixed, unlike the Dashboard's. Two of these panels are charts and one
         * is a long table: they have no natural height to measure — a chart
         * fills whatever box it is given — and they are resizable here, so a
         * measurement would fight the size the user just dragged.
         */
        builtinsAutoHeight: false,

        allowTables: true
    }
};

const SURFACE_KEYS = Object.keys(SURFACES);

/** True when `surface` names a real surface. */
const isSurface = (surface) => Object.hasOwn(SURFACES, String(surface));

/** The built-in keys one surface recognises, as a Set for membership tests. */
const builtinKeys = (surface) =>
    new Set((BUILTINS[surface] || []).map((b) => b.key));

/*
 * WHICH SURFACES A ROLE MAY ARRANGE.
 *
 * The route gate says who may reach /layout at all; this says which boards
 * they may reach once inside. Both are needed: without this a teacher allowed
 * through the gate could PUT a layout for "dashboard" and pin cards onto a
 * screen built out of institute-wide figures they cannot see.
 *
 * Keyed by scope.kind rather than by role id, because that is what the layout
 * service is handed and one fewer translation is one fewer place to get it
 * wrong.
 */
const SURFACES_BY_SCOPE = {
    admin: ["dashboard", "ai_insights"],
    teacher: ["faculty_insights", "faculty_dashboard", "faculty_attendance"]
};

/** True when this scope is allowed to arrange this surface. */
const mayUseSurface = (scopeKind, surface) =>
    (SURFACES_BY_SCOPE[String(scopeKind)] || []).includes(String(surface));

module.exports = {
    SURFACES_BY_SCOPE,
    mayUseSurface,
    GRID_COLUMNS,
    BREAKPOINTS,
    BREAKPOINT_KEYS,
    isBreakpoint,
    GRID_ROW_HEIGHT,
    GRID_MARGIN,
    GRID_GAP,
    BUILTINS,
    SURFACES,
    SURFACE_KEYS,
    isSurface,
    builtinKeys
};
