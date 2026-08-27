/*
 * Conversation persistence.
 *
 * Writes through the application pool - the assistant's read-only account
 * cannot write, and is not granted SELECT on these tables either, so nothing
 * the model generates can reach one user's transcript from another user's
 * session.
 *
 * Every read is filtered by user_id in the SQL itself rather than checked
 * after loading. A conversation id is a small integer an attacker can simply
 * count through, so "load it, then compare the owner" is one forgotten branch
 * away from an enumeration bug.
 */

const { sequelize } = require("../../database/connection");
const config = require("../../config/assistant");

const select = async (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

/*
 * The first user message becomes the title, trimmed at a word boundary so the
 * sidebar does not show a heading cut mid-word.
 */
const titleFrom = (question) => {

    const clean = String(question).replace(/\s+/g, " ").trim();

    if (clean.length <= config.conversation.titleLength) return clean;

    const cut = clean.slice(0, config.conversation.titleLength);
    const lastSpace = cut.lastIndexOf(" ");

    return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}...`;
};

const create = async (scope, { portal, question }) => {

    const [result] = await sequelize.query(
        `INSERT INTO assistant_conversations (user_id, role_id, title, portal)
         VALUES (:userId, :roleId, :title, :portal)`,
        {
            replacements: {
                userId: scope.userId,
                roleId: scope.roleId,
                title: titleFrom(question || "New conversation"),
                portal: portal || null
            }
        }
    );

    return result;
};

/**
 * Loads a conversation the caller owns, or null.
 *
 * The user_id predicate is what makes this safe; a conversation belonging to
 * somebody else is indistinguishable from one that does not exist, which is
 * the correct behaviour for an enumerable id.
 */
const findOwned = async (conversationId, userId) => {

    const rows = await select(
        `SELECT conversation_id, user_id, role_id, title, portal, created_at
           FROM assistant_conversations
          WHERE conversation_id = :conversationId
            AND user_id = :userId
            AND is_archived = 0
          LIMIT 1`,
        { conversationId, userId }
    );

    return rows[0] || null;
};

const list = async (userId, limit = 25) =>
    select(
        `SELECT conversation_id, title, portal, created_at, updated_at
           FROM assistant_conversations
          WHERE user_id = :userId AND is_archived = 0
          ORDER BY updated_at DESC
          LIMIT :take`,
        { userId, take: Math.min(Number(limit) || 25, 100) }
    );

/**
 * The transcript, oldest first, for display.
 *
 * Tool rows are excluded: they hold raw JSON result payloads that were context
 * for the model, not something a person reads. The rendered data lives in the
 * assistant row's response_payload.
 */
const messages = async (conversationId, userId) => {

    const owned = await findOwned(conversationId, userId);
    if (!owned) return null;

    return select(
        `SELECT message_id, role, content, response_type, response_payload,
                created_at
           FROM assistant_messages
          WHERE conversation_id = :conversationId
            AND role IN ('user','assistant')
          ORDER BY created_at, message_id`,
        { conversationId }
    );
};

/**
 * The recent turns replayed to the model.
 *
 * Only user and assistant text is replayed, not the tool traffic. Re-sending
 * old tool results would grow the context every turn and, worse, let the model
 * answer a new question from stale rows instead of looking again — a student
 * asking "and now?" after paying a fee must not be answered from the balance
 * fetched before the payment.
 */
const history = async (conversationId, turns) => {

    /*
     * `turns` lets a caller ask for a shorter window than the assistant's
     * default. The chatbot uses 4 rather than 12: history is resent on every
     * call, and it was the largest single line in the old token bill.
     */
    const take = Number(turns) > 0 ? Number(turns) * 2 : config.historyTurns * 2;

    const rows = await select(
        `SELECT role, content
           FROM assistant_messages
          WHERE conversation_id = :conversationId
            AND role IN ('user','assistant')
            AND content IS NOT NULL
          ORDER BY created_at DESC, message_id DESC
          LIMIT :take`,
        { conversationId, take }
    );

    return rows
        .reverse()
        .map((row) => ({ role: row.role, content: row.content }));
};

const addUserMessage = async (conversationId, content) =>
    sequelize.query(
        `INSERT INTO assistant_messages (conversation_id, role, content)
         VALUES (:conversationId, 'user', :content)`,
        { replacements: { conversationId, content } }
    );

const addAssistantMessage = async (conversationId, {
    envelope,
    toolCalls,
    usage,
    latencyMs
}) =>
    sequelize.query(
        `INSERT INTO assistant_messages
            (conversation_id, role, content, tool_calls, response_type,
             response_payload, token_count, latency_ms)
         VALUES
            (:conversationId, 'assistant', :content, :toolCalls, :responseType,
             :payload, :tokens, :latencyMs)`,
        {
            replacements: {
                conversationId,
                content: envelope.text || "",
                toolCalls: toolCalls?.length ? JSON.stringify(toolCalls) : null,
                responseType: envelope.type,

                // The prose is already in `content`; storing it again inside the
                // payload would double the row for no benefit.
                payload: JSON.stringify({ ...envelope, text: undefined }),

                tokens: usage
                    ? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
                    : null,
                latencyMs: latencyMs ?? null
            }
        }
    );

/*
 * Touches updated_at so the conversation rises in the sidebar. Separate from
 * the message insert because the message table has no trigger back to its
 * parent.
 */
const touch = async (conversationId) =>
    sequelize.query(
        `UPDATE assistant_conversations
            SET updated_at = CURRENT_TIMESTAMP
          WHERE conversation_id = :conversationId`,
        { replacements: { conversationId } }
    );

const archive = async (conversationId, userId) =>
    sequelize.query(
        `UPDATE assistant_conversations
            SET is_archived = 1
          WHERE conversation_id = :conversationId AND user_id = :userId`,
        { replacements: { conversationId, userId } }
    );

module.exports = {
    create,
    findOwned,
    list,
    messages,
    history,
    addUserMessage,
    addAssistantMessage,
    touch,
    archive,
    titleFrom
};
