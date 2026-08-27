const fs = require("fs");
const path = require("path");

const userService = require("../services/userService");
const mediaService = require("../services/mediaService");
const User = require("../models/user.model");
const userPreferenceService = require("../services/userPreferenceService");
const audit = require("../services/auditService");
// Owns the lockout policy; the unlock below is its only administrative door.
const loginSecurity = require("../services/loginSecurity");
const { ROLES } = require("../config/roles");
const { AVATAR_DIR } = require("../middlewares/upload.middleware");

// Create/update return a full model instance, which still carries the hash.
const withoutPasswordHash = (user) => {
    const plain = user.get ? user.get({ plain: true }) : { ...user };
    delete plain.password_hash;

    /*
     * Two derived avatar fields, so no client has to know where the bytes
     * actually live.
     *
     * Since media moved into the database, `profile_picture` is NULL for every
     * account whose picture was uploaded after that change — the bytes are in
     * profile_picture_data instead. Every screen in the portal decides whether
     * to render a photograph or the person's initials by testing
     * `profile_picture` for truthiness, so left alone this would have silently
     * turned every new upload into initials.
     *
     * `has_profile_picture` answers that question correctly for both storage
     * locations, and `profile_picture_url` is the one address that serves
     * either. The raw `profile_picture` column is left on the object
     * untouched, so anything still reading it keeps working for the rows that
     * still have a path.
     */
    plain.has_profile_picture = !!(plain.profile_picture_size || plain.profile_picture);

    plain.profile_picture_url = plain.has_profile_picture
        ? `/api/users/${plain.user_id}/avatar`
        : null;

    // Never serialise the blob, even if a caller selected it by mistake.
    delete plain.profile_picture_data;

    return plain;
};

// An Admin manages Teacher, Student, Parent and staff accounts, but must not
// see or modify a Super Admin. Only a Super Admin can act on a Super Admin.
const isSuperAdmin = (req) => req.user && req.user.role_id === ROLES.SUPER_ADMIN;

const forbidSuperAdmin = (res) => res.status(403).json({
    success: false,
    message: "Only a Super Admin can manage Super Admin accounts"
});

const getAllUsers = async (req, res) => {
    try {
        const result = await userService.getAllUsers(req.query);
        let users = result.users;

        // Hide Super Admin rows from everyone below that level.
        if (!isSuperAdmin(req)) {
            users = users.filter((u) => u.role_id !== ROLES.SUPER_ADMIN);
        }

        res.status(200).json({
            success: true,
            count: users.length,
            total: result.total,
            page: result.page,
            limit: result.limit,
            // The account-health headline and the per-role counts, both counted
            // over every live login rather than over this page.
            summary: result.summary,
            roleCounts: result.roleCounts,
            data: users
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch users"
        });
    }
};

const getUserById = async (req, res) => {
    try {
        const user = await userService.getUserById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.role_id === ROLES.SUPER_ADMIN && !isSuperAdmin(req)) {
            return forbidSuperAdmin(res);
        }

        res.status(200).json({
            success: true,
            data: user
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch user"
        });
    }
};

