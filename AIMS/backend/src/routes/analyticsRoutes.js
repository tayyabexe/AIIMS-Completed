/*
 * AI Analytics — the data route.
 *
 * Separate from /api/chatbot on purpose. That route answers questions about
 * how the system works, from a document corpus. This one answers questions
 * about what is in the database, and returns rows rather than prose.
 *
 * Keeping them apart means the chatbot cannot reach a query tool by being
 * talked into it, and analytics cannot drift into narrating results, because
 * neither has the other's machinery wired up.
 */

const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const assistantRateLimit = require("../middlewares/assistantRateLimit.middleware");

const { cached, invalidates, TAGS, TTL } = require("../middlewares/cache.middleware");

const { ANALYTICS_ROLES } = require("../config/analytics");
const { ADMINS, ROLES } = require("../config/roles");
const { ask, capabilities } = require("../controllers/analyticsController");
const saved = require("../controllers/savedAnalyticsController");

/*
 * Narrower than the chatbot's gate. Students are excluded — every figure a
 * student is entitled to already has a purpose-built screen, and a free-form
 * query channel over one's own single record adds risk without adding an
 * answer they could not already get.
 */
router.use(authenticate, authorize(...ANALYTICS_ROLES));

// One question, one result set. Rate limited because it costs a model call.
router.post("/ask", assistantRateLimit, ask);

// What this account can ask about; drives the canvas suggestions.
router.get("/capabilities", capabilities);

/*
 * PINNED ANALYTICS — saved queries and the two customisable layouts.
 *
 * Admins only, narrower again than the gate above.
 *
 * Teachers can ask questions and always could; what they cannot do yet is pin
 * the answer to a screen, because neither screen this feature customises is
 * theirs. The Dashboard and AI Insights are admin-portal modules — a teacher
 * signing in never reaches either — so a teacher's saved card would have
 * nowhere to be dropped. When the faculty portal grows a surface worth
 * customising, this gate is the one line that has to widen, and the storage
 * and the guards underneath it already handle a teacher's scope correctly.
 *
 * Deliberately NOT behind assistantRateLimit. That limiter exists to protect
 * the model token budget, and none of these endpoints calls a model: opening a
 * dashboard fires one of these per card, and throttling twelve replayed
 * queries as though they were twelve new questions would make a customised
 * dashboard unusable in order to save nothing.
 */
/*
 * Teachers pin too, as of the faculty analytics screen.
 *
 * The note above used to say a teacher's saved card would have nowhere to
 * be dropped, and that was true while the only two boards were admin-portal
 * modules. There is now a third, faculty_insights, which a teacher reaches
 * from their own portal, and the storage underneath always handled a
 * teacher's scope correctly.
 *
 * This gate answers "may this account pin at all". WHICH board they may
 * arrange is a separate question, because the board is a URL parameter -
 * see requireSurface in savedAnalyticsController and SURFACES_BY_SCOPE in
 * config/dashboardCards. Widening this line alone would have let a teacher
 * PUT a layout for the admin Dashboard, so the two changes belong together.
 *
 * Students and parents are still absent, and not by omission: they are
 * refused by the ANALYTICS_ROLES gate at the top of this file long before
 * reaching here, because they have no question-asking route to save from.
 */
const PINNERS = [...ADMINS, ROLES.TEACHER];

router.use("/saved", authorize(...PINNERS));
router.use("/layout", authorize(...PINNERS));

/*
 * CACHING, AND THE ONE THING THAT MAKES IT SAFE HERE
 * --------------------------------------------------
 * `scope: "user"` — and it must be. Every other cached route in this codebase
 * holds data that is either identical for everyone or identical within a role;
 * this one holds one admin's private library and their personal arrangement of
 * two screens. Cached at 'role' it would serve one admin's saved queries to
 * another, which is a privacy breach that no test with a single account would
 * ever surface. See buildKey in cache.middleware.js.
 *
 * Every write below is wrapped in `flushPinned`, so the cache is dropped the
 * moment the user changes anything and the TTL is only a backstop for the
 * multi-instance case the cache module documents. Both surfaces share the tag
 * because the layout response embeds the saved-query library — renaming a
 * saved query changes what the Dashboard's response should say just as much as
 * what AI Insights' does.
 */
const flushPinned = invalidates([TAGS.PINNED]);

// The strip's contents, on their own. The screens do not use this — their
// layout response carries the library with it — but the canvas reads it after
// a save to refresh without a reload.
router.get(
    "/saved",
    cached({ ttl: TTL.AGGREGATE, tags: [TAGS.PINNED], scope: "user" }),
    saved.listSaved
);

router.post("/saved", flushPinned, saved.createSaved);
router.patch("/saved/:id", flushPinned, saved.updateSaved);
router.delete("/saved/:id", flushPinned, saved.deleteSaved);

/*
 * Re-runs the stored plan. See savedQueries.service — no model is involved.
 *
 * Deliberately NOT cached. This is the one endpoint here that reads the
 * institute's actual data rather than the furniture around it, and a pinned
 * card showing a figure from a minute ago is exactly what the whole design
 * refuses: the point of storing a plan instead of its rows is that opening a
 * dashboard asks the database again.
 */
router.post("/saved/:id/run", saved.runSaved);

router.get(
    "/layout/:surface",
    cached({ ttl: TTL.AGGREGATE, tags: [TAGS.PINNED], scope: "user" }),
    saved.getLayout
);

router.put("/layout/:surface", flushPinned, saved.saveLayout);
router.delete("/layout/:surface", flushPinned, saved.resetLayout);

module.exports = router;
