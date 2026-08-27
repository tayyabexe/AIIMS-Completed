"use strict";

/*
 * `users.full_name` — the account holder's name, stored on the account.
 *
 * WHY THIS COLUMN DID NOT EXIST, AND WHY THAT BROKE
 * -------------------------------------------------
 * A name in AIMS lived only on the ROLE record: `students.first_name` for a
 * student, `employees.first_name` for a teacher, `parents.first_name` for a
 * parent. That works right up until an account has no role record — which is
 * exactly the case for an administrator. An admin is a `users` row and nothing
 * else; there is no `admins` table and no `employees` link.
 *
 * So the frontend derived one from the email local part
 * (AuthContext.nameFromEmail) and `admin2@aims.edu.pk` greeted a human being
 * as "Admin2". The AI assistant then opened every conversation by repeating it
 * back.
 *
 * Deriving a person's name from their email address is not a display bug to be
 * patched at the point of display. It is a missing attribute, and every
 * consumer that needs a name — the dashboard banner, the assistant greeting, a
 * future notification salutation — otherwise reinvents the same wrong guess in
 * a place where nobody can correct it. The fix belongs where the fact belongs.
 *
 * WHY ON `users` AND NOT A NEW `admins` TABLE
 * -------------------------------------------
 * Because every role needs it, not just admins. One nullable column on `users`
 * gives a single place to read a name from for ANY account, whatever role it
 * holds, instead of a three-way LEFT JOIN at every call site. The role records
 * keep their own name columns — `students.first_name` remains authoritative
 * for a legal name on a transcript — and this is the denormalised display
 * copy, backfilled from them below.
 *
 * WHY NULLABLE
 * ------------
 * NOT NULL would need a value for all 4,047 existing accounts before the
 * column could be added, and the honest value for a service account is "no
 * name", not a fabricated one. Nullable lets a reader fall back deliberately
 * rather than trusting a placeholder that looks real.
 *
 * BACKFILL
 * --------
 * Three UPDATE...JOIN passes, one per role record, then a fourth in JavaScript
 * for the accounts none of them reach — the administrators this migration
 * exists for.
 *
 * That last pass title-cases the email local part, which is the SAME
 * derivation the frontend was doing. Deliberately: it is a starting value, not
 * an improvement. What changes is that it is now stored, editable and
 * correctable from Settings, instead of being recomputed from the email on
 * every render in a place no admin could ever reach.
 */

const TABLE = "users";

/*
 * `admin.two@aims.edu.pk` -> "Admin Two".
 *
 * Done in JavaScript rather than SQL because the MySQL expression needs
 * REGEXP_REPLACE nested inside SUBSTRING_INDEX inside CONCAT four times over,
 * and MySQL 8.0 has no INITCAP to do it honestly. The set being updated here
 * is the administrators — tens of rows, not thousands — so the round trip
 * costs nothing and the intent stays readable.
 *
 * Digits are stripped so `admin2` does not simply become "Admin2" again, which
 * is the exact output this migration exists to remove.
 */
const nameFromEmail = (email) => {

    const local = String(email || "").split("@")[0];

    const words = local
        .replace(/[._-]+/g, " ")
        .replace(/[0-9]+/g, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) return null;

    return words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
};

module.exports = {

    async up(queryInterface, Sequelize) {

        const columns = await queryInterface.describeTable(TABLE);

        if (!columns.full_name) {
            await queryInterface.addColumn(TABLE, "full_name", {
                type: Sequelize.STRING(150),
                allowNull: true,
                comment:
                    "Display name for the account holder. Backfilled from the "
                    + "role record (students/employees/parents) where one "
                    + "exists; set directly for accounts that have none, such "
                    + "as administrators."
            });
        }

        /*
         * NULLIF(TRIM(...), '') rather than a bare CONCAT_WS.
         *
         * CONCAT_WS skips a NULL last_name but still leaves a trailing space,
         * and a row with both names blank would be backfilled with the empty
         * string — which is worse than NULL, because it reads as "this account
         * has a name and it is nothing" and defeats every COALESCE fallback
         * downstream.
         */
        const nameExpr = (alias) =>
            `NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), '')`;

        const backfillFrom = async (table, alias, extraWhere) => {
            try {
                await queryInterface.sequelize.query(`
                    UPDATE users u
                      JOIN ${table} ${alias} ON ${alias}.user_id = u.user_id
                       SET u.full_name = ${nameExpr(alias)}
                     WHERE u.full_name IS NULL
                       AND ${nameExpr(alias)} IS NOT NULL
                       ${extraWhere ? `AND ${extraWhere}` : ""}
                `);
            } catch (error) {
                /*
                 * A slimmer deployment may not carry every role table. A
                 * missing `parents` must not abort a migration whose main
                 * purpose — the admin name — succeeds without it.
                 */
                console.warn(`  ~ ${table} backfill skipped: ${error.message}`);
            }
        };

        await backfillFrom("students", "s", "s.is_deleted = 0");
        await backfillFrom("employees", "e", "e.is_deleted = 0");
        await backfillFrom("parents", "p", null);

        // Everything still NULL, which is the administrators.
        const orphans = await queryInterface.sequelize.query(
            `SELECT user_id, email
               FROM users
              WHERE full_name IS NULL
                AND is_deleted = 0`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        for (const row of orphans) {

            const derived = nameFromEmail(row.email);
            if (!derived) continue;

            await queryInterface.sequelize.query(
                `UPDATE users SET full_name = :name WHERE user_id = :id`,
                { replacements: { name: derived, id: row.user_id } }
            );
        }

        console.log(
            `  + users.full_name: ${orphans.length} account(s) named from email`
        );

    },

    async down(queryInterface) {

        const columns = await queryInterface.describeTable(TABLE);

        if (columns.full_name) {
            await queryInterface.removeColumn(TABLE, "full_name");
        }

    }

};
