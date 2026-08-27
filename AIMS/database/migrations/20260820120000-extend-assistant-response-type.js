"use strict";

/*
 * `assistant_messages.response_type` gains 'capabilities' and 'scope'.
 *
 * WHY
 * ---
 * The chatbot now answers two kinds of question WITHOUT calling the model:
 *
 *   capabilities - "what can you help me with", answered from
 *                  backend/src/config/assistantCapabilities.js as structured
 *                  items the frontend renders with a fixed component.
 *   scope        - the controlled reply to a question outside what AIMS
 *                  covers, e.g. "what's the weather tomorrow".
 *
 * Both replies are structured rather than prose, and the frontend switches on
 * `response_type` to choose a component. Storing them as 'knowledge' would
 * work for the live turn — the payload is returned from memory — but not for
 * a REOPENED conversation, which is rebuilt from these rows. A capabilities
 * reply filed as 'knowledge' comes back as a bare intro sentence with the list
 * silently missing, which is the worst kind of persistence bug: it looks fine
 * in testing, because testing happens in the live turn.
 *
 * WHY NOT LEAVE IT AND MAP AT THE BOUNDARY
 * ----------------------------------------
 * A mapping layer means the column no longer says what the row is, and every
 * future reader has to know about the translation to interpret it. The ENUM is
 * a small closed vocabulary describing reply shapes; two new shapes belong in
 * it.
 *
 * SAFETY
 * ------
 * Widening an ENUM is additive — no existing row holds a value that stops
 * being valid, so nothing needs rewriting and no row is touched. The `down`
 * narrows it back, and deletes nothing: it first rewrites any row holding a
 * new value to 'knowledge', because MySQL would otherwise coerce it to the
 * empty string silently.
 */

const TABLE = "assistant_messages";

const BEFORE = "'answer','table','chart','knowledge','error'";
const AFTER = "'answer','table','chart','knowledge','error','capabilities','scope'";

const alterTo = (queryInterface, values) =>
    queryInterface.sequelize.query(
        `ALTER TABLE ${TABLE}
         MODIFY COLUMN response_type
         ENUM(${values}) COLLATE utf8mb4_unicode_ci DEFAULT NULL`
    );

module.exports = {

    async up(queryInterface) {

        const columns = await queryInterface.describeTable(TABLE);

        // Re-running is a no-op rather than a second ALTER of a large table.
        if (String(columns.response_type?.type || "").includes("capabilities")) {
            console.log("  ~ response_type already carries 'capabilities'");
            return;
        }

        await alterTo(queryInterface, AFTER);
        console.log("  + response_type: 'capabilities' and 'scope' added");
    },

    async down(queryInterface) {

        /*
         * Rows first, then the column. Narrowing an ENUM under a row that
         * holds a removed value replaces that value with '' — a row that is
         * neither the old thing nor the new one, and that no consumer can
         * render. Rewriting to 'knowledge' loses the distinction but keeps the
         * row readable, and the structured payload survives untouched in
         * response_payload.
         */
        await queryInterface.sequelize.query(
            `UPDATE ${TABLE}
                SET response_type = 'knowledge'
              WHERE response_type IN ('capabilities','scope')`
        );

        await alterTo(queryInterface, BEFORE);
    }

};
