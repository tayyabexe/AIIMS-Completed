const { Op } = require("sequelize");
const Notification = require("../models/notification.model");
const userPreferenceService = require("../services/userPreferenceService");

// Notifications are always scoped to the signed-in user. There is no
// cross-user read here: the row's user_id must match the token, so one account
// can never read or acknowledge another account's notifications.

// ================= LIST OWN NOTIFICATIONS =================

const getMyNotifications = async (req, res) => {

    try {

        const { is_read, type, limit } = req.query;

        const where = { user_id: req.user.user_id };

        if (is_read === "true") where.is_read = true;
        if (is_read === "false") where.is_read = false;
        if (type) where.type = type;

        // Categories the user switched off in Settings. Applied to the unread
        // count as well as the list: a muted row is never shown, so counting it
        // would leave a badge the user has no way to clear.
        const preferences = await userPreferenceService.getPreferences(req.user.user_id);
        const mutedTypes = preferences.notifications.mutedTypes;

        if (mutedTypes.length) {
            where.type = where.type
                ? { [Op.and]: [where.type, { [Op.notIn]: mutedTypes }] }
                : { [Op.notIn]: mutedTypes };
        }

        const unreadWhere = {
            user_id: req.user.user_id,
            is_read: false
        };

        if (mutedTypes.length) unreadWhere.type = { [Op.notIn]: mutedTypes };

        /*
         * Issued together rather than one after another.
         *
         * None of these three depends on the result of another, but they were
         * awaited in sequence, so the response cost four serial round trips
         * (the preferences read above is the fourth). Against a remote database
         * that is the whole latency of the endpoint: the notifications page was
         * taking ~550ms to return a single row, on a table where no account has
         * more than a handful. Four hops at ~140ms each accounts for all of it.
         *
         * The preferences read has to stay ahead of them because `mutedTypes`
         * is part of two of these WHERE clauses.
         */
        const [notifications, unreadCount, availableTypes] = await Promise.all([
            Notification.findAll({
                where,
                order: [["created_at", "DESC"]],
                limit: limit ? Number(limit) : 50
            }),

            Notification.count({ where: unreadWhere }),

            // The Settings screen builds its category list from what this user
            // actually receives, so it can never offer a filter that matches
            // nothing. Muted categories are included - they have to stay
            // switchable back on.
            Notification.findAll({
                where: { user_id: req.user.user_id },
                attributes: ["type"],
                group: ["type"],
                order: [["type", "ASC"]],
                raw: true
            })
        ]);

        return res.status(200).json({
            success: true,
            unreadCount,
            mutedTypes,
            availableTypes: availableTypes.map((row) => row.type),
            data: notifications
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load notifications"
        });

    }

};

// ================= MARK ONE AS READ =================

const markNotificationRead = async (req, res) => {

    try {

        const { id } = req.params;

        const notification = await Notification.findOne({
            where: {
                notification_id: id,
                user_id: req.user.user_id
            }
        });

        if (!notification) {

            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });

        }

        // Already-read is not an error: clicking a read notification again
        // should still succeed so the UI can stay simple.
        if (!notification.is_read) {
            await notification.update({ is_read: true });
        }

        return res.status(200).json({
            success: true,
            data: notification
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to update notification"
        });

    }

};

// ================= MARK ALL AS READ =================

const markAllNotificationsRead = async (req, res) => {

    try {

        const [updated] = await Notification.update(
            { is_read: true },
            {
                where: {
                    user_id: req.user.user_id,
                    is_read: false
                }
            }
        );

        return res.status(200).json({
            success: true,
            updated,
            message: `${updated} notification(s) marked as read`
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to update notifications"
        });

    }

};

module.exports = {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead
};
