/*
 * Configuration for the RAG chatbot.
 *
 * This service answers "how does AIMS work" — policies, procedures, where to
 * find a screen. It reads a document corpus and nothing else.
 *
 * It has NO database tools. That is the split: a question about what is in the
 * database goes to /api/analytics, which returns rows. A question about how
 * something works comes here, and gets prose.
 *
 * The separation is what makes each side safe to tune. This service can be
 * chatty, keep history and write freely, because the worst outcome is a
 * clumsy explanation. Analytics cannot, because the worst outcome there is a
 * confident wrong number — which is exactly what the previous combined design
 * produced.
 */

const { ROLES } = require("./roles");
const groq = require("./groq");

/*
 * Parent is included here but NOT in ASSISTANT_ROLES or ANALYTICS_ROLES.
 *
 * That asymmetry is the point of the split. The objection to serving parents
 * was always about data: a parent needs a scope resolver tying them to their
 * wards, and shipping data tools without one means answering from the wrong
 * scope. This service has no data tools at all, so there is no scope to get
 * wrong — a parent asking "how are results published" is reading the same
 * public documentation a student reads.
 *
 * Each service gates on its own list, so adding a role here does not reach
 * /api/assistant or /api/analytics.
 */
const CHATBOT_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.TEACHER,
    ROLES.STUDENT,
    ROLES.PARENT
];

const config = {

    roles: CHATBOT_ROLES,

    groq: {
        apiKeys: groq.apiKeys,

        // CHATBOT_MODEL pins this service alone; see config/groq.js.
        model: groq.modelFor(process.env.CHATBOT_MODEL),

        // Explaining a policy reads badly at zero.
        temperature: 0.3,
        maxTokens: 1024,
        timeoutMs: 30000
    },

    /*
     * Retrieval happens once, before the model is called, rather than as a
     * tool the model may choose to invoke.
     *
     * A tool call costs a whole extra round trip — the model asks, we answer,
     * the model reads. Since a chatbot question is nearly always a corpus
     * question, retrieving up front and putting the passages in the prompt
     * gets the same answer in one call instead of two, and removes the case
     * where the model decides not to search and answers from memory instead.
     */
    retrieval: {

        /*
         * Ten, not five.
         *
         * The corpus is heading-chunked, and the measured chunk sizes are
         * small: a median of 248 characters and a maximum of 1,067 across 190
         * chunks. Five of those is roughly 1,200 characters of context for a
         * question about a system with a dozen modules, which is why so many
         * answers came back as "not in the AIMS documentation" while the
         * answer sat in the sixth hit.
         *
         * The instinct is to make the chunks smaller to raise precision. That
         * was measured and rejected: at a 248-character median they are
         * already at roughly one heading per idea, and splitting further cuts
         * a procedure away from the sentence that qualifies it. The lever that
         * actually works on a corpus this shape is retrieving MORE of these
         * small chunks, then re-ranking by audience.
         *
         * MEASURED COST, not the theoretical ceiling. Across a sample of five
         * typical student questions, the passage block went from ~345 tokens
         * to ~723 - roughly double. The theoretical worst case (ten passages
         * truncated at 700 characters) never occurs, because the chunks are
         * far smaller than the cap.
         *
         * That doubling is the price and it is worth stating plainly rather
         * than dressing up: ~380 extra prompt tokens per turn buys ten chances
         * to contain the answer instead of five. Total prompt cost measured at
         * ~1,680 tokens per turn including the role block and system prompt,
         * against a 1,024-token reply budget.
         */
        topK: Number(process.env.CHATBOT_TOP_K || 10),

        /*
         * Passages below this similarity are dropped rather than padded in.
         * A weak passage does not help the model and actively invites it to
         * build an answer out of something only loosely related.
         *
         * Lowered from 0.35 to 0.30, which is a smaller change than it looks.
         * all-MiniLM-L6-v2 scores a correct short answer against a
         * conversationally-phrased question in the low 0.3s surprisingly
         * often - a student typing "how i can mark the attendence of myself"
         * carries a typo, no punctuation and an unusual framing, and lands
         * below 0.35 against a chunk that answers it exactly.
         *
         * The floor is still doing its job at 0.30: it is the difference
         * between "no match" and "here are the three least-irrelevant chunks
         * in the corpus", and the audience re-rank in the orchestrator sorts
         * what survives. It is the topK increase that makes lowering this
         * safe - a marginal passage now competes with nine others rather than
         * taking one of five seats.
         */
        minScore: Number(process.env.CHATBOT_MIN_SCORE || 0.30),

        /*
         * 700, down from 1,200.
         *
         * This is the one place the brief's "reduce the chunk length" is
         * genuinely right, and it is a truncation limit rather than a chunk
         * size: it caps how much of a long passage reaches the prompt. At the
         * measured p75 of 353 characters it truncates almost nothing, so in
         * practice it only bites on the handful of chunks near the 1,067
         * maximum - which are exactly the ones where the tail is context
         * rather than answer.
         *
         * Halving it is what pays for doubling topK.
         */
        maxCharsPerPassage: Number(process.env.CHATBOT_MAX_PASSAGE_CHARS || 700)
    },

    /*
     * Shorter than the old assistant's 12. History was the single largest
     * token cost in the previous design — 24 messages resent on every round of
     * every turn, around 4,800 tokens. A support chat rarely needs more than a
     * few turns of context to resolve a follow-up pronoun.
     */
    historyTurns: Number(process.env.CHATBOT_HISTORY_TURNS || 4),

    enabled: process.env.CHATBOT_ENABLED !== "false"
};

module.exports = { ...config, CHATBOT_ROLES };
