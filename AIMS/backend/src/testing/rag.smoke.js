/*
 * Verifies everything in the RAG pipeline that does not need Qdrant running.
 *
 * Qdrant is a local Docker container and will often be down — on a fresh
 * clone, on a machine without Docker, after a reboot. That must degrade to
 * "documentation search is unavailable" and nothing worse, so the graceful
 * path is tested here rather than assumed.
 *
 * What IS tested without Qdrant: the corpus parses, every document declares a
 * valid audience, chunking produces sensible units, the local embedding model
 * loads and produces normalised 384-dim vectors, and semantically related text
 * actually scores higher than unrelated text.
 *
 * Usage: node src/testing/rag.smoke.js
 */

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");

const DOCS = path.join(__dirname, "..", "..", "docs", "knowledge-base");

let failed = 0;

const assert = (label, ok, detail = "") => {
    console.log(`${ok ? "ok    " : "FAIL  "}${label}${detail ? `  -- ${detail}` : ""}`);
    if (!ok) failed += 1;
};

const cosine = (a, b) =>
    a.reduce((sum, x, i) => sum + x * b[i], 0);

(async () => {

    // --- corpus ------------------------------------------------------------
    const files = fs.readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();

    assert(`corpus has documents (${files.length})`, files.length >= 10);

    const VALID = new Set(["all", "student", "teacher", "staff"]);
    let totalChars = 0;

    for (const file of files) {

        const raw = fs.readFileSync(path.join(DOCS, file), "utf8");
        totalChars += raw.length;

        const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);

        if (!front) {
            assert(`${file} has front matter`, false);
            continue;
        }

        const audience = (front[1].match(/audience:\s*(\S+)/) || [])[1];
        const title = (front[1].match(/title:\s*(.+)/) || [])[1];

        /*
         * A missing or misspelled audience silently defaults to `staff` at
         * ingest, which fails closed but also means a document meant for
         * students quietly never reaches them. Catching it here is the
         * difference between a typo and a document nobody can find.
         */
        assert(`${file} declares a valid audience`,
            VALID.has(audience), audience || "missing");

        assert(`${file} declares a title`, Boolean(title && title.trim()));

        // Headings are what the chunker splits on. A document with none
        // becomes one enormous chunk that matches everything weakly.
        assert(`${file} has section headings`,
            /^##\s+/m.test(raw));
    }

    console.log(`\ncorpus: ${files.length} documents, ${Math.round(totalChars / 1024)} KB\n`);

    // --- audience coverage -------------------------------------------------
    //
    // Staff-only content must exist (otherwise the filter is untested in
    // practice) and student-readable content must exist (otherwise students
    // get nothing).
    const audiences = files.map((f) => {
        const raw = fs.readFileSync(path.join(DOCS, f), "utf8");
        return (raw.match(/audience:\s*(\S+)/) || [])[1];
    });

    assert("some documents are student-readable",
        audiences.some((a) => a === "all" || a === "student"));
    assert("some documents are staff-only",
        audiences.includes("staff"));

    // The role matrix names the known teacher-scope gap and must stay
    // staff-only — it is a description of where the guards are weak.
    const matrix = fs.readFileSync(path.join(DOCS, "00-role-access-matrix.md"), "utf8");
    assert("the role access matrix is staff-only",
        /audience:\s*staff/.test(matrix));

    // --- embedder ----------------------------------------------------------
    console.log("");
    const { embed } = require("../services/assistant/rag/embedder");

    const started = Date.now();

    const vectors = await embed([
        "What is my attendance percentage this semester?",
        "How do I check how many classes I attended?",
        "The fee voucher due date and outstanding balance"
    ]);

    console.log(`embedding model loaded in ${Date.now() - started} ms\n`);

    assert("embeds every input", vectors.length === 3);
    assert("vectors are 384-dimensional", vectors[0].length === 384);

    /*
     * Qdrant's Cosine distance assumes unit vectors. If normalisation were
     * skipped every score would silently degrade rather than fail, so the
     * magnitude is checked explicitly.
     */
    const magnitude = Math.sqrt(vectors[0].reduce((s, x) => s + x * x, 0));
    assert("vectors are L2-normalised", Math.abs(magnitude - 1) < 0.01,
        `|v| = ${magnitude.toFixed(4)}`);

    /*
     * The property that makes retrieval work at all: two ways of asking the
     * same thing must be closer than two unrelated topics. If this fails the
     * pipeline is wired up but useless.
     */
    const related = cosine(vectors[0], vectors[1]);
    const unrelated = cosine(vectors[0], vectors[2]);

    assert("related questions score higher than unrelated ones",
        related > unrelated,
        `related ${related.toFixed(3)} vs unrelated ${unrelated.toFixed(3)}`);

    assert("the related pair is meaningfully similar", related > 0.5,
        related.toFixed(3));

    // --- the client API we actually call still exists ----------------------
    //
    // This exists because of a real bug. vectorStore called `client.search()`,
    // which the REST client removed at v1.13 in favour of `query()`. Because
    // Qdrant is optional and its absence is handled gracefully, the resulting
    // "client.search is not a function" surfaced to the user as a plausible
    // "documentation unavailable" message — a broken call disguised as a
    // healthy fallback. Checking the method names catches that with the
    // container down, which is exactly when it would otherwise hide.
    console.log("");
    {
        const { QdrantClient } = require("@qdrant/js-client-rest");
        const probe = new QdrantClient({
            url: process.env.QDRANT_URL || "http://127.0.0.1:6333",
            checkCompatibility: false
        });

        for (const method of [
            "query", "upsert", "delete", "collectionExists",
            "createCollection", "createPayloadIndex", "getCollection"
        ]) {
            assert(`client exposes ${method}()`, typeof probe[method] === "function");
        }
    }

    // --- graceful degradation ---------------------------------------------
    console.log("");
    const { stats } = require("../services/assistant/rag/vectorStore");
    const health = await stats();

    if (health.ok) {
        console.log(`ok    Qdrant is reachable (${health.points} points, ${health.dimensions}d)`);
    } else {
        console.log(`note  Qdrant is not running (${health.reason})`);

        // The important half: an absent Qdrant must cost one tool, not the
        // assistant. The knowledge tool should report unavailability, and
        // every database tool must still be registered and callable.
        const tools = require("../services/assistant/tools");

        const scope = {
            kind: "student", userId: 1, roleId: 4, studentId: 1,
            fullName: "Test", registrationNumber: "T-1",
            programName: "BSCS", sectionId: 1, semesterNumber: 1
        };

        const result = await tools.dispatch("search_aims_knowledge", scope, {
            question: "how do I apply for a transcript"
        });

        assert("knowledge search fails gracefully without Qdrant",
            result.type === "error" && /not.*(available|reached)/i.test(result.message));

        assert("the knowledge tool tells the model NOT to answer from memory",
            /general knowledge/i.test(result.message));

        assert("database tools remain registered without Qdrant",
            tools.namesFor(scope).includes("get_attendance_summary"));
    }

    console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nAll RAG checks passed.");
    process.exit(failed ? 1 : 0);

})().catch((error) => {
    console.error("\nRAG SMOKE CRASHED:", error);
    process.exit(1);
});
