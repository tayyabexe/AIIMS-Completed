/*
 * HTTP surface for the RAG chatbot.
 *
 * Conversations are persisted in the same tables the old assistant used, so
 * existing transcripts stay readable and the widget's history UI keeps
 * working. What changed is what happens between question and answer: one
 * retrieval, one model call, no database tools.
 */

const config = require("../config/chatbot");
const scopeService = require("../services/assistant/scope.service");
const orchestrator = require("../services/chatbot/orchestrator");
const conversations = require("../services/assistant/conversation.service");
const roleProfiles = require("../config/roleProfiles");
const capabilityCatalog = require("../config/assistantCapabilities");

const MAX_MESSAGE = 1000;

/*
 * Runs a transcript operation, and never lets it fail the turn.
 *
 * The chatbot needs the database for ONE thing: remembering the conversation.
 * Answering does not touch it — the corpus lives in Qdrant and the reply comes
 * from the model. So a database wobble should cost the user their history, not
 * their answer.
 *
 * It did cost them the answer. A `findOwned` lookup timed out acquiring a
 * connection and the whole request returned 500, even though everything needed
 * to reply was already available. Persistence is a side effect here, and a
 * failing side effect must not take the main result with it.
 */
const persist = async (label, operation, fallback = null) => {
    try {
        return await operation();
    } catch (error) {
        console.warn(`[chatbot] transcript ${label} skipped: ${error.message}`);
        return fallback;
    }
};

const requireScope = async (req, res) => {

    const scope = await scopeService.resolveFor(req.user);

    if (!scope.ok) {
        res.status(403).json({ success: false, message: scope.reason });
        return null;
    }

    return scope;
};

/**
 * POST /api/chatbot/chat
 * { message, conversation_id?, portal? }
 */
const chat = async (req, res) => {

    if (!config.enabled) {
        return res.status(503).json({
            success: false,
            message: "The help assistant is currently disabled."
        });
    }

    /*
     * A string, or nothing. `String(value)` accepts anything, which is how
     * an array arrived as "a,b" and an object as "[object Object]" - both
     * spent a model call on a question nobody asked. A non-string body
     * field is a client bug and should be told so, not answered.
     */
    const raw = req.body?.message;

    if (raw !== undefined && raw !== null && typeof raw !== "string") {
        return res.status(400).json({
            success: false,
            message: "A message must be text."
        });
    }

    const question = String(raw || "").trim();

    if (!question) {
        return res.status(400).json({
            success: false,
            message: "A message is required."
        });
    }

    if (question.length > MAX_MESSAGE) {
        return res.status(400).json({
            success: false,
            message: `Message is too long (limit ${MAX_MESSAGE} characters).`
        });
    }

    try {

        const scope = await requireScope(req, res);
        if (!scope) return undefined;

        /*
         * Ownership is filtered in SQL. A conversation belonging to someone
         * else is treated identically to one that does not exist, because
         * conversation ids are sequential and distinguishing the two would
         * leak how many the system holds.
         */
        let conversationId = Number(req.body?.conversation_id) || null;

        if (conversationId) {
            const owned = await persist("lookup",
                () => conversations.findOwned(conversationId, scope.userId));
            if (!owned) conversationId = null;
        }

        if (!conversationId) {
            conversationId = await persist("create",
                () => conversations.create(scope, {
                    portal: req.body?.portal,
                    question
                }));
        }

        /*
         * History and the user's own message are independent of each other —
         * the history window deliberately excludes the turn being asked. Run
         * together they cost one round trip to a remote database instead of
         * two, which matters when each is ~200ms.
         */
        const [history] = conversationId
            ? await Promise.all([
                persist("history",
                    () => conversations.history(conversationId, config.historyTurns), []),
                persist("user-message",
                    () => conversations.addUserMessage(conversationId, question))
            ])
            : [[]];

        const started = Date.now();

        /*
         * The part that actually answers the question. Nothing above is
         * required for it to succeed.
         */
        const {
            type, answer, items, sources, navigation, retrievalAvailable, usage
        } = await orchestrator.run(scope, history || [], question);

        const latencyMs = Date.now() - started;

        /*
         * THREE TYPES NOW, NOT ONE.
         *
         * `type` names the SHAPE of the reply, and response_type is a MySQL
         * ENUM, so every value used here has to exist in the column or the
         * insert is rejected and the turn's transcript row is lost.
         *
         * `navigation` deliberately did NOT become a type for that reason — it
         * rides inside the envelope as an extra field, which is additive for
         * any client that does not know about it. The two values below are
         * different: they are not a decoration on an answer, they ARE the
         * answer, and a client that renders them as bare prose would show an
         * empty reply. So they are types, and the ENUM was extended to match.
         *
         * The whole envelope is persisted in response_payload as well, so
         * reopening a conversation from the sidebar re-renders the same fixed
         * components instead of degrading to text.
         *
         * `knowledge` is still the ordinary RAG answer and is unchanged. The
         * two additions are the deterministic replies the orchestrator
         * produces without calling the model:
         *
         *   capabilities - what this assistant covers, from
         *                  config/assistantCapabilities.js, as structured
         *                  items the frontend renders with a fixed component.
         *                  Not prose, for the same reason `navigation` is not
         *                  prose: a list the model rewrites is a list that
         *                  changes between askings.
         *
         *   scope        - the controlled refusal for a question outside what
         *                  AIMS covers. It carries the same `items` so the
         *                  refusal can show what IS available rather than
         *                  leaving the user to guess and ask again.
         *
         * Both values were added to the `response_type` ENUM by migration
         * 20260820120000. If that migration has not been run, the insert below
         * fails, `persist` swallows it, and the user still gets their answer —
         * they lose only the transcript row.
         */
        const envelope = {
            type: type || "knowledge",
            text: answer,
            citations: sources.map((s) => s.source),
            ...(items?.length ? { items } : {}),
            ...(navigation?.length ? { navigation } : {})
        };

        /*
         * Written together for the same reason as above, and both non-fatal:
         * the answer is already in hand and is about to be returned whether or
         * not it can be filed.
         */
        if (conversationId) {
            await Promise.all([
                persist("assistant-message",
                    () => conversations.addAssistantMessage(conversationId, {
                        envelope,
                        toolCalls: [],
                        usage,
                        latencyMs
                    })),
                persist("touch", () => conversations.touch(conversationId))
            ]);
        }

        return res.status(200).json({
            success: true,
            conversation_id: conversationId,

            /*
             * False when the transcript could not be written. The UI can then
             * avoid promising a history entry that does not exist, rather than
             * letting the user discover it later.
             */
            saved: Boolean(conversationId),
            response: envelope,

            /*
             * Which documents the answer was built from. Shown in the UI so a
             * reader can check a policy claim against its source rather than
             * taking the model's word for it.
             */
            sources,
            retrieval_available: retrievalAvailable,
            latency_ms: latencyMs
        });

    } catch (error) {

        if (error.capacity) {
            const retryAfter = Math.max(1, Number(error.retryAfterSeconds) || 30);
            res.set("Retry-After", String(retryAfter));
            return res.status(503).json({
                success: false,
                message: `The help assistant is busy. Try again in ${retryAfter}s.`
            });
        }

        console.error("[chatbot] chat failed:", error);

        return res.status(500).json({
            success: false,
            message: "The help assistant could not answer that."
        });
    }
};

