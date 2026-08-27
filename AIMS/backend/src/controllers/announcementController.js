const { sequelize } = require("../database/connection");
const announcementService = require("../services/announcementService");
const { ROLES } = require("../config/roles");

// announcements.target_role holds role names, so the caller's role_id is
// mapped back to the name the column uses. Still needed for announcements
// published before targeting existed, which carry no audience rules.
const ROLE_NAME = {
    [ROLES.SUPER_ADMIN]: "Admin",
    [ROLES.ADMIN]: "Admin",
    [ROLES.TEACHER]: "Teacher",
    [ROLES.STUDENT]: "Student",
    [ROLES.PARENT]: "Parent",
    [ROLES.HR]: "HR",
    [ROLES.ACCOUNTANT]: "Accountant",
    [ROLES.LIBRARY]: "Library Staff"
};

const isAdmin = (user) =>
    user.role_id === ROLES.SUPER_ADMIN || user.role_id === ROLES.ADMIN;

/*
 * AUDIENCE VALIDATION
 *
 * A rule names real rows, so every id is checked against its table before the
 * announcement is saved. Without this a typo silently produces an announcement
 * nobody can ever read - it would be addressed to a batch that does not exist,
 * and would simply never match anybody.
 */
const TARGET_FIELDS = {
    role_id: { table: "roles", column: "role_id", label: "role" },
    program_id: { table: "programs", column: "program_id", label: "programme" },
    batch_id: { table: "batches", column: "batch_id", label: "batch" },
    section_id: { table: "sections", column: "section_id", label: "section" },
    semester_id: { table: "semesters", column: "semester_id", label: "semester" },
    user_id: { table: "users", column: "user_id", label: "user" }
};

const toId = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : undefined; // undefined = invalid
};

/**
 * Normalises and checks the audience the caller sent.
 *
 * Returns { targets } on success or { error } with a message naming the field
 * at fault, so the admin portal can show which filter was wrong.
 */
const normalizeTargets = async (raw) => {
    if (raw === undefined) return { targets: undefined };
    if (raw === null) return { targets: [] };

    if (!Array.isArray(raw)) {
        return { error: "targets must be an array of audience rules" };
    }

    const targets = [];

    for (const [index, rule] of raw.entries()) {
        if (!rule || typeof rule !== "object") {
            return { error: `targets[${index}] must be an object` };
        }

        const normalized = {};
        let filled = 0;

        for (const [field, meta] of Object.entries(TARGET_FIELDS)) {
            const id = toId(rule[field]);

            if (id === undefined) {
                return { error: `targets[${index}].${field} must be a positive integer` };
            }

            normalized[field] = id;
            if (id !== null) filled += 1;
        }

        // A rule with nothing set matches everybody, which is what an
        // announcement with no rules already means. Allowing it would make
        // "targeted at nobody in particular" indistinguishable from a mistake.
        if (filled === 0) {
            return {
                error: `targets[${index}] sets no filter. Leave targets empty to address everyone.`
            };
        }

        targets.push(normalized);
    }

    // Every referenced row must exist. Checked in one pass per table.
    for (const [field, meta] of Object.entries(TARGET_FIELDS)) {
        const ids = [...new Set(targets.map((t) => t[field]).filter((v) => v !== null))];
        if (!ids.length) continue;

        const rows = await sequelize.query(
            `SELECT ${meta.column} AS id FROM ${meta.table} WHERE ${meta.column} IN (:ids)`,
            { type: sequelize.QueryTypes.SELECT, replacements: { ids } }
        );

        const found = new Set(rows.map((r) => Number(r.id)));
        const missing = ids.filter((id) => !found.has(id));

        if (missing.length) {
            return { error: `No such ${meta.label}: ${missing.join(", ")}` };
        }
    }

    return { targets };
};

