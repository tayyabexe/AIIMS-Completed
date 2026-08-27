/*
 * The tool and schema catalogue shown to the planner.
 *
 * Deliberately a compact text listing rather than the JSON-Schema tool
 * definitions the old orchestrator sent.
 *
 * The reason is cost. Full JSON Schema for an admin's 32 tools measured 3,122
 * tokens, and it was resent on every round of every turn. The planner does not
 * need JSON Schema, because it is not using the provider's tool-calling
 * mechanism — it is writing a plan object, and a one-line signature per tool
 * tells it everything it needs to fill that object in. The same 32 tools cost
 * roughly a tenth as much written this way.
 *
 * The schema digest is cached, because it is a fixed property of the database
 * rather than of the question.
 */

const tools = require("../assistant/tools");
const scopedSql = require("../assistant/scopedSql");
const sqlGuard = require("../assistant/sqlGuard");
const { buildSchemaContext } = require("../assistant/tools/sql.tools");

/*
 * Tools that exist to feed a conversational assistant rather than a data
 * canvas, and which the planner should never choose.
 *
 * search_aims_knowledge belongs to the chatbot now — a policy document is not
 * a result set and cannot be charted or tabulated. describe_database_schema is
 * redundant because the schema is already in the prompt. execute_readonly_query
 * is excluded because raw SQL is expressed as mode:"sql", not as a tool call.
 */
const EXCLUDED = new Set([
    "search_aims_knowledge",
    "get_portal_navigation",
    "describe_database_schema",
    "execute_readonly_query"
]);

/*
 * One line per tool: name, arguments, purpose.
 *
 * Argument types are abbreviated to the three that actually occur, because a
 * planner filling in `{"program_id": 3}` needs to know it is a number and
 * nothing more.
 */
const signature = (tool, withPurpose = true) => {

    const props = tool.parameters?.properties || {};
    const required = new Set(tool.parameters?.required || []);

    const args = Object.entries(props)
        .map(([name, spec]) => {
            const type = spec.type === "integer" ? "int"
                : spec.type === "number" ? "num"
                    : spec.type === "boolean" ? "bool"
                        : "str";
            return required.has(name) ? `${name}:${type}!` : `${name}:${type}`;
        })
        .join(", ");

    /*
     * Descriptions are written for a conversational model and often run to
     * several sentences. The planner only needs the first one to tell tools
     * apart, and the rest is repeated on every request.
     */
    if (!withPurpose) return `${tool.name}(${args})`;

    const purpose = String(tool.description || "")
        .split(/(?<=\.)\s/)[0]
        .trim();

    return `${tool.name}(${args}) - ${purpose}`;
};

/*
 * Which tools get their one-line purpose spelled out, and which are listed as
 * a bare signature.
 *
 * The same two-tier idea the schema uses, with one deliberate difference: the
 * ARGUMENTS are never dropped. A planner that picks a tool it has only seen
 * the name of has to invent the argument object, and unlike a wrong column in
 * generated SQL there is no database error to repair from - the tool simply
 * rejects the call and the question fails outright. The purpose text is what a
 * planner needs in order to CHOOSE a tool; the signature is what it needs in
 * order to USE one, so only the first is ever conditional.
 *
 * Below a floor this is not worth doing at all. A teacher has nine tools; the
 * saving would be a few dozen tokens against a real risk of hiding the one
 * that fits.
 */
const DETAIL_FLOOR = 12;

const purposeful = (usable, question) => {

    if (usable.length <= DETAIL_FLOOR) return new Set(usable.map((f) => f.name));

    const words = new Set(
        String(question).toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 2 && !STOPWORDS.has(w))
            .flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w]))
    );

    const chosen = new Set();

    for (const fn of usable) {
        const first = String(fn.description || "").split(/(?<=\.)\s/)[0];
        if (tokens(`${fn.name} ${first}`).some((t) => words.has(t))) {
            chosen.add(fn.name);
        }
    }

    /*
     * A question whose vocabulary matches nothing gets the full listing rather
     * than a wall of bare signatures. That is precisely the case where the
     * planner most needs to read what each tool is actually for.
     */
    return chosen.size ? chosen : new Set(usable.map((f) => f.name));
};

