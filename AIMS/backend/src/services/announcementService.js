const { sequelize } = require("../database/connection");
const Announcement = require("../models/announcement.model");
const AnnouncementTarget = require("../models/announcementTarget.model");

// Announcements carry `posted_by` (a users row) but no author name, since the
// users table has no name column - a person's name lives on students, parents
// or employees. This resolves it the same way userService.attachNames does, so
// a portal that wants to show who published a notice can.

const SELECT_WITH_AUTHOR = `
    SELECT
        a.announcement_id,
        a.title,
        a.content,
        a.target_role,
        a.posted_by,
        a.created_at,
        COALESCE(
            CONCAT(e.first_name, ' ', e.last_name),
            CONCAT(s.first_name, ' ', s.last_name),
            CONCAT(p.first_name, ' ', p.last_name)
        )                    AS posted_by_name,
        e.designation        AS posted_by_designation,
        r.role_name          AS posted_by_role
    FROM announcements a
    LEFT JOIN users     u ON u.user_id = a.posted_by
    LEFT JOIN roles     r ON r.role_id = u.role_id
    LEFT JOIN employees e ON e.user_id = a.posted_by AND e.is_deleted = 0
    LEFT JOIN students  s ON s.user_id = a.posted_by AND s.is_deleted = 0
    LEFT JOIN parents   p ON p.user_id = a.posted_by AND p.is_deleted = 0
`;

/*
 * WHO CAN SEE AN ANNOUNCEMENT
 * ---------------------------
 * Two mechanisms, checked in this order for each announcement:
 *
 *   1. announcement_targets rows, if it has any. One row is one audience rule:
 *      every column set on that row must match the reader. Rows OR together, so
 *      an announcement can reach "batch 1 section CS-4A" and "batch 2" at once.
 *
 *   2. announcements.target_role, when it has no target rows. This is the
 *      original mechanism - a single role name, or the catch-alls "All" and
 *      "Everyone" - and everything published before targeting existed relies on
 *      it, so it is still honoured rather than migrated away.
 *
 * The reader is described by `viewer`: their role and user id always, plus
 * their academic placement when they are a student. The placement columns can
 * only ever match a student, which is what makes "announce to batch X" mean the
 * students of batch X and not their teachers.
 */

// The rule columns, paired with the field on the viewer they are checked
// against. Kept as data so the SQL below and the validation in the controller
// cannot drift apart.
const TARGET_DIMENSIONS = [
    { column: "role_id", viewerField: "roleId" },
    { column: "program_id", viewerField: "programId" },
    { column: "batch_id", viewerField: "batchId" },
    { column: "section_id", viewerField: "sectionId" },
    { column: "semester_id", viewerField: "semesterId" },
    { column: "user_id", viewerField: "userId" }
];

/**
 * Resolves the reader's identity for targeting.
 *
 * A student's placement is read from their own row rather than taken from the
 * request, so an announcement aimed at one batch cannot be read by claiming to
 * be in it.
 */
const describeViewer = async (user) => {
    const viewer = {
        userId: user.user_id ?? null,
        roleId: user.role_id ?? null,
        programId: null,
        batchId: null,
        sectionId: null,
        semesterId: null
    };

    const rows = await sequelize.query(
        `SELECT program_id, batch_id, section_id, current_semester_id
           FROM students
          WHERE user_id = :user_id AND is_deleted = 0
          LIMIT 1`,
        { type: sequelize.QueryTypes.SELECT, replacements: { user_id: viewer.userId } }
    );

    if (rows.length) {
        viewer.programId = rows[0].program_id ?? null;
        viewer.batchId = rows[0].batch_id ?? null;
        viewer.sectionId = rows[0].section_id ?? null;
        viewer.semesterId = rows[0].current_semester_id ?? null;
    }

    return viewer;
};

/**
 * The WHERE fragment that limits announcements to the ones this viewer may
 * read, plus the replacements it needs. Returns null for an admin, who sees
 * everything.
 */