/** GET /api/chatbot/conversations */
const listConversations = async (req, res) => {
    const scope = await requireScope(req, res);
    if (!scope) return undefined;

    const rows = await conversations.list(scope.userId);
    return res.json({ success: true, conversations: rows });
};

/** GET /api/chatbot/conversations/:id */
const getConversation = async (req, res) => {
    const scope = await requireScope(req, res);
    if (!scope) return undefined;

    const owned = await conversations.findOwned(Number(req.params.id), scope.userId);

    if (!owned) {
        return res.status(404).json({ success: false, message: "Not found." });
    }

    const rows = await conversations.messages(owned.conversation_id);
    return res.json({ success: true, conversation: owned, messages: rows });
};

/** DELETE /api/chatbot/conversations/:id */
const deleteConversation = async (req, res) => {
    const scope = await requireScope(req, res);
    if (!scope) return undefined;

    const owned = await conversations.findOwned(Number(req.params.id), scope.userId);

    if (!owned) {
        return res.status(404).json({ success: false, message: "Not found." });
    }

    await conversations.archive(owned.conversation_id);
    return res.json({ success: true });
};

/**
 * GET /api/chatbot/capabilities
 *
 * States plainly that this service has no data access, so the frontend can
 * point a data question at the analytics canvas instead of letting the user
 * discover the limit by being refused.
 *
 * It also returns this role's opening prompts, and that is a fix rather than
 * an addition: the widget has always read `data.suggestions` off this
 * response, and this response has never contained them. The chips it renders
 * from them have therefore never appeared once. They come from the server so
 * that a student is never offered "Who has overdue fees?" - a question only an
 * administrator can ask, which the widget's own hardcoded list used to offer
 * to everybody.
 *
 * `display_name` is the FALLBACK identity for the greeting. The portals
 * normally supply a better one from a profile they have already loaded, which
 * is why this is not the primary path - but an admin portal has no profile
 * record to load, so without this the frontend would be back to guessing a
 * name from an email address.
 */
const capabilities = async (req, res) => {
    const scope = await requireScope(req, res);
    if (!scope) return undefined;

    const profile = roleProfiles.profileFor(scope.kind);

    return res.json({
        success: true,

        scope: scope.kind,
        role_label: profile?.label || null,
        portal: profile?.portal || null,
        display_name: scope.fullName || null,

        // Read directly off the response by the widget. Kept at the top level
        // rather than nested under `capabilities`, which is where the widget
        // has always looked for them.
        suggestions: profile?.suggestions || [],

        capabilities: {
            scope: scope.kind,
            answers: "AIMS policies, procedures and portal navigation",
            has_data_access: false,
            data_route: "/api/analytics/ask",

            /*
             * The SAME array the chatbot returns when someone types "what can
             * you help me with", from the same module. One source, two
             * surfaces: whatever a client renders up front is exactly what the
             * assistant will say when asked, which is not true of any list
             * maintained in two places.
             */
            modules: capabilityCatalog.forScope(scope.kind),
            limits: capabilityCatalog.limitsFor(scope.kind),

            /*
             * What this role may ask about, and what it may not. Returned so a
             * client can show the boundary up front instead of letting the
             * user find it by being redirected mid-conversation.
             */
            can: profile?.can || [],
            cannot: (profile?.cannot || []).map((c) => ({
                action: c.action,
                handled_by: c.owner
            }))
        }
    });
};

module.exports = {
    chat,
    listConversations,
    getConversation,
    deleteConversation,
    capabilities
};
