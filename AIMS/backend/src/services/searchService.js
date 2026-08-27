// Executes the searches declared in config/searchResources.js.
//
// Two things happen here and nowhere else:
//
//   1. resolveContext turns a token into the ids that define what the caller
//      may see (their student row, their teacher row, their children). This is
//      read from the database on every request - never from the request body -
//      so a caller cannot widen their own scope by sending an id.
//
//   2. buildQuery assembles the SQL. Identifiers come only from the registry;
//      every caller-supplied value is bound as a named replacement.

const { sequelize } = require("../database/connection");
const { ROLES } = require("../config/roles");
const { CURRENCY } = require("../config/currency");
const { RESOURCES, ROLE_ACCESS } = require("../config/searchResources");

const query = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

// A single-resource page. Kept modest because search is type-ahead: a caller
// wanting the full list should use the module's own list endpoint.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Per-resource cap when searching everything at once, so a global search does
// not return twelve full pages.
const DEFAULT_GROUP_LIMIT = 5;

// =====================================================================
// CALLER CONTEXT
// =====================================================================

// The parent login route signs parent_id into the token. role_id is signed in
// too now, but a token issued before that change has parent_id and no role, so
// it is still honoured here rather than being treated as an unknown role.
const effectiveRole = (user) => {
    if (user.role_id) return Number(user.role_id);
    if (user.parent_id) return ROLES.PARENT;
    return null;
};

const resolveStudentContext = async (userId) => {

    const rows = await query(
        `SELECT student_id, section_id, batch_id, program_id, current_semester_id
           FROM students
          WHERE user_id = :userId AND is_deleted = 0
          LIMIT 1`,
        { userId }
    );

    if (!rows.length) return {};

    return {
        own_student_id: rows[0].student_id,
        own_section_id: rows[0].section_id,
        own_batch_id: rows[0].batch_id,
        own_program_id: rows[0].program_id
    };
};

const resolveTeacherContext = async (userId) => {

    const rows = await query(
        `SELECT t.teacher_id
           FROM teachers t
           JOIN employees e ON e.employee_id = t.employee_id
          WHERE e.user_id = :userId AND t.is_deleted = 0 AND e.is_deleted = 0
          LIMIT 1`,
        { userId }
    );

    if (!rows.length) return {};

    const teacherId = rows[0].teacher_id;

    /*
     * What this teacher may see, from all three tables that can answer it.
     *
     * `teacher_assignments` is the legacy record and carries section + batch.
     *
     * `teacher_subjects` is now a QUALIFICATION and carries no batch at all
     * (migration `…140000`): it says what this teacher may teach, not which
     * cohort, so it contributes subject scope only. It previously contributed
     * a batch_id, which quietly widened a teacher's search scope to every
     * student in any batch someone had once recorded a qualification against.
     *
     * `course_offerings` is the spine and the only one the timetable module
     * writes (§3.3). Without this arm a teacher staffed through the new screen
     * resolves to no sections and no batches, and their search returns nothing.
     */
    const assignments = await query(
        `SELECT section_id, batch_id, subject_id
           FROM teacher_assignments
          WHERE teacher_id = :teacherId
         UNION
         SELECT NULL AS section_id, NULL AS batch_id, subject_id
           FROM teacher_subjects
          WHERE teacher_id = :teacherId
         UNION
         SELECT o.section_id, sec.batch_id, o.subject_id
           FROM course_offerings o
           JOIN sections sec ON sec.section_id = o.section_id
          WHERE o.teacher_id = :teacherId
            AND o.is_deleted = 0
            AND o.status <> 'Cancelled'`,
        { teacherId }
    );

    const distinct = (values) =>
        [...new Set(values.filter((v) => v !== null && v !== undefined))];

    const batchIds = distinct(assignments.map((a) => a.batch_id));

    // The programs those batches belong to, for the "courses" resource.
    const programs = batchIds.length
        ? await query(
            `SELECT DISTINCT program_id FROM batches
              WHERE batch_id IN (:batchIds) AND is_deleted = 0`,
            { batchIds }
        )
        : [];

    return {
        teacher_id: teacherId,
        teacher_section_ids: distinct(assignments.map((a) => a.section_id)),
        teacher_batch_ids: batchIds,
        teacher_subject_ids: distinct(assignments.map((a) => a.subject_id)),
        teacher_program_ids: programs.map((p) => p.program_id)
    };
};