const audienceClause = (viewer, audienceRoleName) => {
    const replacements = {
        viewer_user_id: viewer.userId,
        viewer_role_id: viewer.roleId,
        viewer_program_id: viewer.programId,
        viewer_batch_id: viewer.batchId,
        viewer_section_id: viewer.sectionId,
        viewer_semester_id: viewer.semesterId,
        audience: audienceRoleName
    };

    // A rule column matches when it is NULL (not filtered on) or equals the
    // viewer's own value. A viewer with no value for a dimension - a teacher has
    // no batch - fails any rule that filters on it, which is what stops a
    // batch-targeted notice reaching staff.
    const ruleMatch = TARGET_DIMENSIONS
        .map(({ column, viewerField }) => {
            const param = `viewer_${column}`;
            void viewerField;
            return `(t.${column} IS NULL OR t.${column} = :${param})`;
        })
        .join(" AND ");

    const where = `
        (
            EXISTS (
                SELECT 1 FROM announcement_targets t
                 WHERE t.announcement_id = a.announcement_id
                   AND ${ruleMatch}
            )
            OR (
                NOT EXISTS (
                    SELECT 1 FROM announcement_targets t2
                     WHERE t2.announcement_id = a.announcement_id
                )
                AND (a.target_role = :audience OR a.target_role IN ('All', 'Everyone'))
            )
        )`;

    return { where, replacements };
};

/**
 * Optional filters: target_role, q (free text), from / to (posted date),
 * posted_by, sort, plus page/limit.
 *
 * `viewer` is the resolved reader. When given, only announcements addressed to
 * them come back. Admins pass no viewer and see all of them.
 *
 * The admin notice board had no filter of any kind: it called list() with no
 * arguments and rendered whatever came back. That is workable at fourteen
 * notices and not at four hundred, and the filters below are the ones the
 * board is actually searched by — what it says, who it was for, when it went
 * out, and who sent it.
 */
const getAnnouncements = async (options = {}, viewer = null, audienceRoleName = null) => {

    const { target_role, q, from, to, posted_by, sort, page, limit } = options;

    const conditions = [];
    let replacements = {};

    if (viewer) {
        const clause = audienceClause(viewer, audienceRoleName);
        conditions.push(clause.where);
        replacements = { ...replacements, ...clause.replacements };
    } else if (target_role) {
        conditions.push("a.target_role = :target_role");
        replacements.target_role = target_role;
    }

    // Title AND body: an admin looking for "convocation" is as likely to
    // remember a phrase from the notice as its headline.
    if (q) {
        conditions.push("(a.title LIKE :q OR a.content LIKE :q)");
        replacements.q = `%${q}%`;
    }

    // Posted-date window. Inclusive of the whole `to` day — a date-only bound
    // compared against a DATETIME otherwise excludes everything sent that day.
    if (from) {
        conditions.push("a.created_at >= :from");
        replacements.from = from;
    }
    if (to) {
        conditions.push("a.created_at < DATE_ADD(:to, INTERVAL 1 DAY)");
        replacements.to = to;
    }

    if (posted_by) {
        conditions.push("a.posted_by = :posted_by");
        replacements.posted_by = posted_by;
    }

    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

    const [{ total }] = await sequelize.query(
        `SELECT COUNT(*) AS total FROM announcements a${where}`,
        { type: sequelize.QueryTypes.SELECT, replacements }
    );

    // Whitelisted, never interpolated from request input.
    const ORDER = {
        newest: "a.created_at DESC",
        oldest: "a.created_at ASC",
        title: "a.title ASC",
        audience: "a.target_role ASC, a.created_at DESC"
    };
    let sql = `${SELECT_WITH_AUTHOR}${where} ORDER BY ${ORDER[sort] || ORDER.newest}`;

    const limitNum = Number.parseInt(limit, 10);
    const pageNum = Number.parseInt(page, 10);

    if (Number.isInteger(limitNum) && limitNum > 0) {
        replacements.limit = limitNum;
        replacements.offset = Number.isInteger(pageNum) && pageNum > 1
            ? (pageNum - 1) * limitNum
            : 0;
        sql += " LIMIT :limit OFFSET :offset";
    }

    const rows = await sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

    await attachTargets(rows);

    return { rows, total: Number(total) };
};