const createUser = async (req, res) => {
    try {
        if (Number(req.body.role_id) === ROLES.SUPER_ADMIN && !isSuperAdmin(req)) {
            return forbidSuperAdmin(res);
        }

        const user = await userService.createUser(req.body);

        /*
         * A login is the thing that grants access to everything else, so who
         * issued one — and for which role — is the entry the trail exists to
         * hold. The password in req.body never reaches the row: auditService
         * strips any credential-looking key, and only the fields below are
         * passed anyway.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.USER_CREATED,
            module: audit.MODULES.USERS,
            entity: `users#${user.user_id}`,
            after: {
                targetUserId: user.user_id,
                email: user.email,
                roleId: user.role_id,
                isActive: user.is_active
            },
            req
        });

        res.status(201).json({
            success: true,
            data: withoutPasswordHash(user)
        });

    } catch (error) {

    if (error.message === "Email already exists") {

        return res.status(409).json({
            success: false,
            message: error.message
        });

    }

    res.status(500).json({
        success: false,
        message: error.message
    });

}
};

const updateUser = async (req, res) => {
    try {
        const target = await userService.getUserById(req.params.id);

        if (target && target.role_id === ROLES.SUPER_ADMIN && !isSuperAdmin(req)) {
            return forbidSuperAdmin(res);
        }

        // Also blocks an Admin promoting any account to Super Admin.
        if (Number(req.body.role_id) === ROLES.SUPER_ADMIN && !isSuperAdmin(req)) {
            return forbidSuperAdmin(res);
        }

        const user = await userService.updateUser(
            req.params.id,
            req.body
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        /*
         * `target` was read before the write, so this entry can say what the
         * account looked like as well as what it looks like now — which is the
         * difference between "somebody edited this account" and "somebody
         * changed this account's ROLE", and only one of those is worth waking
         * up for.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.USER_UPDATED,
            module: audit.MODULES.USERS,
            entity: `users#${user.user_id}`,
            before: target ? {
                email: target.email,
                roleId: target.role_id,
                isActive: target.is_active,
                phone: target.phone
            } : null,
            after: {
                targetUserId: user.user_id,
                email: user.email,
                roleId: user.role_id,
                isActive: user.is_active,
                phone: user.phone
            },
            req
        });

        /*
         * PUT /api/users/:id accepts `password_hash` and re-hashes it, so this
         * route is a second way to set somebody else's password — and until now
         * the only one that left no trace. It is recorded as its own entry
         * rather than folded into the update above, because "an admin renamed
         * an account" and "an admin took control of an account" must not read
         * as the same line in the trail.
         */
        if (req.body.password_hash) {
            await audit.record({
                userId: req.user?.user_id,
                action: audit.ACTIONS.PASSWORD_RESET,
                module: audit.MODULES.AUTH,
                entity: `users#${user.user_id}`,
                after: {
                    targetUserId: user.user_id,
                    email: user.email,
                    setByAdministrator: true
                },
                req
            });
        }

        res.status(200).json({
            success: true,
            data: withoutPasswordHash(user)
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to update user"
        });
    }
};

// ================= OWN ACCOUNT =================
//
// Everything below resolves the account from the token, never from a path
// parameter, so one user can never read or modify another's. These are the
// endpoints the "Profile" screen in each portal needs; /api/users/:id stays
// Admin-only and is not usable by a student, teacher or parent.

// The signed-in user's account plus the person record it belongs to.
// getUserById already joins students/parents/employees for the name, so the
// portal gets email, phone, avatar and full name from one call.
const getMyProfile = async (req, res) => {
    try {
        const user = await userService.getUserById(req.user.user_id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            data: user
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to load profile"
        });
    }
};

// Contact details on the account itself. Deliberately narrow: role_id,
// is_active and is_deleted are administrative and stay on PUT /api/users/:id,
// so a user cannot promote themselves by editing their own profile.
const updateMyProfile = async (req, res) => {
    try {
        const updates = {};

        if (req.body.email !== undefined) updates.email = req.body.email;
        if (req.body.phone !== undefined) updates.phone = req.body.phone;

        /*
         * `full_name` is editable here, and this is the only route that can
         * set it for an administrator.
         *
         * A student's or teacher's name also lives on their role record, which
         * is administered elsewhere and stays authoritative for documents. An
         * admin has no role record at all, so without this the placeholder
         * that the backfill migration derived from their email address — the
         * "Admin2" this whole change exists to retire — would be permanent and
         * uncorrectable.
         *
         * Trimmed to NULL rather than stored as "", so a cleared field falls
         * back deliberately instead of rendering an empty greeting.
         */
        if (req.body.full_name !== undefined) {
            const name = String(req.body.full_name || "").trim();

            if (name && (name.length < 2 || name.length > 150)) {
                return res.status(400).json({
                    success: false,
                    message: "Full name must be between 2 and 150 characters."
                });
            }

            updates.full_name = name || null;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Nothing to update. Send full_name, email and/or phone."
            });
        }

        await userService.updateUser(req.user.user_id, updates);

        res.status(200).json({
            success: true,
            message: "Profile updated",
            data: await userService.getUserById(req.user.user_id)
        });

    } catch (error) {
        if (error.message === "Email already exists") {
            return res.status(409).json({
                success: false,
                message: error.message
            });
        }

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to update profile"
        });
    }
};

