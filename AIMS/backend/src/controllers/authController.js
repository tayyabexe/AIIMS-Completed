const { validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const audit = require("../services/auditService");
/*
 * Credential events are the one category every role receives — a librarian and
 * a super admin both have a password. They are also the notification with a
 * security purpose rather than a convenience one: "your password was changed"
 * arriving when the holder did not change it is how an account takeover gets
 * noticed. That is why these are emitted to the account holder even though the
 * account holder is the actor, which every other emitter in this codebase
 * deliberately avoids.
 */
const notify = require("../services/notificationService");

/*
 * The shared sign-in policy: one failure message for every portal, the
 * remaining-tries countdown, the lock after five, and the counter reset on a
 * clean sign-in. Both this controller and parentController go through it, so
 * neither portal can drift into answering a failure differently from the other.
 */
const loginSecurity = require("../services/loginSecurity");
const { portalForRole } = require("../config/roles");

// ================= REGISTER =================

const register = async (req, res) => {

    try {

        const errors = validationResult(req);

        if (!errors.isEmpty()) {

            return res.status(400).json({
                success: false,
                errors: errors.array()
            });

        }

        const {
            email,
            password,
            role_id,
            phone,
            full_name
        } = req.body;

        // Check if email already exists
        const existingUser = await User.findOne({
            where: {
                email,
                is_deleted: false
            }
        });

        if (existingUser) {

            return res.status(409).json({
                success: false,
                message: "Email already exists."
            });

        }

        // Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create User
        const user = await User.create({

            email,
            password_hash: hashedPassword,
            role_id,
            phone,

            /*
             * Stored as given, or NULL. Not derived from the email — that
             * guess is what produced "Admin2", and a NULL here is honest
             * enough for the frontend to fall back on deliberately.
             */
            full_name: (full_name || "").trim() || null,

            is_active: true,
            // See provisioningService.createLogin: no verification flow exists,
            // so a 0 here was a permanent, meaningless warning badge.
            email_verified: true,
            failed_login_attempts: 0,
            is_deleted: false

        });

        /*
         * Attributed to the account it just created, because this route is
         * unauthenticated — there is no other actor to name. That is a true
         * statement about a self-registration and it keeps the row insertable
         * against the NOT NULL user_id.
         */
        await audit.record({
            userId: user.user_id,
            action: audit.ACTIONS.USER_REGISTERED,
            module: audit.MODULES.AUTH,
            entity: `users#${user.user_id}`,
            after: {
                targetUserId: user.user_id,
                email: user.email,
                roleId: user.role_id
            },
            req
        });

        return res.status(201).json({

            success: true,
            message: "User Registered Successfully",

            user: {

                user_id: user.user_id,
                email: user.email,
                role_id: user.role_id,
                full_name: user.full_name || null

            }

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= LOGIN =================

const login = async (req, res) => {

    try {

        const errors = validationResult(req);

        if (!errors.isEmpty()) {

            return res.status(400).json({

                success: false,
                errors: errors.array()

            });

        }

        /*
         * `portal` is which sign-in screen this attempt came from. Optional,
         * so an API client that does not send it still works exactly as
         * before; when it IS sent, an account belonging to a different portal
         * is refused HERE, and no token is minted.
         *
         * It used to be refused in the browser instead: this endpoint returned
         * 200 with a real token, AuthContext compared the role to the chosen
         * portal and discarded it. The user saw a rejection, but the response
         * on the wire had already confirmed that the password was right - the
         * one thing a sign-in failure must never confirm.
         */
        const { email, password, portal } = req.body;

        const user = await User.findOne({

            where: {

                email,
                is_deleted: false

            }

        });

        /*
         * EVERY FAILURE BELOW ANSWERS THE SAME WAY.
         *
         * Unknown address, wrong password, deactivated login, right password
         * on the wrong portal - one message, one status, one response time.
         * The countdown that appears after two failures is counted for an
         * address that does not exist as well (see loginSecurity), so even
         * that does not give away whether the account is real.
         *
         * The one deliberate exception is a locked account, which says so:
         * a person who cannot get in has to be told why, and by then five
         * attempts have already been made against the address anyway.
         */
        if (!user) {

            await loginSecurity.equaliseTiming();

            const failure = await loginSecurity.recordFailure({
                user: null,
                email,
                req
            });

            return res.status(failure.status).json({
                success: false,
                message: failure.message
            });

        }

        if (loginSecurity.isLocked(user)) {

            const locked = loginSecurity.lockedResponse();

            return res.status(locked.status).json({
                success: false,
                message: locked.message
            });

        }

        /*
         * A deactivated login is no longer told that it is deactivated. That
         * message confirmed the address had an account here, and the person it
         * concerns has to contact the office either way - which is what the
         * generic message tells them to do.
         */
        const isMatch = user.is_active && await bcrypt.compare(
            password,
            user.password_hash
        );

        // The portal check sits with the password check, and a mismatch counts
        // as a failed attempt like any other, because a wrong-portal attempt
        // that did NOT count would be distinguishable from a wrong password by
        // the countdown alone.
        const portalMatches = !portal
            || portalForRole(user.role_id) === portal;

        if (!isMatch || !portalMatches) {

            // bcrypt is short-circuited for a deactivated login, so spend the
            // same time by hand. Without this a disabled account answers
            // measurably faster than a wrong password.
            if (!user.is_active) await loginSecurity.equaliseTiming();

            const failure = await loginSecurity.recordFailure({
                user,
                email,
                req
            });

            return res.status(failure.status).json({
                success: false,
                message: failure.message
            });

        }

        // Clears the counter, any lock, and stamps last_login.
        await loginSecurity.recordSuccess(user);

        const accessToken = jwt.sign(

            {
                user_id: user.user_id,
                role_id: user.role_id
            },

            process.env.JWT_ACCESS_SECRET,

            {
                expiresIn: process.env.ACCESS_TOKEN_EXPIRES
            }

        );

        return res.status(200).json({

            success: true,
            message: "Login Successful",
            token: accessToken,

            user: {

                user_id: user.user_id,
                email: user.email,
                role_id: user.role_id,

                /*
                 * The name to greet this person by.
                 *
                 * Sent at login rather than fetched later because every portal
                 * needs it on the first paint — the dashboard banner, the
                 * profile menu, the AI assistant's opening line — and a
                 * separate round trip for one string would leave all three
                 * rendering a placeholder first and flicking to the real name
                 * a moment later.
                 *
                 * May be null. The frontend falls back deliberately; it must
                 * not invent one from the email, which is the behaviour
                 * this column was added to retire.
                 */
                full_name: user.full_name || null,

                /*
                 * True when this account is still using a password an
                 * administrator generated and read off a screen.
                 *
                 * The sign-in itself succeeds — blocking it would leave the
                 * user no way to set a new password — but the portal reads this
                 * to send them straight to the change-password screen. Once
                 * they choose their own, changePassword clears the flag and
                 * this stays false.
                 */
                must_change_password: !!user.must_change_password

            }

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= LOGOUT =================

const logout = async (req, res) => {

    return res.status(200).json({

        success: true,
        message: "Logout Successful"

    });

};
// ================= CHANGE PASSWORD =================

const changePassword = async (req, res) => {

    try {

        const { currentPassword, newPassword } = req.body;

        const user = await User.findByPk(req.user.user_id);

        if (!user) {

            return res.status(404).json({

                success: false,
                message: "User not found."

            });

        }

        const isMatch = await bcrypt.compare(

            currentPassword,

            user.password_hash

        );

        if (!isMatch) {

            return res.status(400).json({

                success: false,
                message: "Current password is incorrect."

            });

        }

        const hashedPassword = await bcrypt.hash(

            newPassword,

            10

        );

        // Read before it is cleared below — the audit entry distinguishes a
        // forced first change from a routine one, and after the assignment
        // there is no way to tell them apart.
        const wasForcedChange = !!user.must_change_password;

        user.password_hash = hashedPassword;
        user.last_password_change = new Date();

        /*
         * The user has now chosen a password of their own, so the account is no
         * longer holding one an administrator saw. Clearing this here is what
         * stops the "you must change your password" prompt from reappearing at
         * every sign-in forever.
         */
        user.must_change_password = false;

        await user.save();

        /*
         * Recorded for every role, not just administrators. A password change
         * is the event that separates "the account holder has been using this
         * account" from "somebody else has been", and it is the row an admin
         * looks for first when an account is disputed. The password itself is
         * never in this entry — see the scrubber in auditService.
         */
        await audit.record({
            userId: user.user_id,
            action: audit.ACTIONS.PASSWORD_CHANGED,
            module: audit.MODULES.AUTH,
            entity: `users#${user.user_id}`,
            after: {
                targetUserId: user.user_id,
                email: user.email,
                // The distinction worth keeping: a change that clears an
                // admin-issued password is the end of a provisioning handover,
                // an ordinary one is routine hygiene.
                clearedForcedChange: wasForcedChange,
                changedAt: user.last_password_change
            },
            req
        });

        /*
         * Note the absent `actorUserId`. Everywhere else in this codebase the
         * actor is excluded from their own notification, because being told
         * what you just did is noise. Here it is the entire point: the copy in
         * the account holder's own feed is what makes an unauthorised change
         * visible to them.
         */
        await notify.emit({
            audience: await notify.userAudience(user.user_id),
            type: notify.TYPES.ACCOUNT,
            priority: notify.PRIORITY.HIGH,
            /*
             * NO LINK, and that is the fix.
             *
             * `subject: "account"` used to be here, and notificationService
             * resolves that subject to /change-password for every role. So the
             * row that says "your password was changed" pointed at the form for
             * changing it — a finished action linking to the screen that
             * performed it. On the notification centre that read as a standing
             * invitation: open it, change the password, and the new notice
             * offered the same form again, for ever.
             *
             * There is nothing to open here. The change is done. If it was not
             * the account holder who made it, the answer is to contact the
             * administration office, which the message says — not to walk into
             * the same form.
             *
             * The one "account" notification that KEEPS its link is the one
             * that opens a request rather than closing it: "New password
             * issued", emitted by adminPortalController when an admin generates
             * a credential. That is the request /change-password answers, and
             * ForcedPasswordChangeRoute keeps the screen open only until it is
             * answered.
             */
            link: null,
            title: "Password changed",
            message: wasForcedChange
                ? "Your password has been set and your account is now fully active."
                : "Your password was changed. If this was not you, contact the "
                    + "administration immediately."
        });

        return res.status(200).json({

            success: true,
            message: "Password changed successfully."

        });

    }

    catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= FORGOT PASSWORD =================
//
// SECURITY NOTE - why this no longer returns a token.
//
// This handler used to mint a 15-minute password-reset JWT and return it, plus
// a ready-made reset link, in the HTTP response body. The route is
// unauthenticated. That meant anybody who knew (or guessed) a registered email
// address could POST it here, read the token straight out of the reply and use
// it against /api/auth/reset-password to take over that account. With 4,013
// user rows and predictable institutional addresses, that is a full account
// takeover for any account in the system.
//
// A reset token is only safe if it is delivered over a channel the requester
// has already proven they control - normally an email. AIMS has no mail
// transport configured, so there is no such channel, and the token is
// deliberately not issued here.
//
// Until mail delivery exists, resets are done by the admin office, who verify
// identity in person and then set a new password through
// PUT /api/users/:id. The portals' "Forgot password" screen says exactly that.
//
// The response is also intentionally identical whether or not the address is
// registered: the old 404 turned this endpoint into a way to enumerate which
// email addresses have accounts.
const forgotPassword = async (req, res) => {

    return res.status(200).json({

        success: true,

        message: "Password resets are handled by the admin office. "
            + "Please contact them to have your password reset. "
            + "If you can still sign in, change your password from your profile instead.",

        // Lets a client tell this apart from a reset that was actually sent,
        // without revealing anything about the address it was given.
        self_service: false

    });

};
// ================= RESET PASSWORD =================

const resetPassword = async (req, res) => {

    try {

        const { token, newPassword } = req.body;

        const decoded = jwt.verify(

            token,

            process.env.JWT_ACCESS_SECRET

        );

        if (decoded.purpose !== "password-reset") {

            return res.status(400).json({

                success: false,
                message: "Invalid reset token."

            });

        }

        const user = await User.findByPk(decoded.user_id);

        if (!user) {

            return res.status(404).json({

                success: false,
                message: "User not found."

            });

        }

        const hashedPassword = await bcrypt.hash(

            newPassword,

            10

        );

        user.password_hash = hashedPassword;
        user.last_password_change = new Date();

        await user.save();

        await audit.record({
            userId: user.user_id,
            action: audit.ACTIONS.PASSWORD_RESET,
            module: audit.MODULES.AUTH,
            entity: `users#${user.user_id}`,
            after: {
                targetUserId: user.user_id,
                email: user.email,
                // A reset arrives with a token rather than the old password, so
                // this row is the only evidence the account changed hands
                // without anyone signing in first.
                viaResetToken: true,
                changedAt: user.last_password_change
            },
            // Emitted below, after the entry is written.
            req
        });

        // A reset needs no old password, so this notice is the only thing that
        // tells the real holder their account changed hands.
        await notify.emit({
            audience: await notify.userAudience(user.user_id),
            type: notify.TYPES.ACCOUNT,
            priority: notify.PRIORITY.HIGH,
            // Same reasoning as the change notification above: the reset has
            // already happened, so there is no form to send anyone to.
            link: null,
            title: "Password reset",
            message: "Your password was reset using a reset link. If this was not "
                + "you, contact the administration immediately."
        });

        return res.status(200).json({

            success: true,
            message: "Password reset successfully."

        });

    } catch (error) {

        return res.status(400).json({

            success: false,
            message: "Invalid or expired reset token."

        });

    }

};
module.exports = {

    register,
    login,
    logout,
    changePassword,
    forgotPassword,
    resetPassword

};
