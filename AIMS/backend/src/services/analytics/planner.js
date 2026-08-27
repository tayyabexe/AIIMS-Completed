/*
 * The planner: the only language-model call in the analytics route.
 *
 * WHAT IT DOES
 * ------------
 * Turns a typed question into a small JSON plan:
 *
 *     { corrected_question, mode, tool?, args?, sql?, render, title }
 *
 * That is the entire contribution of the model. It fixes the user's typos,
 * decides which curated tool answers the question, or writes SQL when no tool
 * fits, and names one of six chart templates.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It never sees a result row. Not a sample, not a summary, not a count. The
 * plan is produced before anything is executed, and once execution happens the
 * rows go straight to the browser.
 *
 * This is the fix for the class of bug that motivated the rewrite. The old
 * design asked the model to describe a result set it had been shown 40 rows
 * of, alongside a system-generated claim about the total. Both the sample and
 * the claim were wrong, and the model dutifully reported them. Here there is
 * no sample to mislead it and no claim to repeat, because it is not asked to
 * describe anything.
 *
 * PROMPT SIZE
 * -----------
 * The old orchestrator resent a 1,361-token system prompt, up to 3,122 tokens
 * of tool schemas, and a 24-message history on every one of up to four rounds
 * — 25,000+ tokens for a single admin question against an 8,000 TPM ceiling.
 * This is one call, no history, and a compact catalogue: a few hundred tokens.
 */

const config = require("../../config/analytics");
const groq = require("../assistant/groq.client");
const catalogue = require("./catalogue");
const prompts = require("./prompts");

/*
 * Who is asking, stated to the planner.
 *
 * This was missing entirely, and its absence is subtler than it looks. The
 * catalogue is already scope-filtered, so the model could INFER a role from
 * which tools it was offered - but inference is not knowledge, and the two
 * places it mattered both failed quietly:
 *
 *   - An admin got refusals phrased as though the data did not exist, because
 *     nothing told the planner it was serving somebody entitled to the whole
 *     institute, and that a gap in the catalogue was therefore worth working
 *     around rather than reporting as a fact about AIMS.
 *
 *   - A teacher's "my" is resolved by the CTE rewrite in scopedSql, which the
 *     planner is told about only in the abstract. Naming the person, their
 *     department and the size of their roster makes it concrete.
 *
 * Nothing here widens access. Every value is already true of the caller and
 * already governs which tables they were shown; this only stops the planner
 * having to guess at something the request already knows for certain.
 */
const identity = (scope) => {

    if (scope.kind === "admin") {
        return [
            "WHO IS ASKING",
            `Role: administrator${scope.fullName ? ` (${scope.fullName})` : ""}.`,
            'Entitled to institute-wide data. "We", "our", "us" and "the',
            'institute" mean the whole organisation, not a subset, and no',
            "ownership filter should be invented for them."
        ].join("\n");
    }

    if (scope.kind === "teacher") {
        return [
            "WHO IS ASKING",
            `Role: teacher${scope.fullName ? ` (${scope.fullName})` : ""}`
                + `${scope.departmentName ? `, ${scope.departmentName}` : ""}.`,
            `Teaches ${scope.classes?.length || 0} class(es): `
                + `${scope.subjectIds?.length || 0} subject(s), `
                + `${scope.studentIds?.size || 0} student(s) on their roster.`,
            "Every name in SCHEMA is ALREADY restricted to those students and",
            'subjects, so "my" needs no lookup and no extra WHERE clause.'
        ].join("\n");
    }

    return [
        "WHO IS ASKING",
        "Role: restricted. Answer only from the names listed below."
    ].join("\n");
};

/*
 * Strips a markdown fence if the model wrapped its JSON in one.
 *
 * Instructed not to, and mostly does not, but a planner that fails the whole
 * request over three backticks is needlessly brittle.
 */
const unfence = (text) => {
    const trimmed = String(text || "").trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return (fenced ? fenced[1] : trimmed).trim();
};

/*
 * Pulls the first balanced {...} out of a string.
 *
 * Reasoning-style models occasionally emit a sentence before the object even
 * when told not to. Scanning for the object is cheaper and more reliable than
 * a retry, and if there is no object the caller still gets a clean failure.
 */
const extractObject = (text) => {

    const start = text.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }

    return null;
};

/**
 * Produces a plan for one question.
 *
 * @param {Object} scope   from scope.service.resolveFor
 * @param {string} question the raw user input, typos and all
 * @returns {Promise<Object>} { plan, usage }
 */
