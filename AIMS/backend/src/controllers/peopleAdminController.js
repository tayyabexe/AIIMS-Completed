/*
 * CRUD handlers for staff accounts and parents.
 *
 * Thin, like academicStructureController: everything that decides what is
 * allowed lives in peopleAdminService, because the guards are properties of the
 * data — who is a Super Admin, whether this parent still has children — and not
 * of the HTTP request. What is left here is the mapping to status codes and the
 * audit entry.
 *
 * WHY THE ACTOR IS PASSED DOWN
 * ----------------------------
 * Three of the rules in that service are about the person making the request,
 * not the row being changed: you cannot delete your own account, only a Super
 * Admin may touch a Super Admin, and the last Super Admin cannot be removed. So
 * `req.user` travels into the service rather than being checked here — a guard
 * in the controller is one every future call site has to remember to repeat.
 *
 * A CREATED ACCOUNT RETURNS ITS PASSWORD ONCE
 * -------------------------------------------
 * Both create handlers respond with a one-time plaintext password and then it is
 * gone; there is no endpoint that can read it back. It is deliberately kept out
 * of the audit `after` snapshot — auditService strips password-shaped keys
 * anyway, but this does not rely on that.
 */

const service = require("../services/peopleAdminService");
const audit = require("../services/auditService");

/*
 * A service error carrying `status` is a statement about the request — the email
 * is taken, this parent still has children, you cannot delete yourself — and the
 * caller can act on it. Anything else is this service being broken and must not
 * have its internals echoed back.
 */
const respondToError = (res, error, what) => {
    if (error && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        return res.status(error.status).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }

    console.error(`[people/${what}]`, error);

    return res.status(500).json({
        success: false,
        message: `Failed to ${what}.`
    });
};

const idFrom = (req, res, param = "id") => {
    const id = Number.parseInt(req.params[param], 10);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ success: false, message: `A numeric ${param} is required.` });
        return null;
    }

    return id;
};

/** The account row without the one-time password, for the audit snapshot. */
const withoutPassword = ({ password, ...rest }) => rest;

// ==========================================================================
// STAFF ACCOUNTS
// ==========================================================================

const listAdmins = async (req, res) => {
    try {
        const data = await service.listAdmins(req.query);
        return res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        return respondToError(res, error, "load staff accounts");
    }
};

const createAdmin = async (req, res) => {
    try {
        const row = await service.createAdmin(req.body || {}, req.user);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ADMIN_CREATED,
            module: audit.MODULES.PEOPLE,
            entity: `users#${row.userId}`,
            after: withoutPassword(row),
            req
        });

        return res.status(201).json({
            success: true,
            message: `${row.role} account created for ${row.email}.`,
            data: row,
            // Surfaced separately so the screen shows it in the one-time
            // credentials dialog rather than rendering it into the row.
            credentials: {
                userId: row.userId,
                email: row.email,
                password: row.password
            }
        });
    } catch (error) {
        return respondToError(res, error, "create the staff account");
    }
};

const updateAdmin = async (req, res) => {
    const userId = idFrom(req, res, "userId");
    if (userId === null) return undefined;

    try {
        // Read first so the audit entry can say what it was, not only what it
        // became. A role change is only legible as a pair.
        const before = await service.getAdmin(userId);
        const row = await service.updateAdmin(userId, req.body || {}, req.user);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ADMIN_UPDATED,
            module: audit.MODULES.PEOPLE,
            entity: `users#${userId}`,
            before,
            after: row,
            req
        });

        return res.status(200).json({
            success: true,
            message: "Staff account updated.",
            data: row
        });
    } catch (error) {
        return respondToError(res, error, "update the staff account");
    }
};

const deleteAdmin = async (req, res) => {
    const userId = idFrom(req, res, "userId");
    if (userId === null) return undefined;

    try {
        const before = await service.getAdmin(userId);
        const result = await service.deleteAdmin(userId, req.user);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.ADMIN_DELETED,
            module: audit.MODULES.PEOPLE,
            entity: `users#${userId}`,
            before,
            req
        });

        return res.status(200).json({
            success: true,
            message: "Staff account deleted and its login disabled.",
            data: result
        });
    } catch (error) {
        return respondToError(res, error, "delete the staff account");
    }
};

// ==========================================================================
// PARENTS
// ==========================================================================

const createParent = async (req, res) => {
    try {
        const row = await service.createParent(req.body || {});

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PARENT_CREATED,
            module: audit.MODULES.PEOPLE,
            entity: `parents#${row.parentId}`,
            after: withoutPassword(row),
            req
        });

        return res.status(201).json({
            success: true,
            message: `Parent account created for ${row.email}.`,
            data: row,
            credentials: {
                userId: row.userId,
                email: row.email,
                password: row.password
            }
        });
    } catch (error) {
        return respondToError(res, error, "create the parent");
    }
};

const updateParent = async (req, res) => {
    const parentId = idFrom(req, res);
    if (parentId === null) return undefined;

    try {
        const before = await service.getParent(parentId);
        const row = await service.updateParent(parentId, req.body || {});

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PARENT_UPDATED,
            module: audit.MODULES.PEOPLE,
            entity: `parents#${parentId}`,
            before,
            after: row,
            req
        });

        return res.status(200).json({
            success: true,
            message: "Parent updated.",
            data: row
        });
    } catch (error) {
        return respondToError(res, error, "update the parent");
    }
};

const deleteParent = async (req, res) => {
    const parentId = idFrom(req, res);
    if (parentId === null) return undefined;

    try {
        const before = await service.getParent(parentId);
        const result = await service.deleteParent(parentId);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PARENT_DELETED,
            module: audit.MODULES.PEOPLE,
            entity: `parents#${parentId}`,
            before,
            req
        });

        return res.status(200).json({
            success: true,
            message: "Parent deleted and their login disabled.",
            data: result
        });
    } catch (error) {
        return respondToError(res, error, "delete the parent");
    }
};

/*
 * Linking and unlinking a child.
 *
 * Both are audited, and both record the pair rather than the parent alone: "who
 * attached this child to this guardian" is the question a wrong link produces,
 * and the row itself only shows where the link is now.
 */
const linkChild = async (req, res) => {
    const parentId = idFrom(req, res);
    if (parentId === null) return undefined;

    try {
        const row = await service.linkChild(parentId, req.body || {});

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PARENT_CHILD_LINKED,
            module: audit.MODULES.PEOPLE,
            entity: `parents#${parentId}`,
            after: {
                parentId,
                studentId: Number(req.body?.student_id),
                relationship: req.body?.relationship || "Guardian"
            },
            req
        });

        return res.status(201).json({
            success: true,
            message: "Child linked to this parent.",
            data: row
        });
    } catch (error) {
        return respondToError(res, error, "link the child");
    }
};

const unlinkChild = async (req, res) => {
    const parentId = idFrom(req, res);
    if (parentId === null) return undefined;

    const studentId = idFrom(req, res, "studentId");
    if (studentId === null) return undefined;

    try {
        const row = await service.unlinkChild(parentId, studentId);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.PARENT_CHILD_UNLINKED,
            module: audit.MODULES.PEOPLE,
            entity: `parents#${parentId}`,
            before: { parentId, studentId },
            req
        });

        return res.status(200).json({
            success: true,
            message: "Child unlinked from this parent.",
            data: row
        });
    } catch (error) {
        return respondToError(res, error, "unlink the child");
    }
};

module.exports = {
    listAdmins,
    createAdmin,
    updateAdmin,
    deleteAdmin,
    createParent,
    updateParent,
    deleteParent,
    linkChild,
    unlinkChild
};