const resolveParentContext = async (userId) => {

    const rows = await query(
        `SELECT p.parent_id, s.student_id, s.section_id
           FROM parents p
           LEFT JOIN student_guardians sg ON sg.parent_id = p.parent_id
           LEFT JOIN students s ON s.student_id = sg.student_id
                                AND s.is_deleted = 0
          WHERE p.user_id = :userId AND p.is_deleted = 0`,
        { userId }
    );

    if (!rows.length) return {};

    const children = rows.filter((r) => r.student_id !== null);

    return {
        parent_id: rows[0].parent_id,
        child_ids: [...new Set(children.map((c) => c.student_id))],
        child_section_ids: [...new Set(
            children.map((c) => c.section_id).filter(Boolean)
        )]
    };
};

const resolveContext = async (user) => {

    const role = effectiveRole(user);
    const base = { user_id: user.user_id, role_id: role };

    if (role === ROLES.STUDENT) {
        return { ...base, ...(await resolveStudentContext(user.user_id)) };
    }

    if (role === ROLES.TEACHER) {
        return { ...base, ...(await resolveTeacherContext(user.user_id)) };
    }

    if (role === ROLES.PARENT) {
        return { ...base, ...(await resolveParentContext(user.user_id)) };
    }

    return base;
};

// =====================================================================
// ACCESS
// =====================================================================

const allowedResources = (role) => ROLE_ACCESS[role] || [];

const canSearch = (role, resourceKey) =>
    allowedResources(role).includes(resourceKey);

// The catalogue a portal uses to build its search filter UI: which resources
// this role may search, and which attributes each one accepts.
const describeAccess = (role) =>
    allowedResources(role).map((key) => ({
        type: key,
        label: RESOURCES[key].label,
        fields: Object.keys(RESOURCES[key].fields),
        ranges: Object.keys(RESOURCES[key].ranges || {})
    }));

// =====================================================================
// QUERY BUILDING
// =====================================================================

// Reserved query-string keys that are not field filters.
//
// Ordering is deliberately not a caller-supplied key: each resource declares
// its own `order` in the registry. A ?sort= is therefore NOT reserved, so it
// falls through to the unknown-field check and comes back in
// `ignored_filters` - a caller that expects it to work is told it did not,
// instead of getting a differently-ordered page and assuming it did.
const RESERVED = new Set([
    "q", "type", "types", "page", "limit", "group_limit"
]);

const buildQuery = (resourceKey, params, ctx) => {

    const spec = RESOURCES[resourceKey];
    const clauses = [spec.base];
    const replacements = {};
    const unknownFields = [];

    // ---- role scope ----
    // A resource with no scope entry for this role is unscoped, which is only
    // reached by Admin and Super Admin - every other role's resources declare
    // one. notices is self-scoped for everybody, including Admin.
    const scopeFor = spec.scope && spec.scope[ctx.role_id];

    if (scopeFor) {
        clauses.push(`(${scopeFor(ctx)})`);
    }

    if (spec.selfScoped) {
        clauses.push(`${spec.selfScoped} = :ctxUserId`);
        replacements.ctxUserId = ctx.user_id;
    }

    // ---- free text ----
    if (params.q) {
        const like = spec.text.map((col) => `${col} LIKE :q`).join(" OR ");

        clauses.push(`(${like})`);
        replacements.q = `%${params.q}%`;
    }

    // ---- exact attribute filters ----
    // "Any valid database attribute" means any attribute the registry declares
    // for this resource. Anything else is reported back rather than ignored,
    // so a typo does not silently return the unfiltered list.
    for (const [key, value] of Object.entries(params)) {

        if (RESERVED.has(key) || value === undefined || value === "") continue;

        const ranges = spec.ranges || {};

        // date_from / date_to on a declared range column.
        const rangeMatch = key.match(/^(.*)_(from|to)$/);

        if (rangeMatch && ranges[rangeMatch[1]]) {
            const column = ranges[rangeMatch[1]];
            const bind = `${rangeMatch[1]}_${rangeMatch[2]}`;

            clauses.push(`${column} ${rangeMatch[2] === "from" ? ">=" : "<="} :${bind}`);
            replacements[bind] = value;
            continue;
        }

        const column = spec.fields[key];

        if (!column) {
            unknownFields.push(key);
            continue;
        }

        // Text columns filter as a contains-match so partial input works the
        // way it does in the free-text box; ids and enums must match exactly.
        const isTextual = spec.text.includes(column);

        clauses.push(isTextual ? `${column} LIKE :f_${key}` : `${column} = :f_${key}`);
        replacements[`f_${key}`] = isTextual ? `%${value}%` : value;
    }

    const where = clauses.filter(Boolean).join("\n   AND ");

    return { spec, where, replacements, unknownFields };
};