/**
 * Hangs each announcement's audience rules off it, with the programme, batch,
 * section and role resolved to names so the admin portal can show what an
 * announcement is addressed to without looking every id up itself.
 */
const attachTargets = async (rows) => {
    if (!rows.length) return rows;

    const ids = rows.map((r) => r.announcement_id);

    const targets = await sequelize.query(
        `SELECT t.target_id, t.announcement_id,
                t.role_id, t.program_id, t.batch_id, t.section_id,
                t.semester_id, t.user_id,
                r.role_name,
                pr.program_name,
                b.batch_name,
                sec.section_name,
                sem.semester_number,
                u.email AS user_email,
                COALESCE(
                    CONCAT(e.first_name, ' ', e.last_name),
                    CONCAT(st.first_name, ' ', st.last_name),
                    CONCAT(pa.first_name, ' ', pa.last_name)
                ) AS user_name
           FROM announcement_targets t
           LEFT JOIN roles     r   ON r.role_id       = t.role_id
           LEFT JOIN programs  pr  ON pr.program_id   = t.program_id
           LEFT JOIN batches   b   ON b.batch_id      = t.batch_id
           LEFT JOIN sections  sec ON sec.section_id  = t.section_id
           LEFT JOIN semesters sem ON sem.semester_id = t.semester_id
           LEFT JOIN users     u   ON u.user_id       = t.user_id
           LEFT JOIN employees e   ON e.user_id  = t.user_id AND e.is_deleted = 0
           LEFT JOIN students  st  ON st.user_id = t.user_id AND st.is_deleted = 0
           LEFT JOIN parents   pa  ON pa.user_id = t.user_id AND pa.is_deleted = 0
          WHERE t.announcement_id IN (:ids)`,
        { type: sequelize.QueryTypes.SELECT, replacements: { ids } }
    );

    const byAnnouncement = new Map();
    for (const t of targets) {
        if (!byAnnouncement.has(t.announcement_id)) byAnnouncement.set(t.announcement_id, []);
        byAnnouncement.get(t.announcement_id).push(t);
    }

    for (const row of rows) {
        row.targets = byAnnouncement.get(row.announcement_id) || [];
        // What the announcement is addressed to, in one line, so a list view
        // does not have to assemble it. Falls back to the legacy column when
        // there are no rules.
        row.audience_label = row.targets.length
            ? row.targets.map(describeTarget).join(" · ")
            : (row.target_role || null);
    }

    return rows;
};

/** One audience rule as readable text, e.g. "BSCS-2022 / CS-4A". */
const describeTarget = (t) => {
    const parts = [];
    if (t.user_name || t.user_email) parts.push(t.user_name || t.user_email);
    if (t.role_name) parts.push(`${t.role_name}s`);
    if (t.program_name) parts.push(t.program_name);
    if (t.batch_name) parts.push(t.batch_name);
    if (t.section_name) parts.push(t.section_name);
    if (t.semester_number) parts.push(`Semester ${t.semester_number}`);
    return parts.length ? parts.join(" / ") : "Everyone";
};

const getAnnouncementById = async (id) => {

    const rows = await sequelize.query(
        `${SELECT_WITH_AUTHOR} WHERE a.announcement_id = :id`,
        { type: sequelize.QueryTypes.SELECT, replacements: { id } }
    );

    if (!rows.length) return null;

    await attachTargets(rows);

    return rows[0];
};

/**
 * Whether one announcement is addressed to this viewer. Used for reads by id,
 * so a notice cannot be pulled up by guessing its number.
 */
const canViewerRead = async (announcementId, viewer, audienceRoleName) => {
    const clause = audienceClause(viewer, audienceRoleName);

    const rows = await sequelize.query(
        `SELECT 1 AS allowed
           FROM announcements a
          WHERE a.announcement_id = :id AND ${clause.where}
          LIMIT 1`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { ...clause.replacements, id: announcementId }
        }
    );

    return rows.length > 0;
};

/**
 * Replaces an announcement's audience rules.
 *
 * Passing an empty list clears targeting and leaves the announcement resolved
 * from target_role alone, which is how "everyone" is expressed.
 */