let schemaCache = null;

/*
 * Trims the schema digest to the tables a question plausibly touches.
 *
 * The full digest is 3,482 tokens for an admin — by far the largest line in
 * the request, and almost all of it irrelevant to any single question. Sending
 * it whole is what pushed a planner call to 5,000 tokens against an 8,000 TPM
 * ceiling.
 *
 * The compromise is two-tier. Every table and view NAME is always listed, so
 * the planner can never conclude that something does not exist. Full column
 * detail is included only for the entries whose name or columns match a word
 * from the question. A planner that picks a curated tool — the common case —
 * needs neither, and a planner writing SQL needs detail for the two or three
 * tables it is actually joining.
 *
 * Matching is deliberately generous. Missing a relevant table costs a wrong
 * query; including a spare one costs a few dozen tokens.
 */
const STOPWORDS = new Set([
    "the", "a", "an", "of", "for", "and", "or", "in", "on", "to", "by", "with",
    "list", "show", "me", "give", "get", "all", "how", "many", "much", "what",
    "which", "who", "is", "are", "was", "were", "do", "does", "please", "per",
    "from", "that", "this", "chart", "graph", "table", "report", "data"
]);

/*
 * Tables and views whose full column detail is ALWAYS sent, whatever the
 * question said.
 *
 * The keyword filter below is the right idea and was wrong at exactly one
 * point: a question naming a PERSON contains no schema vocabulary at all.
 * Asked "list the teachers that teach ayeza sajid", the words to match on are
 * "teachers", "teach", "ayeza" and "sajid" — so the teacher-ish lines were
 * detailed and `students` was reduced to a bare name, because the word
 * "student" never appears in the question. The planner could see that a
 * students table existed but not that it had a first_name, and concluded the
 * schema offered no way to reach a student by name. It then said so, in the
 * language of the REFUSING rule: not supported for this user.
 *
 * That refusal was false, and false in the most expensive direction — it reads
 * as a missing feature rather than as a prompt that withheld thirteen lines.
 *
 * These are the identity and relationship backbone: who people are, and what
 * connects them. Every "who / whose / which of them" question needs some of
 * them and almost none of those questions name them. Thirteen lines is a cost
 * worth paying to remove a whole class of wrong refusal.
 */
const CORE = new Set([
    "students", "teachers", "employees", "subjects", "sections",
    "programs", "batches", "departments", "semesters",
    "enrollments", "timetables",
    "vw_student_profile_full", "vw_teacher_class_roster"
]);

/*
 * Splits a table or column name into the words a question might use.
 *
 * `avg_attendance_percentage` becomes avg / attendance / percentage, so a
 * question saying "attendance" matches it without matching every line that
 * merely contains the letters.
 */
const tokens = (name) => {

    const parts = String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

    /*
     * Both forms of anything plural, matching what the question words are
     * expanded to. A question saying "scholarship" has to reach the
     * `scholarships` table, and the expansion has to happen on both sides or
     * whichever side was not expanded misses.
     */
    return parts.flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w]));
};

/*
 * Trims the schema digest to the tables a question plausibly touches.
 *
 * WHY NAME MATCHING CAME FIRST
 * ----------------------------
 * The original rule was `line.includes(word)` over the whole line, columns and
 * all. That is generous in the wrong direction, because a foreign key appears
 * in almost everything: asked "list all the info about the programs", the word
 * "program" matched `program_id` and `program_name` in ten views that had
 * nothing to do with the question - vw_at_risk_students, vw_fee_defaulters,
 * vw_exam_schedule_full and the rest - and each arrived at full column detail.
 * Measured on that one question it was about 1,200 tokens of schema describing
 * views the planner had no reason to read.
 *
 * So a word now matches on the ENTRY NAME first. `programs` and
 * vw_program_semester_catalog match "program"; a view that merely carries a
 * program_id does not.
 *
 * Column matching is not dropped, because some vocabulary only ever appears as
 * a column - nothing is named "cgpa". It is applied per word, and only for the
 * words that matched no name at all. That way "cgpa by programme" still pulls
 * in the GPA views on the strength of "cgpa", without "programme" dragging in
 * everything that references a programme.
 */