// ================= LIST =================
// GET /api/announcements
//
// An admin sees every announcement and may filter by ?target_role=. Everyone
// else sees only what is addressed to them - by audience rule where the
// announcement has them, and by target_role where it does not.
const getAnnouncements = async (req, res) => {

    try {

        const viewer = isAdmin(req.user)
            ? null
            : await announcementService.describeViewer(req.user);

        const { rows, total } = await announcementService.getAnnouncements(
            req.query,
            viewer,
            ROLE_NAME[req.user.role_id]
        );

        return res.status(200).json({
            success: true,
            count: rows.length,
            total,
            page: Number.parseInt(req.query.page, 10) || 1,
            limit: Number.parseInt(req.query.limit, 10) || undefined,
            /*
             * What the filter dropdowns may offer, read from the notices that
             * exist. A filter that lists a value matching nothing is worse
             * than no filter: it looks like a working query returning nothing.
             * Admins only — a non-admin's list is already narrowed to them.
             */
            options: isAdmin(req.user) ? await announcementService.getFilterOptions() : undefined,
            data: rows
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load announcements"
        });

    }

};

// ================= ONE =================
const getAnnouncement = async (req, res) => {

    try {

        const announcement = await announcementService.getAnnouncementById(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found"
            });
        }

        // Same audience rule as the list, so a direct id cannot be used to read
        // a notice meant for somebody else.
        if (!isAdmin(req.user)) {

            const viewer = await announcementService.describeViewer(req.user);

            const allowed = await announcementService.canViewerRead(
                announcement.announcement_id,
                viewer,
                ROLE_NAME[req.user.role_id]
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: "This announcement is not addressed to you"
                });
            }

        }

        return res.status(200).json({
            success: true,
            data: announcement
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load announcement"
        });

    }

};

// ================= CREATE =================
// Body: { title, content, target_role, targets? }
//
// `targets` is the audience: a list of rules, each naming any combination of
// role, programme, batch, section, semester and user. Within a rule every value
// set must match the reader; the rules themselves OR together. Omit it, or send
// an empty list, to fall back to target_role.
const createAnnouncement = async (req, res) => {

    try {

        const { title, content, target_role, targets } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: "title and content are required"
            });
        }

        const audience = await normalizeTargets(targets);

        if (audience.error) {
            return res.status(400).json({
                success: false,
                message: audience.error
            });
        }

        // target_role stays required when no audience rules are given, because
        // it is then the only thing deciding who can read the announcement.
        if (!audience.targets?.length && !target_role) {
            return res.status(400).json({
                success: false,
                message: "Provide either target_role or at least one entry in targets"
            });
        }

        // Only Admin may address an announcement at a specific audience.
        // Teachers publish to their classes through target_role.
        if (audience.targets?.length && !isAdmin(req.user)) {
            return res.status(403).json({
                success: false,
                message: "Only an administrator may target an announcement"
            });
        }

        const announcement = await announcementService.createAnnouncement(
            {
                title,
                content,
                // A targeted announcement still needs a value in the NOT NULL
                // column; "Targeted" records that the rules are what decide.
                target_role: target_role || "Targeted",
                targets: audience.targets
            },
            req.user.user_id
        );

        return res.status(201).json({
            success: true,
            message: "Announcement published",
            data: announcement
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to publish announcement"
        });

    }

};

// ================= UPDATE =================
const updateAnnouncement = async (req, res) => {

    try {

        const audience = await normalizeTargets(req.body.targets);

        if (audience.error) {
            return res.status(400).json({
                success: false,
                message: audience.error
            });
        }

        if (audience.targets !== undefined && !isAdmin(req.user)) {
            return res.status(403).json({
                success: false,
                message: "Only an administrator may target an announcement"
            });
        }

        const announcement = await announcementService.updateAnnouncement(
            req.params.id,
            { ...req.body, targets: audience.targets }
        );

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Announcement updated",
            data: announcement
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to update announcement"
        });

    }

};

// ================= DELETE =================
const deleteAnnouncement = async (req, res) => {

    try {

        const announcement = await announcementService.deleteAnnouncement(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Announcement deleted"
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to delete announcement"
        });

    }

};

module.exports = {
    getAnnouncements,
    getAnnouncement,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement
};
