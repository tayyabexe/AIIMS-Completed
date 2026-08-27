/*
 * Shared Groq settings: the key pool and the default model.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The model name had been written out by hand in three config files and two
 * doc-generator strings. When Groq decommissioned llama-3.3-70b-versatile,
 * four of those were updated and one was not — so a deployment that did not
 * set GROQ_MODEL still asked for a model that no longer exists, and the health
 * check failed with a 404 that looked like an outage.
 *
 * A default that lives in one place cannot rot in only some of them.
 *
 * The API key parsing was triplicated the same way, which is a subtler
 * hazard: three copies of "how do we read the key pool" is three chances for
 * one of them to disagree about whether GROQ_API_KEY is still honoured.
 */

/*
 * The model both services use unless told otherwise.
 *
 * Chosen after Groq retired the Llama 3.x line: of the models still offered,
 * this is the only family that reliably emits well-formed tool calls and
 * strict JSON, which is what the analytics planner depends on. Verify against
 * the live list before changing it — `GET /v1/models` is authoritative, and a
 * name that is merely plausible produces a 404 at request time rather than a
 * startup error.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";

/*
 * Several keys, used in rotation by groq.client.js.
 *
 * GROQ_API_KEYS is the comma-separated pool. GROQ_API_KEY is still read so a
 * single-key deployment keeps working without an edit.
 */
const apiKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

const baseUrl = "https://api.groq.com/openai/v1";

/**
 * The model for one service, honouring its own override first.
 *
 * @param {string} [override] value of that service's *_MODEL variable
 */
const modelFor = (override) => override || process.env.GROQ_MODEL || DEFAULT_MODEL;

module.exports = { DEFAULT_MODEL, apiKeys, baseUrl, modelFor };