const relevantSchema = (digest, question) => {

    const words = String(question).toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
        /*
         * Crude singularisation, so "students" matches a `student_id` column
         * and a `students` table alike. Both forms are kept because either may
         * be the one that appears.
         */
        .flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w]));

    if (!words.length) return digest;

    const lines = digest.split(/\r?\n/);

    const names = [];
    const entries = [];

    for (const line of lines) {

        const name = (line.match(/^\s*([a-z0-9_]+)\s*\(/i) || [])[1];
        if (!name || !/^\s/.test(line)) continue;

        names.push(name);

        entries.push({
            line,
            core: CORE.has(name.toLowerCase()),
            nameTokens: new Set(tokens(name)),
            /*
             * Column tokens, minus the ones that say nothing about subject
             * matter. `id` is on almost every line, and the timestamp columns
             * would make "date" match the whole schema.
             */
            columnTokens: new Set(
                tokens(line.slice(name.length))
                    .filter((t) => !["id", "int", "varchar", "decimal", "bigint",
                        "tinyint", "datetime", "date", "time", "enum", "year",
                        "text", "created", "updated", "at", "is", "deleted"]
                        .includes(t))
            )
        });
    }

    const matchedByName = new Set();

    for (const entry of entries) {
        if (entry.core || words.some((w) => entry.nameTokens.has(w))) {
            matchedByName.add(entry);
        }
    }

    /*
     * The words that no table or view is named after. Only these are allowed
     * to match on columns.
     */
    const orphans = words.filter(
        (w) => !entries.some((e) => e.nameTokens.has(w))
    );

    const keep = new Set(
        entries
            .filter((e) => matchedByName.has(e)
                || orphans.some((w) => e.columnTokens.has(w)))
            .map((e) => e.line)
    );

    /*
     * Emitted in document order, headings included, so the digest keeps its
     * shape: the "VIEWS - prefer these" guidance has to stay above the views
     * it is talking about, and the base tables have to stay below their own
     * heading. Collecting headings separately and prepending them loses both.
     */
    const detailed = lines.filter(
        (line) => (!/^\s/.test(line) && line.trim()) || keep.has(line)
    );

    return [
        detailed.join("\n"),
        "",
        "ALL TABLES AND VIEWS (names only; ask for a curated tool first):",
        names.join(", ")
    ].join("\n");
};

/*
 * Actual values for the handful of columns users name in questions.
 *
 * A schema tells the planner that `sections.section_name` is a varchar. It
 * does not tell it that the values are "CS-2A" and "SE-2A" rather than "2A".
 * Asked about "section 2A of the computer science department", the planner
 * wrote a perfectly valid query for section_name = '2A' and matched nothing —
 * a silent wrong answer, which is worse than an error, because zero rows looks
 * like a fact about the institute rather than a vocabulary mismatch.
 *
 * Only low-cardinality label columns are listed. Anything with thousands of
 * distinct values would cost more than the schema and help less, and no
 * personal data belongs in a prompt — these are structural labels, the same
 * ones printed on a timetable.
 */
const VALUE_HINTS = [
    ["sections", "section_name"],
    ["programs", "program_name"],
    ["departments", "department_name"],
    ["batches", "batch_name"]
];

let valueCache = null;