// ================= OWN PREFERENCES =================
//
// The Settings screen in each portal. Self-scoped like the routes above: the
// document is addressed by the token, never by a path parameter.

const getMyPreferences = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: await userPreferenceService.getPreferences(req.user.user_id)
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to load preferences"
        });
    }
};

// A partial document is accepted and merged, so a screen that owns one card
// can save that card without having to send back every other setting.
const updateMyPreferences = async (req, res) => {
    try {
        const saved = await userPreferenceService.savePreferences(
            req.user.user_id,
            req.body
        );

        res.status(200).json({
            success: true,
            message: "Preferences saved",
            data: saved
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to save preferences"
        });
    }
};

// Removes the file backing a stored avatar. Best-effort: a missing file is not
// an error, because the row is the source of truth and a stale path should
// still be clearable.
const removeAvatarFile = (storedPath) => {
    if (!storedPath) return;

    const filename = path.basename(storedPath);
    const fullPath = path.join(AVATAR_DIR, filename);

    fs.promises.unlink(fullPath).catch(() => {});
};

/*
 * multipart/form-data, field name "profile_picture".
 *
 * The bytes are now stored in the row (users.profile_picture_data) rather than
 * written to disk — see migrations/20260815090000-store-media-as-binary.js.
 * The route middleware has already verified that the upload really is an image
 * by its signature, not merely by its claimed Content-Type.
 *
 * The response returns a URL rather than the image, because that is what an
 * <img src> needs and because inlining 2MB of base64 into a JSON body would
 * make it uncacheable. The URL is /api/users/:id/avatar, served by getAvatar
 * below.
 */
const uploadMyProfilePicture = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image uploaded. Send the file as \"profile_picture\"."
            });
        }

        const current = await userService.getUserById(req.user.user_id);

        if (!current) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const media = mediaService.describeUpload(req.file);

        await userService.updateUser(req.user.user_id, {
            profile_picture_data: media.data,
            profile_picture_mime: media.mime,
            profile_picture_size: media.size,
            profile_picture_checksum: media.checksum,
            profile_picture_updated_at: new Date(),

            /*
             * The legacy path column is cleared, not left alone. Leaving a
             * stale path beside fresh bytes means two answers to "where is
             * this avatar", and the fallback in mediaService would resolve to
             * the OLD picture for any code path that reached it first.
             */
            profile_picture: null
        });

        // The file the old path pointed at is now unreferenced. Removing it is
        // what stops the uploads directory growing forever as accounts convert.
        removeAvatarFile(current.profile_picture);

        res.status(200).json({
            success: true,
            message: "Profile picture updated",

            /*
             * The checksum is in the URL as a cache-buster. Without it the
             * portal would ask for the same /avatar URL it already has cached
             * and keep showing the previous picture until the 5-minute
             * max-age expired — the classic "I uploaded a new photo and
             * nothing changed" report.
             */
            profile_picture: `/api/users/${req.user.user_id}/avatar?v=${media.checksum.slice(0, 12)}`,
            data: await userService.getUserById(req.user.user_id)
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to upload profile picture"
        });
    }
};

const deleteMyProfilePicture = async (req, res) => {
    try {
        const current = await userService.getUserById(req.user.user_id);

        if (!current) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Both storage locations are cleared. Clearing only one would leave
        // the other still resolvable, and the picture would come back.
        await userService.updateUser(req.user.user_id, {
            profile_picture: null,
            profile_picture_data: null,
            profile_picture_mime: null,
            profile_picture_size: null,
            profile_picture_checksum: null,
            profile_picture_updated_at: null
        });

        removeAvatarFile(current.profile_picture);

        res.status(200).json({
            success: true,
            message: "Profile picture removed"
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to remove profile picture"
        });
    }
};