const setTargets = async (announcementId, targets, transaction = null) => {
    await AnnouncementTarget.destroy({
        where: { announcement_id: announcementId },
        transaction
    });

    if (!targets || !targets.length) return [];

    return await AnnouncementTarget.bulkCreate(
        targets.map((t) => ({
            announcement_id: announcementId,
            role_id: t.role_id ?? null,
            program_id: t.program_id ?? null,
            batch_id: t.batch_id ?? null,
            section_id: t.section_id ?? null,
            semester_id: t.semester_id ?? null,
            user_id: t.user_id ?? null,
            created_at: new Date()
        })),
        { transaction }
    );
};

// posted_by comes from the token, not the body, so an announcement can never
// be attributed to somebody else.
const createAnnouncement = async ({ title, content, target_role, targets }, postedByUserId) => {

    return await sequelize.transaction(async (transaction) => {
        const created = await Announcement.create(
            {
                title,
                content,
                target_role,
                posted_by: postedByUserId,
                created_at: new Date()
            },
            { transaction }
        );

        await setTargets(created.announcement_id, targets, transaction);

        return created.announcement_id;
    }).then((id) => getAnnouncementById(id));
};

const updateAnnouncement = async (id, updates) => {

    const announcement = await Announcement.findByPk(id);

    if (!announcement) return null;

    await sequelize.transaction(async (transaction) => {
        const allowed = {};
        if (updates.title !== undefined) allowed.title = updates.title;
        if (updates.content !== undefined) allowed.content = updates.content;
        if (updates.target_role !== undefined) allowed.target_role = updates.target_role;

        if (Object.keys(allowed).length) {
            await announcement.update(allowed, { transaction });
        }

        // Only touched when the caller actually sent an audience, so a request
        // that just fixes a typo does not silently unpublish the targeting.
        if (updates.targets !== undefined) {
            await setTargets(id, updates.targets, transaction);
        }
    });

    return await getAnnouncementById(id);
};

const deleteAnnouncement = async (id) => {

    const announcement = await Announcement.findByPk(id);

    if (!announcement) return null;

    // The table has no is_deleted column, so this is a real delete. The target
    // rows go with it through ON DELETE CASCADE.
    await announcement.destroy();

    return announcement;
};

/*
 * The values the notice board's filters may offer, read from the notices that
 * actually exist.
 *
 * Both lists carry a count, so an admin can see that "Teacher" holds four
 * notices before choosing it — and so an audience with none simply is not
 * offered.
 */
const getFilterOptions = async () => {
    const [audiences, authors] = await Promise.all([
        sequelize.query(
            `SELECT COALESCE(target_role, 'Targeted') AS value, COUNT(*) AS count
               FROM announcements
              GROUP BY COALESCE(target_role, 'Targeted')
              ORDER BY count DESC, value ASC`,
            { type: sequelize.QueryTypes.SELECT }
        ),
        // The author's name comes from `employees`; an account with no employee
        // row falls back to its email so the option is never blank.
        sequelize.query(
            `SELECT a.posted_by AS value,
                    COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name,''), ' ',
                                                COALESCE(e.last_name,''))), ''),
                             u.email, CONCAT('User ', a.posted_by)) AS label,
                    COUNT(*) AS count
               FROM announcements a
               LEFT JOIN users u     ON u.user_id = a.posted_by
               LEFT JOIN employees e ON e.user_id = a.posted_by AND e.is_deleted = 0
              WHERE a.posted_by IS NOT NULL
              GROUP BY a.posted_by, label
              ORDER BY count DESC, label ASC`,
            { type: sequelize.QueryTypes.SELECT }
        )
    ]);

    return {
        audiences: audiences.map((a) => ({ value: a.value, count: Number(a.count) })),
        authors: authors.map((a) => ({
            value: a.value,
            label: a.label,
            count: Number(a.count)
        }))
    };
};

module.exports = {
    getAnnouncements,
    getFilterOptions,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    describeViewer,
    canViewerRead,
    setTargets,
    TARGET_DIMENSIONS
};