const plan = async (scope, question, { signal } = {}) => {

    /*
     * The catalogue is scope-filtered, so a teacher's planner is never told
     * that get_fee_defaulters exists. This is the same principle as the old
     * tool registry: removing the name is stronger than declining the call,
     * because there is nothing for a crafted question to talk it into.
     */
    const { tools, schema } = await catalogue.forScope(scope, question);

    const messages = [
        { role: "system", content: prompts.systemFor(scope) },
        {
            role: "user",
            content: [
                identity(scope),
                "",
                `TOOLS\n${tools}`,
                "",
                `SCHEMA\n${schema}`,
                "",
                `QUESTION\n${question}`
            ].join("\n")
        }
    ];

    const { message, usage } = await groq.complete(messages, {
        model: config.groq.model,
        temperature: config.groq.temperature,
        maxTokens: config.groq.maxTokens,
        reasoningEffort: config.groq.reasoningEffort,
        signal
    });

    const raw = unfence(message.content || "");
    const objectText = extractObject(raw);

    if (!objectText) {
        throw Object.assign(
            new Error("The planner did not return a JSON plan."),
            { planFailure: true, raw }
        );
    }

    let parsed;

    try {
        parsed = JSON.parse(objectText);
    } catch {
        throw Object.assign(
            new Error("The planner returned malformed JSON."),
            { planFailure: true, raw }
        );
    }

    return { plan: parsed, usage };
};

/*
 * The instruction for a second attempt after the database rejected the SQL.
 *
 * Deliberately narrow: this is a correction, not a re-plan. The tool-vs-SQL
 * decision and the chart choice already survived validation, and re-opening
 * them would let a repair quietly answer a different question than the one
 * that failed.
 */
const REPAIR = [
    "Your previous SQL was rejected by MySQL. Fix it and return the plan again.",
    "",
    "The COLUMNS section below is authoritative — it is read from the live",
    "database. If a column you used is not listed there, it does not exist,",
    "however reasonable the name looks. Do not guess a replacement: either find",
    "the real column in COLUMNS, or join the table that genuinely holds it.",
    "",
    "Reply with the same JSON plan object as before, nothing else."
].join("\n");

/**
 * One corrective attempt after a schema error.
 *
 * Worth the extra call because the failure is precisely diagnosed — MySQL
 * names the offending column — and the fix is usually a join the planner
 * omitted. Without this a single wrong column name meant the user's question
 * failed outright, which is what a live "Unknown column 's.full_name'" did to
 * a perfectly answerable request about section attendance.
 *
 * Exactly one retry. A second failure means the planner has misunderstood
 * something a third attempt will not recover, and the user is better served by
 * an honest error than by a slower one.
 */
const repair = async (scope, question, badSql, dbError, { signal } = {}) => {

    const { tools, schema } = await catalogue.forScope(scope, question);

    /*
     * The full detail for every table the failed statement touched, regardless
     * of whether the question's keywords matched them. The planner has already
     * shown it is wrong about these specific tables, so this is the one place
     * trimming the schema would be a false economy.
     */
    const columns = await catalogue.columnsFor(scope, badSql);

    const messages = [
        { role: "system", content: [prompts.systemFor(scope), REPAIR].join("\n\n") },
        {
            role: "user",
            content: [
                identity(scope),
                "",
                `TOOLS\n${tools}`,
                "",
                `SCHEMA\n${schema}`,
                "",
                `COLUMNS (authoritative, for the tables your query used)\n${columns}`,
                "",
                `QUESTION\n${question}`,
                "",
                `YOUR SQL THAT FAILED\n${badSql}`,
                "",
                `DATABASE ERROR\n${dbError}`
            ].join("\n")
        }
    ];

    const { message, usage } = await groq.complete(messages, {
        model: config.groq.model,
        temperature: config.groq.temperature,
        maxTokens: config.groq.maxTokens,
        reasoningEffort: config.groq.reasoningEffort,
        signal
    });

    const objectText = extractObject(unfence(message.content || ""));

    if (!objectText) {
        throw Object.assign(
            new Error("The planner did not return a corrected plan."),
            { planFailure: true }
        );
    }

    try {
        return { plan: JSON.parse(objectText), usage };
    } catch {
        throw Object.assign(
            new Error("The corrected plan was malformed JSON."),
            { planFailure: true }
        );
    }
};

module.exports = { plan, repair, identity, systemFor: prompts.systemFor };
