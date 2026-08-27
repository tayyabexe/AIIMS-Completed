/*
 * Smoke test for the chatbot's scope gate.
 *
 * Checks the three decisions that are made in CODE and therefore can be
 * asserted without spending a token: is this a capability question, is it
 * plainly outside AIMS, and is it worth asking the model about at all.
 *
 * Deliberately does NOT call Groq. The model fallback in intent.js is exercised
 * only through `worthClassifying`, which decides whether the call happens —
 * that gate is the part with a cost attached, so that is the part worth
 * pinning down.
 *
 * THE MOST IMPORTANT ASSERTIONS HERE ARE THE NEGATIVE ONES. A missed
 * capability question falls through to retrieval and behaves as it always
 * did; a REFUSED real question is a user being told their genuine AIMS
 * question is off-topic, and there is no way for them to discover that was
 * wrong. The "must not be refused" block below is the regression guard on
 * exactly that.
 *
 * Usage: node src/testing/chatbot.smoke.js
 */

require("dotenv").config({ quiet: true });

const intent = require("../services/chatbot/intent");
const capabilities = require("../config/assistantCapabilities");
const orchestrator = require("../services/chatbot/orchestrator");

let checks = 0;

const assert = (label, condition) => {
    checks += 1;
    console.log(`${condition ? "ok   " : "FAIL "} ${label}`);
    if (!condition) process.exitCode = 1;
};

const classifies = (question, expected) =>
    assert(`${expected.padEnd(12)} <- "${question}"`,
        intent.classify(question) === expected);

(async () => {

    // --- capability questions ---------------------------------------------
    console.log("\ncapability questions\n");

    [
        "What can I ask you about?",
        "What can you help me with?",
        "What do you know?",
        "Which AIMS modules can you answer questions about?",
        "What features can you help me with?",
        "what kind of questions can i ask",
        "how can you help me",
        "what else can you do",
        "what are your capabilities"
    ].forEach((q) => classifies(q, "capability"));

    // --- plainly out of scope ---------------------------------------------
    console.log("\nout of scope\n");

    [
        "What's the weather tomorrow?",
        "Write me a Python game.",
        "Who won the football match?",
        "Tell me a joke.",
        "what is the capital of France",
        "should I buy bitcoin"
    ].forEach((q) => classifies(q, "out_of_scope"));

    /* --- must NOT be touched ---------------------------------------------
     *
     * Every line here is a real question that an over-eager gate would have
     * ruined. Two shapes are represented on purpose:
     *
     *   - a capability PATTERN with a real subject attached ("what can you
     *     tell me about fee vouchers") — a question, not a menu request;
     *   - an off-topic WORD inside an AIMS question ("is there a cricket
     *     match in my timetable") — which is why the refusal needs two
     *     signals and not one.
     */
    console.log("\nmust fall through to normal retrieval\n");

    [
        "How is my attendance percentage calculated?",
        "What can you tell me about fee vouchers?",
        "where do I find my results",
        "is there a cricket match in my timetable",
        "how do I appeal a result",
        "what is the policy on late admission",
        "why can I not see my marks yet",
        "how many attempts do I get at a re-check"
    ].forEach((q) => classifies(q, "unknown"));

    // --- the model fallback is not on the hot path ------------------------
    console.log("\nclassifier call gating\n");

    assert("an AIMS question never reaches the classifier",
        !intent.worthClassifying("how do I appeal a result"));

    assert("a question with no AIMS vocabulary may reach the classifier",
        intent.worthClassifying("who painted the Sistine Chapel"));

    // --- the catalogue ----------------------------------------------------
    console.log("\ncapability catalogue\n");

    for (const kind of ["student", "teacher", "admin", "parent"]) {
        const items = capabilities.forScope(kind);

        assert(`${kind}: catalogue is non-empty`, items.length > 0);

        assert(`${kind}: every item has an id, title and summary`,
            items.every((i) => i.id && i.title && i.summary));
    }

    assert("AI Analytics is offered to admins only",
        capabilities.forScope("admin").some((i) => i.id === "ai-analytics")
        && !["student", "teacher", "parent"].some((k) =>
            capabilities.forScope(k).some((i) => i.id === "ai-analytics")));

    assert("reports are not offered to students or parents",
        !["student", "parent"].some((k) =>
            capabilities.forScope(k).some((i) => i.id === "reports")));

    // --- the deterministic replies ----------------------------------------
    //
    // run() returns these before any retrieval or model call, so they are
    // safe to await here with no Qdrant and no Groq.
    console.log("\ndeterministic replies\n");

    const scope = { kind: "student", userId: 1, fullName: "Test Student" };

    const caps = await orchestrator.run(scope, [], "What can you help me with?");

    assert("capability question returns type 'capabilities'",
        caps.type === "capabilities");

    assert("...with the catalogue attached, not prose",
        caps.items.length === capabilities.forScope("student").length);

    assert("...and spends no model call",
        caps.usage === null);

    assert("...and is not flagged as unverified",
        caps.retrievalAvailable === true);

    const refused = await orchestrator.run(scope, [], "Tell me a joke.");

    assert("out-of-scope question returns type 'scope'",
        refused.type === "scope");

    assert("...naming what IS covered, from the catalogue",
        capabilities.titlesFor("student")
            .every((t) => refused.answer.toLowerCase().includes(t.toLowerCase())));

    assert("...without claiming the documentation is missing",
        !/documentation|knowledge base/i.test(refused.answer));

    assert("...and spends no model call",
        refused.usage === null);

    console.log(`\n${checks} checks`);

})();
