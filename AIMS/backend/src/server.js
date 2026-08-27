require("dotenv").config();

const app = require("./app");
const { connectDB } = require("./database/connection");

const PORT = process.env.PORT || 5000;

/*
 * Load the embedding model before anyone asks a question.
 *
 * The ONNX pipeline is loaded lazily on first use, which measured at 6.7s for
 * the first chatbot request against a 1.6s median for every one after it. The
 * work is identical either way; the only question is whether a user waits for
 * it. Doing it here moves those five seconds into the boot, where nobody is
 * watching.
 *
 * AFTER listen(), not before: a slow model load must never delay the port
 * opening or hold up the health check. And non-fatal - a backend whose
 * documentation search cannot start is still a working backend for every
 * other route, and the embedder retries on first real use anyway.
 *
 * embedder.warmup() already existed for exactly this and already swallows
 * its own failures. It had simply never been called from anywhere.
 */
const warmEmbedder = () => {

    let embedder;

    try {
        embedder = require("./services/assistant/rag/embedder");
    } catch {
        return;
    }

    if (typeof embedder?.warmup !== "function") return;

    const started = Date.now();

    embedder.warmup()
        .then((result) => console.log(result?.ok
            ? `   embedder ready in ${Date.now() - started}ms`
            : `   embedder warmup skipped: ${result?.reason}`))
        .catch((error) =>
            console.warn(`   embedder warmup skipped: ${error.message}`));
};

/*
 * Say at boot whether the assistant's read-only account can actually read.
 *
 * readonlyConnection.verifyReadonly() was written for exactly this and
 * documents itself as running "at boot" — it had simply never been called from
 * anywhere, the same way embedder.warmup() had not.
 *
 * The gap it leaves is not theoretical. MySQL grants are per database, and
 * `aims_ai_ro` is granted table by table against one named schema, so pointing
 * DB_NAME at another database (a test copy, a fresh restore) leaves the
 * account able to connect and unable to read anything. The first thing that
 * reports it is a 500 on somebody's dashboard, because the assistant's scope
 * resolver sits behind the saved-analytics layout endpoints. A line at
 * startup naming the database and the script that fixes it turns a support
 * question into a thing you read while the server is still starting.
 *
 * Non-fatal and after listen(), for the same reason as the embedder: a backend
 * whose assistant cannot start is still a working backend for every other
 * route, and refusing to serve the portals over it would be the larger fault.
 */
const checkReadonlyAccount = () => {

    let readonly;

    try {
        readonly = require("./database/readonlyConnection");
    } catch {
        return;
    }

    if (typeof readonly?.verifyReadonly !== "function") return;

    readonly.verifyReadonly()
        .then((result) => {
            if (result?.ok) {
                console.log(
                    `   assistant read-only account OK on ${process.env.DB_NAME}`
                );
                return;
            }

            console.warn(
                `   assistant read-only account UNUSABLE on ${process.env.DB_NAME}: `
                + `${result?.reason}\n`
                // Layouts survive this now (see savedAnalyticsController's
                // requireSurface), so the warning says what actually stops
                // rather than overstating it and being disbelieved.
                + "   The assistant and every saved analytics card will refuse "
                + "to run until this is fixed.\n"
                + "   Grant it with: cd AIMS/database && node "
                + "scripts/create_ai_readonly_user.js --keep-other-databases"
            );
        })
        .catch((error) =>
            console.warn(`   assistant read-only account check skipped: ${error.message}`));
};

const startServer = async () => {

    await connectDB();

    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        warmEmbedder();
        checkReadonlyAccount();
    });

};

startServer();