const buildValueHints = async () => {

    const { readonlySequelize } = require("../../database/readonlyConnection");

    const lines = [];

    for (const [table, column] of VALUE_HINTS) {
        try {
            const rows = await readonlySequelize.query(
                `SELECT DISTINCT \`${column}\` AS v FROM \`${table}\`
                  WHERE \`${column}\` IS NOT NULL
                  ORDER BY \`${column}\` LIMIT 40`,
                { type: readonlySequelize.QueryTypes.SELECT }
            );

            if (rows.length) {
                lines.push(`${table}.${column}: ${rows.map((r) => r.v).join(", ")}`);
            }
        } catch {
            // A missing table or a denied column simply contributes no hint.
        }
    }

    return lines.length
        ? [
            "ACTUAL VALUES - match these exactly. A user's shorthand often",
            "differs from the stored value (\"section 2A\" is stored as \"CS-2A\").",
            "When a user's wording is close but not identical, use LIKE.",
            ...lines
        ].join("\n")
        : "";
};

/**
 * The catalogue for one scope.
 *
 * @param {Object} scope    from scope.service.resolveFor
 * @param {string} question used to trim the schema to relevant tables; pass
 *                          nothing to get the full digest
 * @returns {Promise<{tools: string, schema: string, names: Set<string>}>}
 */
const forScope = async (scope, question = "") => {

    /*
     * definitionsFor already applies role filtering, so this inherits the
     * registry's access rules rather than restating them. A second list of
     * who-may-see-what is a second thing to keep in step, and the one that
     * drifts is always the copy.
     */
    const definitions = tools.definitionsFor(scope);

    const usable = definitions
        .map((d) => d.function || d)
        .filter((f) => !EXCLUDED.has(f.name));

    const names = new Set(usable.map((f) => f.name));

    const detail = purposeful(usable, question);

    const listing = usable.length
        ? usable.map((f) => signature(f, detail.has(f.name))).join("\n")
        : "(no tools available for this account)";

    /*
     * A teacher is shown the scoped CTE names, not the real schema. Their SQL
     * runs against names that scopedSql has already rewritten to their own
     * roster, so the real table list would be both useless and a disclosure.
     */
    if (scope.kind === "teacher") {
        return {
            tools: listing,
            schema: scopedSql.describeForTeacher(),
            names
        };
    }

    if (!schemaCache) {
        schemaCache = await buildSchemaContext();
    }

    if (valueCache === null) {
        valueCache = await buildValueHints();
    }

    const digest = question ? relevantSchema(schemaCache, question) : schemaCache;

    return {
        tools: listing,
        schema: valueCache ? `${digest}\n\n${valueCache}` : digest,
        names
    };
};

/**
 * Full column detail for every table a statement referenced.
 *
 * Used by the repair path. The relevance filter that trims the schema for the
 * first attempt is exactly wrong here: the planner has already demonstrated it
 * is confused about these particular tables, so it needs their complete column
 * lists rather than a keyword-matched subset.
 *
 * @param {Object} scope resolved caller scope
 * @param {string} sql   the statement that failed
 */
const columnsFor = async (scope, sql) => {

    if (scope.kind === "teacher") return scopedSql.describeForTeacher();

    if (!schemaCache) schemaCache = await buildSchemaContext();

    /*
     * referencedTables reads FROM and JOIN targets, including inside
     * subqueries, off a literal-stripped copy — so a string containing the
     * word "from" is not mistaken for a clause.
     */
    let tables;

    try {
        tables = sqlGuard.referencedTables(
            sqlGuard.stripLiteralsAndComments(String(sql || ""))
        );
    } catch {
        tables = [];
    }

    if (!tables.length) return schemaCache;

    const wanted = new Set(tables.map((t) => t.toLowerCase()));

    const lines = schemaCache.split(/\r?\n/).filter((line) => {
        const name = (line.match(/^\s*([a-z0-9_]+)\s*\(/i) || [])[1];
        return name && wanted.has(name.toLowerCase());
    });

    return lines.length
        ? lines.join("\n")
        : schemaCache;
};

/*
 * Exposed so a schema migration in a long-running process can drop the cache.
 *
 * Cached PLANS go with it. A plan names columns, so a plan that outlives the
 * schema it was written against is a query that fails — and it would fail
 * identically on every replay until the TTL expired.
 */
const invalidate = () => {
    schemaCache = null;
    valueCache = null;
    require("./planCache").invalidate();
};

module.exports = { forScope, columnsFor, invalidate, EXCLUDED };