/*
 * GET /api/users/:id/avatar — serves the picture itself.
 *
 * WHY THIS IS A ROUTE AND NOT A FIELD
 * -----------------------------------
 * The bytes live in the row now, and the obvious-looking alternative — return
 * a data: URI on the user object — is worse in every direction. It would put
 * ~2.7MB of base64 into every JSON response that mentions a user (a directory
 * page lists fifty), make those responses uncacheable, and re-transfer the
 * same portrait on every navigation. A URL is cacheable, is revalidated with
 * an ETag, and costs nothing on the responses that merely name the person.
 *
 * ACCESS
 * ------
 * Authenticated, but any signed-in user may read any avatar. That is
 * deliberate and matches what the portals already do: a faculty roster shows
 * student photographs, a student's class list shows their teacher's, and the
 * admin directory shows everyone's. Restricting it per-viewer would break
 * those screens while protecting something the same screens already display.
 *
 * Documents are NOT treated this way — see the student document route, which
 * is scoped to the student themselves and to staff.
 */
const getAvatar = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.id, 10);

        if (!Number.isInteger(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user id"
            });
        }

        /*
         * The `withAvatar` scope is the only read in the system that pulls the
         * blob, and it selects the media columns alone — no email, no role, no
         * password hash. See the defaultScope note on the model.
         */
        const user = await User.scope("withAvatar").findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const sent = mediaService.send(res, {
            data: user.profile_picture_data,
            mime: user.profile_picture_mime,
            checksum: user.profile_picture_checksum,
            updatedAt: user.profile_picture_updated_at,
            legacyPath: user.profile_picture
        });

        /*
         * 404 rather than a placeholder image. The portal already renders
         * initials when there is no picture, and returning a stand-in PNG here
         * would mean it could never tell the two cases apart.
         */
        if (!sent) {
            return res.status(404).json({
                success: false,
                message: "No profile picture on record"
            });
        }

        return undefined;

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load profile picture"
        });
    }
};

const deleteUser = async (req, res) => {
    try {
        const target = await userService.getUserById(req.params.id);

        if (target && target.role_id === ROLES.SUPER_ADMIN && !isSuperAdmin(req)) {
            return forbidSuperAdmin(res);
        }

        const user = await userService.deleteUser(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        /*
         * A soft delete here takes away the account's access to every portal.
         * The row itself only ends up with a flag set, so without this entry
         * there is nothing that says who locked the person out or when.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.USER_DELETED,
            module: audit.MODULES.USERS,
            entity: `users#${req.params.id}`,
            before: target ? {
                targetUserId: target.user_id,
                email: target.email,
                roleId: target.role_id,
                isActive: target.is_active
            } : null,
            after: { isDeleted: true },
            req
        });

        res.status(200).json({
            success: true,
            message: "User deleted successfully"
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to delete user"
        });
    }
};

/*
 * Lift a lockout. The only way an account locked by failed sign-ins gets back
 * in — that is the whole point of the lock, so there is no timer here and no
 * self-service route: an administrator has to do it deliberately.
 *
 * Separate from PUT /api/users/:id, which edits the record, because this is a
 * single security action with its own audit entry and its own notification to
 * the account holder. Folding it into the general update would have meant a
 * lock could be lifted as a side effect of correcting somebody's phone number.
 */
const unlockUser = async (req, res) => {
    try {
        const target = await userService.getUserById(req.params.id);

        if (!target) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Same rule as everywhere else in this controller: only a Super Admin
        // may act on a Super Admin row.
        if (target.role_id === ROLES.SUPER_ADMIN && !isSuperAdmin(req)) {
            return forbidSuperAdmin(res);
        }

        const user = await loginSecurity.unlockAccount(req.params.id, {
            actorUserId: req.user?.user_id,
            req
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Account unlocked",
            data: await userService.getUserById(req.params.id)
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to unlock the account"
        });
    }
};

module.exports = {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    unlockUser,
    getMyProfile,
    updateMyProfile,
    getMyPreferences,
    updateMyPreferences,
    uploadMyProfilePicture,
    deleteMyProfilePicture,
    getAvatar
};