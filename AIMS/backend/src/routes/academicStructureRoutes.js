/*
 * The academic structure's routes: departments, programmes, batches, sections,
 * classrooms and semesters.
 *
 * WHAT THESE REPLACE
 * ------------------
 * departmentRoutes  — one hardcoded SELECT, read-only, no way to add a department
 * programRoutes     — full CRUD with NO authenticate() on any route
 * batchRoutes       — full CRUD with NO authenticate() on any route
 * sectionRoutes     — full CRUD with NO authenticate() on any route
 * semesterRoutes    — one SELECT, read-only
 * (classrooms had no router at all)
 *
 * The three unauthenticated routers are the reason this consolidation happened
 * rather than six separate edits. `DELETE /api/sections/3` needed no token, no
 * role and no referer: it soft-deleted the class every student in it belongs to,
 * from any browser tab on the internet that could reach the port. The same was
 * true of every batch and every programme.
 *
 * THE SPLIT
 * ---------
 * Reads are open to the roles that need them. The portals all draw from these
 * tables — a parent's timetable resolves a section name, a student's fee page
 * resolves a semester — so a read gate any narrower than ACADEMIC_REFERENCE is
 * what previously left those screens rendering dashes.
 *
 * Writes are ADMINS only, every one of them, applied per-router rather than
 * per-route so that a route added below cannot be left unguarded by omission.
 */

const express = require("express");

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS, ACADEMIC_REFERENCE } = require("../config/roles");

const {
    cached,
    invalidates,
    TAGS,
    ACADEMIC_STRUCTURE_TAGS,
    TTL
} = require("../middlewares/cache.middleware");

const controller = require("../controllers/academicStructureController");

/**
 * Builds one resource's router.
 *
 * The five verbs are identical in shape for all six resources, so they are
 * declared once here. Only the read audience differs — see `readRoles`.
 */
const crudRouter = (handlers, { readRoles = ACADEMIC_REFERENCE, tag } = {}) => {
    const router = express.Router();

    // Signed in for anything at all. There is no anonymous view of the
    // institute's structure.
    router.use(authenticate);

    /*
     * CACHING.
     *
     * This is the highest-value cache in the system, and the reason is what
     * the portals do on sign-in rather than anything about these queries.
     * Every bootstrap fans out across these lists at once — the student
     * portal requests programmes, batches, sections and subjects in one
     * Promise.all, the parent portal those four plus semesters, the admin
     * announcement audience builder five of them — so ~4,000 accounts
     * arriving over a morning produce thousands of identical full-table reads
     * of data a registrar changes a few times a semester.
     *
     * `scope: 'global'` is safe here, and it is the only place in this
     * codebase where sharing one cache entry between users is correct: these
     * handlers take no account of who is asking. The list of programmes is
     * the same list for everyone authorised to see it, and `authorize` has
     * already run above — the cache sits behind the guard, never in front of
     * it, so an unauthorised caller is rejected before a cached body is ever
     * reachable.
     *
     * Only the collection is cached, not "/:id". The single-record reads are
     * not on the bootstrap path, they are already indexed lookups, and each
     * one would add an entry to the key space for no measurable gain.
     */
    router.get(
        "/",
        authorize(...readRoles),
        cached({ ttl: TTL.REFERENCE, tags: [tag, TAGS.ACADEMICS], scope: "global" }),
        handlers.list
    );

    router.get("/:id", authorize(...readRoles), handlers.read);

    /*
     * Every write drops the whole academic-structure group, not just this
     * resource's own tag.
     *
     * That is deliberate over-invalidation: these tables are joined into each
     * other's responses and into the dashboards — a section carries its
     * batch's name, the overview counts students per programme, the search
     * catalogue indexes all of them. Invalidating only `sections` after a
     * section rename would leave that old name cached in the overview and in
     * search for the rest of the TTL.
     *
     * The cost of being broad is a handful of reference queries re-run after
     * an edit that happens a few times a semester. The cost of being precise
     * and wrong is a stale name on screen with no way for the user to clear
     * it. The trade is not close.
     */
    const flush = invalidates(ACADEMIC_STRUCTURE_TAGS);

    router.post("/", authorize(...ADMINS), flush, handlers.create);
    router.put("/:id", authorize(...ADMINS), flush, handlers.update);
    router.patch("/:id", authorize(...ADMINS), flush, handlers.update);
    router.delete("/:id", authorize(...ADMINS), flush, handlers.remove);

    return router;
};

const departments = crudRouter(controller.departments, { tag: TAGS.DEPARTMENTS });
const batches = crudRouter(controller.batches, { tag: TAGS.BATCHES });
const sections = crudRouter(controller.sections, { tag: TAGS.SECTIONS });
const semesters = crudRouter(controller.semesters, { tag: TAGS.SEMESTERS });

/*
 * Classrooms are staff-facing only. A room list is not reference data a student
 * or parent portal reads — those screens get the room name already resolved on
 * the timetable row — so this one is not opened to ACADEMIC_REFERENCE.
 */
const classrooms = crudRouter(controller.classrooms, { readRoles: ADMINS, tag: TAGS.CLASSROOMS });

/*
 * Programmes keep the /search path the previous router exposed, so anything
 * already calling it does not break. It is the list endpoint with `q` — there
 * was never a second query behind it — and it is declared BEFORE the router's
 * "/:id", or "search" would be read as a programme id.
 */
const programs = express.Router();
programs.use(authenticate);
programs.get("/search", authorize(...ACADEMIC_REFERENCE), controller.programs.list);
programs.use(crudRouter(controller.programs, { tag: TAGS.PROGRAMS }));

/*
 * The whole structure in one response, for the screen that draws it as a tree.
 * Admin only: it carries every count in the institute at once.
 */
const overview = express.Router();
/*
 * The overview is an aggregate over every table above, so it is cached on the
 * shorter AGGREGATE ttl rather than the reference one — it reports counts, and
 * a count that is ten minutes old reads as a wrong number rather than as a
 * slightly old list. Every academic-structure write invalidates it by tag, so
 * the ttl only covers changes made elsewhere.
 *
 * Scoped per role, not globally: the response is Admin-only today, but a
 * global key would silently start sharing across roles the moment the audience
 * widened.
 */
overview.get(
    "/overview",
    authenticate,
    authorize(...ADMINS),
    cached({ ttl: TTL.AGGREGATE, tags: [TAGS.ACADEMICS, TAGS.DASHBOARD], scope: "role" }),
    controller.getOverview
);

module.exports = {
    departments,
    programs,
    batches,
    sections,
    classrooms,
    semesters,
    overview
};