const paginate = (params, fallbackLimit) => {

    const limitNum = Number.parseInt(params.limit, 10);
    const pageNum = Number.parseInt(params.page, 10);

    const limit = Number.isInteger(limitNum) && limitNum > 0
        ? Math.min(limitNum, MAX_LIMIT)
        : fallbackLimit;

    const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1;

    return { limit, page, offset: (page - 1) * limit };
};

// One resource. Returns the rows plus the total behind them, so the portal can
// show "showing 20 of 143" without a second call.
const searchResource = async (resourceKey, params, ctx, options = {}) => {

    const { spec, where, replacements, unknownFields } =
        buildQuery(resourceKey, params, ctx);

    const { limit, page, offset } = paginate(
        params,
        options.fallbackLimit || DEFAULT_LIMIT
    );

    // A denied scope is left to SQL as the literal `1 = 0` the registry
    // produces. It is not special-cased here: short-circuiting on the text of
    // the clause would misread a scope that ORs a denial with a real predicate
    // (a teacher assigned to batches but no sections), and MySQL discards an
    // impossible WHERE without touching the table anyway.
    const [{ total }] = await query(
        `SELECT COUNT(*) AS total FROM ${spec.table} WHERE ${where}`,
        replacements
    );

    const rows = Number(total) === 0 ? [] : await query(
        `SELECT ${spec.select}
           FROM ${spec.table}
          WHERE ${where}
          ORDER BY ${spec.order}
          LIMIT :limit OFFSET :offset`,
        { ...replacements, limit, offset }
    );

    const result = {
        type: resourceKey,
        label: spec.label,
        count: rows.length,
        total: Number(total),
        page,
        limit,
        data: rows
    };

    // Money-bearing resources say so explicitly rather than leaving the portal
    // to assume a symbol.
    if (spec.money) result.currency = CURRENCY;

    if (unknownFields.length) result.ignored_filters = unknownFields;

    return result;
};

// Every resource this role may search, in one call. This is what a single
// search box at the top of a portal calls.
const searchAll = async (params, ctx) => {

    const keys = allowedResources(ctx.role_id);

    const groupLimit = Number.parseInt(params.group_limit, 10);

    const results = await Promise.all(
        keys.map((key) => searchResource(key, params, ctx, {
            fallbackLimit: Number.isInteger(groupLimit) && groupLimit > 0
                ? Math.min(groupLimit, MAX_LIMIT)
                : DEFAULT_GROUP_LIMIT
        }))
    );

    return {
        // Resources with no match are dropped so the UI does not render a
        // column of empty headings; the counts below still describe the whole
        // search.
        groups: results.filter((r) => r.total > 0),
        searched: keys,
        total_matches: results.reduce((sum, r) => sum + r.total, 0)
    };
};

module.exports = {
    resolveContext,
    effectiveRole,
    canSearch,
    allowedResources,
    describeAccess,
    searchResource,
    searchAll,
    MAX_LIMIT
};
