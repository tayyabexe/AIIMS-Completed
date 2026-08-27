/*
 * Verifies retrieval against a running Qdrant, including the audience filter.
 *
 * The filter is a permission, not a ranking signal — staff-only documentation
 * must be unreachable by a student's query however it is worded. That is
 * asserted here by asking the questions most likely to surface it and checking
 * what comes back, rather than by trusting the filter is wired up.
 *
 * Uses no Groq tokens.
 *
 * Usage: node src/testing/rag.search.js
 */

require("dotenv").config({ quiet: true });

const vectorStore = require("../services/assistant/rag/vectorStore");

let failed = 0;

const assert = (label, ok, detail = "") => {
    console.log(`${ok ? "ok    " : "FAIL  "}${label}${detail ? `  -- ${detail}` : ""}`);
    if (!ok) failed += 1;
};

(async () => {

    const stats = await vectorStore.stats();
    console.log(`collection: ${JSON.stringify(stats)}\n`);

    assert("the corpus is populated", stats.ok && stats.points > 50);

    // --- retrieval quality -------------------------------------------------
    /*
     * Several documents can legitimately answer one question, so each case
     * lists every acceptable source rather than one.
     *
     * Pinning a single file made this fail twice on correct behaviour: "what
     * is the pass mark" returned Examinations and Marks — whose Common
     * Questions section explains exactly that — and "how do I mark attendance"
     * returned Attendance rather than the Faculty guide. Both are the right
     * answer; the assertion was the thing that was wrong.
     */
    const questions = [
        ["how do I check my attendance", ["Attendance", "Student Portal"]],
        ["what is the pass mark", ["Results", "Examinations"]],
        ["my fee voucher is overdue", ["Fees"]],
        ["I forgot my password", ["Accounts"]],
        ["when are results published", ["Results", "Examinations"]],
        ["how do I mark attendance for my class", ["Attendance", "Faculty"]]
    ];

    for (const [question, acceptable] of questions) {

        const hits = await vectorStore.search(question, { audience: "all", topK: 3 });

        const top = hits[0];

        console.log(
            `\n"${question}"\n  -> ${hits.length} hits` +
            (top ? `, top: ${top.source} / ${top.section} (${top.score.toFixed(3)})` : "")
        );

        assert(`  retrieves something for "${question.slice(0, 30)}"`, hits.length > 0);

        if (top) {
            assert(`  top hit is relevant (${acceptable.join(" | ")})`,
                acceptable.some((name) => top.source.includes(name)),
                `got "${top.source}"`);
        }
    }

    // --- audience filtering is a permission --------------------------------
    console.log("\n--- audience filtering\n");

    /*
     * Questions aimed squarely at staff-only documents. A student asking these
     * must get nothing from them — the role matrix in particular documents
     * where the backend's own guards are weak.
     */
    const staffProbes = [
        "what is the role access matrix",
        "which routes have no authorize guard",
        "how do I reissue credentials for a student",
        "how do I verify a fee payment",
        "how do I onboard a teacher"
    ];

    for (const probe of staffProbes) {

        const asStudent = await vectorStore.search(probe, { audience: "student", topK: 5 });
        const leaked = asStudent.filter((h) => h.audience === "staff" || h.audience === "teacher");

        assert(`student cannot reach staff docs: "${probe.slice(0, 34)}"`,
            leaked.length === 0,
            leaked.length ? `LEAKED ${leaked.map((l) => l.source).join(", ")}` : "");
    }

    // The same content must be reachable by the people it is written for.
    const asAdmin = await vectorStore.search(
        "how do I reissue credentials for a student", { audience: "admin", topK: 5 }
    );
    assert("an admin CAN reach staff documentation", asAdmin.length > 0,
        asAdmin[0] ? asAdmin[0].source : "nothing returned");

    const asTeacher = await vectorStore.search(
        "how do I publish marks for my class", { audience: "teacher", topK: 5 }
    );
    assert("a teacher CAN reach teacher documentation", asTeacher.length > 0,
        asTeacher[0] ? asTeacher[0].source : "nothing returned");

    // --- the score floor ---------------------------------------------------
    //
    // Vector search always returns its nearest neighbours however far away they
    // are. Without a floor, a question the corpus does not cover comes back
    // with its least-irrelevant chunks and the model answers from them.
    console.log("");
    const nonsense = await vectorStore.search(
        "what is the airspeed velocity of an unladen swallow",
        { audience: "all", topK: 5 }
    );

    assert("an uncovered question returns nothing rather than noise",
        nonsense.length === 0,
        nonsense.length ? `returned ${nonsense.length}: ${nonsense[0].source}` : "");

    console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nAll retrieval checks passed.");
    process.exit(failed ? 1 : 0);

})().catch((error) => {
    console.error("SEARCH TEST CRASHED:", error);
    process.exit(1);
});
