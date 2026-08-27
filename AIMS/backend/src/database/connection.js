const { Sequelize } = require("sequelize");

const CONNECT_RETRIES = Number(process.env.DB_CONNECT_RETRIES || 5);
const CONNECT_RETRY_DELAY = Number(process.env.DB_CONNECT_RETRY_DELAY || 3000);

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        dialect: "mysql",
        logging: process.env.DB_LOGGING === "true" ? console.log : false,

        dialectOptions: {
            // Aiven is a remote host; the mysql2 default of 10s is too tight
            // and makes a slow handshake look like a hard failure.
            connectTimeout: 30000,

            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        },

        /*
         * The database is remote (Aiven), and that changes what a pool is for.
         *
         * Measured from this machine: opening a connection costs 1.1-2.2s,
         * almost all of it TLS handshake, while a query once connected is
         * ~200ms. With `min: 0` and a 10s idle timeout, any quiet moment threw
         * every connection away, so the next request paid the full handshake
         * before its first query — and a request making several round trips
         * paid it while holding the pool.
         *
         * `min: 2` keeps a warm pair, and a longer idle stops them being
         * discarded between bursts. `acquire` is lowered from 60s because a
         * minute of silent waiting is not a better outcome than a clear error:
         * if no connection is available in 20s the database is genuinely in
         * trouble and the caller should be told.
         */
        pool: {
            max: 10,
            min: 2,
            acquire: 20000,
            idle: 30000,

            // Reap connections the server may have closed on its side, so a
            // stale socket is discovered by the pool rather than by a query.
            evict: 15000
        },

        // Retry transient network errors on individual queries too.
        retry: {
            max: 3,
            match: [
                /ETIMEDOUT/,
                /ECONNRESET/,
                /ECONNREFUSED/,
                /PROTOCOL_CONNECTION_LOST/
            ]
        }
    }
);

/*
 * Second line of defence: edge-trim string columns on the way into the table.
 *
 * The request sanitiser in middlewares/sanitize.middleware.js catches anything
 * that arrives over HTTP, which is the overwhelming majority. This catches the
 * rest — seeders, the scripts under src/scripts, and any future job that
 * builds a model instance directly and never touches a route.
 *
 * Registered on the sequelize instance rather than per model, so it applies to
 * every model already defined and every one added later.
 *
 * It does NOT reach the raw `sequelize.query()` INSERTs that provisioning and
 * the admin services use — those bypass the model layer entirely. They are
 * covered by the middleware, which is why both layers exist.
 */
const TRIMMABLE_TYPES = new Set(["STRING", "TEXT", "CHAR"]);

// A bcrypt hash has no edge whitespace to remove, but it is the one column
// where a rewrite would be catastrophic rather than merely wrong. Left alone
// on principle, matching the middleware's exemption list.
const PRESERVED_COLUMNS = new Set(["password_hash", "password", "token"]);

const trimStringAttributes = (instance) => {
    const attributes = instance.constructor?.rawAttributes;
    if (!attributes) return;

    for (const [name, definition] of Object.entries(attributes)) {
        if (PRESERVED_COLUMNS.has(name)) continue;

        const typeKey = definition?.type?.key;
        if (!TRIMMABLE_TYPES.has(typeKey)) continue;

        const value = instance.getDataValue(name);
        if (typeof value !== "string") continue;

        const trimmed = value.trim();
        // Only write when it actually differs. Assigning unconditionally would
        // mark the attribute dirty and make every UPDATE rewrite columns that
        // never changed, which turns a one-column edit into a full-row write.
        if (trimmed !== value) instance.setDataValue(name, trimmed);
    }
};

sequelize.addHook("beforeValidate", trimStringAttributes);

/*
 * bulkCreate does not run per-instance hooks unless asked to, so the same pass
 * is applied to each record of a bulk insert explicitly.
 */
sequelize.addHook("beforeBulkCreate", (instances) => {
    for (const instance of instances) trimStringAttributes(instance);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async () => {

    for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {

        try {

            await sequelize.authenticate();

            console.log("✅ Database Connected Successfully");

            return;

        } catch (error) {

            const isLast = attempt === CONNECT_RETRIES;

            console.error(
                `❌ Database connection attempt ${attempt}/${CONNECT_RETRIES} failed: ${error.parent?.code || error.message}`
            );

            if (isLast) {

                console.error(
                    "\nCould not reach the database. Things to check:\n" +
                    `  • host/port  : ${process.env.DB_HOST}:${process.env.DB_PORT}\n` +
                    "  • the Aiven service is running (not paused/expired)\n" +
                    "  • your current IP is allowed in the Aiven access control list\n" +
                    "  • DB_USER / DB_PASSWORD / DB_NAME in backend/.env are correct\n"
                );

                process.exit(1);

            }

            await wait(CONNECT_RETRY_DELAY);

        }

    }

};

module.exports = {
    sequelize,
    connectDB
};
