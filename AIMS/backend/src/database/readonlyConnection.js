/*
 * The database connection the AI assistant reads through.
 *
 * A second, separate pool on the `aims_ai_ro` account, which holds SELECT and
 * nothing else. Every query the assistant runs — the fixed tool queries and
 * the SQL an admin's question causes the model to generate — goes through
 * here, never through the application pool in ./connection.js.
 *
 * The point is that the read-only guarantee does not depend on any code in
 * this repository being correct. The SQL guard can be bypassed, the prompt can
 * be injected, the tool layer can have a bug; the server still refuses to
 * execute a write, because the account it is authenticated as cannot perform
 * one. See database/scripts/prove_readonly_account.js, which demonstrates that
 * by attempting each forbidden operation.
 *
 * If the read-only credentials are missing, this module exports null rather
 * than silently falling back to the write-capable pool. An assistant that
 * cannot answer is a much smaller problem than one answering through an
 * account that can DELETE.
 */

const { Sequelize } = require("sequelize");

const hasCredentials = Boolean(
    process.env.AI_DB_USER && process.env.AI_DB_PASSWORD
);

const readonlySequelize = hasCredentials
    ? new Sequelize(
        process.env.DB_NAME,
        process.env.AI_DB_USER,
        process.env.AI_DB_PASSWORD,
        {
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            dialect: "mysql",
            logging: process.env.DB_LOGGING === "true" ? console.log : false,

            dialectOptions: {
                connectTimeout: 30000,
                ssl: {
                    require: true,
                    rejectUnauthorized: false
                }
            },

            /*
             * Deliberately smaller than the application pool. Assistant traffic
             * is a handful of interactive questions, not page loads, and a
             * runaway generated query must not be able to starve the
             * connections the portals depend on.
             */
            pool: {
                max: 4,
                min: 0,
                acquire: 30000,
                idle: 10000
            },

            retry: {
                max: 2,
                match: [/ETIMEDOUT/, /ECONNRESET/, /PROTOCOL_CONNECTION_LOST/]
            }
        }
    )
    : null;

/*
 * Confirms at boot that the account exists, connects, and genuinely lacks
 * write privilege.
 *
 * The privilege check is not paranoia about the setup script: this pool and
 * that script can drift, someone can grant a privilege by hand while
 * debugging, and a restore from backup can recreate an account with different
 * grants. Checking here means the process refuses to serve the assistant
 * through an over-privileged account rather than discovering it later.
 */
const verifyReadonly = async () => {

    if (!readonlySequelize) {
        return {
            ok: false,
            reason: "AI_DB_USER / AI_DB_PASSWORD are not configured"
        };
    }

    try {

        await readonlySequelize.authenticate();

        const grants = await readonlySequelize.query("SHOW GRANTS", {
            type: readonlySequelize.QueryTypes.SELECT
        });

        // Column lists are stripped before the check: a grant naming
        // `created_at` and `updated_at` contains the substrings CREATE and
        // UPDATE, and matching the raw text flags every correct grant.
        const writeGrants = grants
            .map((row) => Object.values(row)[0])
            .filter((statement) => {

                const privileges = String(statement)
                    .replace(/\([^)]*\)/g, "")
                    .replace(/\s+ON\s+[\s\S]*$/i, "")
                    .replace(/^GRANT\s+/i, "");

                return /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ALL PRIVILEGES)\b/i
                    .test(privileges);
            });

        if (writeGrants.length) {
            return {
                ok: false,
                reason:
                    "the assistant's database account holds write privileges: " +
                    writeGrants.join(" | ")
            };
        }

        return { ok: true };

    } catch (error) {

        return { ok: false, reason: error.message };

    }
};

module.exports = { readonlySequelize, verifyReadonly };
