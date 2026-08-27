"use strict";

/*
 * Three columns on `notifications`, and the index the feed actually reads by.
 *
 * WHY
 * ---
 * The table held `message` and `type` and nothing else, which forced two
 * compromises the frontend was carrying:
 *
 *   title    — there wasn't one. Every portal synthesised a heading from the
 *              `type` enum through a hardcoded map (TITLE_BY_TYPE in
 *              api/notificationsData.js), so a category the map didn't cover
 *              rendered its raw enum value as the heading, and two portals
 *              could disagree about what the same row was called. A title is a
 *              property of the event, not of the reader's screen.
 *
 *   link     — there wasn't one either, which made every notification a dead
 *              end. "Your fee challan has been generated" that cannot open the
 *              challan is a worse version of the fee page. Each emitted row now
 *              carries the in-portal route that answers it.
 *
 *   priority — the pages already style three tones (success / warning / info)
 *              and were inferring them from `type` through a second hardcoded
 *              map. The emitter knows whether attendance fell below the
 *              threshold or a result was merely published; the reader's browser
 *              does not.
 *
 * THE INDEX
 * ---------
 * `idx_notifications_unread` is (user_id, is_read), and the feed's query is
 * `WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`. That index gets the
 * right rows and then MySQL filesorts them. It does not matter at today's
 * volume — no account has more than a handful of rows — but the whole point of
 * this change is that rows start being written on every fee, result, attendance
 * and account event, so it is about to.
 *
 * BACKFILL
 * --------
 * `title` is filled for existing rows from their `type`, using the same wording
 * the frontend map was producing. This is NOT generating notifications for past
 * events — no row is created — it is populating a new column on rows that
 * already exist so they do not render with a blank heading.
 *
 * `link` is deliberately left NULL on old rows. A 2024 row saying a challan was
 * generated points at a challan that may since have been paid, cancelled or
 * superseded, and sending someone to a stale record is worse than not offering
 * the jump at all. The pages render a row with no link as plain text.
 */

const TABLE = "notifications";

// Mirrors the wording the frontend was generating client-side, so a row that
// existed before this migration reads exactly as it did yesterday.
const TITLE_BY_TYPE = {
    Fee: "Fee notice",
    Attendance: "Attendance update",
    Result: "Result published",
    Scholarship: "Scholarship update",
    Library: "Library notice",
    Registration: "Registration",
    Document: "Document update",
    Leave: "Leave request",
    Payroll: "Payroll",
    HR: "HR notice",
    Meeting: "Meeting",
    Academic: "Academic notice"
};

module.exports = {

    async up(queryInterface, Sequelize) {

        const columns = await queryInterface.describeTable(TABLE);

        if (!columns.title) {
            await queryInterface.addColumn(TABLE, "title", {
                type: Sequelize.STRING(120),
                allowNull: false,
                // A default is required to add a NOT NULL column to a populated
                // table; the backfill below replaces it with real wording.
                defaultValue: "Notification",
                comment: "Heading for the row, composed by whichever service emitted it"
            });
        }

        if (!columns.link) {
            await queryInterface.addColumn(TABLE, "link", {
                type: Sequelize.STRING(255),
                allowNull: true,
                comment: "In-portal route this notification is about; NULL when there is nothing to open"
            });
        }

        if (!columns.priority) {
            await queryInterface.addColumn(TABLE, "priority", {
                type: Sequelize.STRING(16),
                allowNull: false,
                defaultValue: "normal",
                comment: "low | normal | high — drives the tone the portals render"
            });
        }

        const indexes = await queryInterface.showIndex(TABLE);

        if (!indexes.some((i) => i.name === "idx_notifications_feed")) {
            await queryInterface.addIndex(TABLE, ["user_id", "created_at"], {
                name: "idx_notifications_feed"
            });
        }

        // Only rows still holding the column default are touched, so re-running
        // this cannot overwrite a title a real emitter wrote.
        for (const [type, title] of Object.entries(TITLE_BY_TYPE)) {
            await queryInterface.sequelize.query(
                `UPDATE ${TABLE}
                    SET title = :title
                  WHERE type = :type
                    AND (title = 'Notification' OR title = '')`,
                { replacements: { title, type } }
            );
        }

    },

    async down(queryInterface) {

        const indexes = await queryInterface.showIndex(TABLE);

        if (indexes.some((i) => i.name === "idx_notifications_feed")) {
            await queryInterface.removeIndex(TABLE, "idx_notifications_feed");
        }

        const columns = await queryInterface.describeTable(TABLE);

        if (columns.priority) await queryInterface.removeColumn(TABLE, "priority");
        if (columns.link) await queryInterface.removeColumn(TABLE, "link");
        if (columns.title) await queryInterface.removeColumn(TABLE, "title");

    }

};
