/*
 * The tool registry and dispatcher.
 *
 * Two jobs, and the first one is a security control rather than a
 * convenience:
 *
 *   1. Decide which tools a given scope is even *shown*. A student's request
 *      never includes get_fee_defaulters in its tool list, so the model has no
 *      name to call and no schema to fill in. This is stronger than checking
 *      permission inside each tool, because it removes the option rather than
 *      declining it — there is nothing for a jailbreak to talk the model into
 *      attempting.
 *
 *   2. Dispatch a call by name, with the scope the backend resolved, never one
 *      the model supplied.
 *
 * Each tool still re-checks its own scope on entry. Belt and braces: the
 * filtering here is what the model sees, the check inside is what actually
 * runs, and neither is trusted to be the only one.
 */

const studentTools = require("./student.tools");
const teacherTools = require("./teacher.tools");
const adminTools = require("./admin.tools");
const sqlTools = require("./sql.tools");
const knowledgeTools = require("./knowledge.tools");

/*
 * One flat namespace. A duplicate name would mean one tool silently shadowing
 * another, so the merge is checked rather than assumed — this throws at
 * require time, which is when a developer can still see it.
 */
const registry = {};

const merge = (module_, source) => {
    for (const [name, tool] of Object.entries(module_.tools)) {
        if (registry[name]) {
            throw new Error(
                `Duplicate assistant tool "${name}" (defined in ${source} and earlier). ` +
                `Tool names share one namespace and must be unique.`
            );
        }
        registry[name] = { ...tool, name };
    }
};

merge(studentTools, "student.tools");
merge(teacherTools, "teacher.tools");
merge(adminTools, "admin.tools");
merge(sqlTools, "sql.tools");
merge(knowledgeTools, "knowledge.tools");

/*
 * Widens every OPTIONAL parameter to also accept null.
 *
 * Models routinely fill in an argument object completely, passing null for the
 * options they are not using:
 *
 *     { "program_id": null, "batch_id": null, "min_amount": null }
 *
 * That is a sensible thing for a model to do, and it is what several of them
 * actually do. But a property declared `{ type: "integer" }` rejects null, and
 * Groq validates tool arguments against the schema before executing anything —
 * so the ENTIRE completion is thrown away with `tool_use_failed`, and the user
 * gets a failed turn for a call whose meaning was perfectly clear.
 *
 * This was diagnosed from a live failure: an admin asked for the fee
 * defaulters, the model called the right tool with the right intent, and the
 * request was rejected for four nulls in optional fields.
 *
 * Declaring the type as ["integer", "null"] accepts both. Required parameters
 * are deliberately left alone — a null there is a real mistake and should
 * still be caught.
 *
 * Applied here, centrally, rather than in each of 33 tool definitions: it is a
 * property of how models call tools, not of any particular tool.
 */
const allowNullOptionals = (parameters) => {

    if (!parameters?.properties) return parameters;

    const required = new Set(parameters.required || []);
    const properties = {};

    for (const [name, schema] of Object.entries(parameters.properties)) {

        if (required.has(name) || !schema.type || Array.isArray(schema.type)) {
            properties[name] = schema;
            continue;
        }

        properties[name] = { ...schema, type: [schema.type, "null"] };
    }

    return { ...parameters, properties };
};

/**
 * The tools this scope may use, in the chat-completions function format.
 *
 * `scope.kind` is "student" | "teacher" | "admin", set by scope.service.js
 * from the database, never from anything the caller sent.
 */
const definitionsFor = (scope) =>
    Object.values(registry)
        .filter((tool) => tool.roles.includes(scope.kind))
        .map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                /*
                 * A tool may carry a per-role rewording in `descriptions`.
                 *
                 * Several tools are genuinely correct for more than one role -
                 * their handlers already branch on scope.kind - but were
                 * described in one role's voice, because that is the role they
                 * were written for. An admin offered
                 * "the students enrolled in one of the teacher's classes" has
                 * to decide whether it is being addressed, and a planner that
                 * guesses wrong either skips a tool that would have worked or
                 * answers as though the caller were somebody else.
                 *
                 * The alternative was a duplicate tool per role, which means
                 * two names for one query and two things to keep in step. A
                 * description is the only part that actually differs, so it is
                 * the only part that varies here.
                 */
                description: tool.descriptions?.[scope.kind] || tool.description,
                parameters: allowNullOptionals(
                    tool.parameters || { type: "object", properties: {} }
                )
            }
        }));

/** Names only — for the system prompt and for logging. */
const namesFor = (scope) =>
    Object.values(registry)
        .filter((tool) => tool.roles.includes(scope.kind))
        .map((tool) => tool.name);

/**
 * Runs a tool.
 *
 * Never throws: every failure becomes a result object the orchestrator can
 * hand back to the model. A tool that throws mid-conversation would otherwise
 * take down a whole chat turn over one bad argument.
 */
const dispatch = async (name, scope, args) => {

    const tool = registry[name];

    if (!tool) {
        return {
            type: "error",
            message: `There is no tool called "${name}".`
        };
    }

    /*
     * The authorisation check that matters. definitionsFor() already withheld
     * this tool from the model, so reaching here means either a model that
     * invented a name it was never given, or a bug. Both are refused, and the
     * refusal is logged with the tool name so the former is visible.
     */
    if (!tool.roles.includes(scope.kind)) {
        return {
            type: "refused",
            message:
                "That information is not available for this account type."
        };
    }

    try {
        const result = await tool.run(scope, args || {});

        // A tool that returns nothing at all is a bug, but it should surface
        // as an empty answer rather than as `undefined` reaching the model.
        return result || { type: "answer", rows: [] };

    } catch (error) {

        console.error(`[assistant] tool ${name} failed:`, error.message);

        return {
            type: "error",
            message:
                "That lookup failed. The data could not be read just now."
        };
    }
};

module.exports = {
    registry,
    definitionsFor,
    namesFor,
    dispatch
};
