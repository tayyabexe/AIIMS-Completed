/*
 * Groq chat-completions client.
 *
 * Written against fetch rather than pulling in a provider SDK: the surface
 * used here is one POST with a JSON body, and Node 18+ has fetch built in.
 * An SDK would add a dependency, its transitive tree, and a version to keep
 * current, in exchange for wrapping a single endpoint.
 *
 * The API key is read from the environment on the server. It is never sent to
 * the browser, never stored in a database row, and never echoed in an error
 * message — the previous chatbot asked each user to paste their own key into
 * a settings panel in the frontend, which put a credential in localStorage on
 * every machine that used it.
 */

const config = require("../../config/assistant");

/*
 * Failures worth retrying: transient network trouble, rate limiting, and 5xx.
 * A 400 means the request was malformed and will be malformed again, so it is
 * returned immediately rather than retried three times slowly.
 */
const isRetryable = (status) =>
    status === 429 || status === 408 || (status >= 500 && status < 600);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- key pool ---
 *
 * Several API keys, used in turn.
 *
 * Groq's free tier caps tokens per day per key, and one key was exhausted in a
 * single afternoon of testing. Two effects follow from holding more than one:
 * the daily budget multiplies, and an exhausted key stops being an outage —
 * it is set aside and the next one is used.
 *
 * Round-robin rather than always-use-the-first, so the keys drain evenly.
 * Draining one to zero before touching the second would mean every request in
 * between paying the retry cost of hitting a dead key first.
 *
 * State is per process. A restart forgets which keys were cooling off, which
 * is acceptable: the first request to a still-exhausted key rediscovers it in
 * one round trip and sets it aside again.
 */
const keys = config.groq.apiKeys.map((key) => ({
    key,

    // A short suffix is enough to tell keys apart in a log without printing a
    // credential anywhere.
    label: `…${key.slice(-6)}`,

    // Epoch ms until which this key is considered unusable.
    cooldownUntil: 0,

    requests: 0,
    rateLimitHits: 0
}));

let cursor = 0;

/*
 * How long a rest is worth waiting out inside a request rather than failing.
 *
 * Groq's per-minute token window clears in seconds; its per-day one does not
 * clear today. 20 seconds is above the longest short-window rest observed in
 * practice (~10s) and well below anything a person would rather be told about
 * than wait for.
 */
const SHORT_REST_MS = 20000;

const isAvailable = (entry) => entry.cooldownUntil <= Date.now();

/**
 * The next usable key, or null when every key is cooling off.
 *
 * Advances the cursor on every call so consecutive requests spread across the
 * pool.
 */
const nextKey = () => {

    for (let i = 0; i < keys.length; i++) {
        const entry = keys[(cursor + i) % keys.length];

        if (isAvailable(entry)) {
            cursor = (cursor + i + 1) % keys.length;
            entry.requests += 1;
            return entry;
        }
    }

    return null;
};

/**
 * Sets a key aside after a rate-limit response.
 *
 * A per-minute limit clears in seconds; a per-day limit does not clear until
 * tomorrow. The provider states which in the error text, so the cooldown comes
 * from what it said rather than from a fixed guess — parking a key for an hour
 * because it hit a 7-second window would waste most of its budget.
 */
const cooldown = (entry, detail, retryAfterHeader) => {

    entry.rateLimitHits += 1;

    const daily = /tokens per day|TPD/i.test(detail);

    const stated = Number(retryAfterHeader)
        || Number((detail.match(/try again in ([\d.]+)s/i) || [])[1])
        || Number((detail.match(/try again in (\d+)m/i) || [])[1]) * 60;

    // A daily exhaustion is capped at an hour rather than the stated many
    // hours: the key is retried periodically in case the window rolled over,
    // and an hour of not trying costs nothing when other keys are working.
    const seconds = daily
        ? Math.min(stated || 3600, 3600)
        : Math.min(stated || 30, 120);

    entry.cooldownUntil = Date.now() + seconds * 1000;

    console.warn(
        `[assistant] Groq key ${entry.label} rate-limited ` +
        `(${daily ? "daily" : "short-window"}); resting ${Math.round(seconds)}s. ` +
        `${keys.filter(isAvailable).length}/${keys.length} keys available.`
    );
};

/** Pool state, for the health endpoint. Never exposes a key. */
const keyStatus = () => keys.map((entry) => ({
    key: entry.label,
    available: isAvailable(entry),
    cooling_for_seconds: isAvailable(entry)
        ? 0
        : Math.ceil((entry.cooldownUntil - Date.now()) / 1000),
    requests: entry.requests,
    rate_limit_hits: entry.rateLimitHits
}));

/**
 * One chat-completions call.
 *
 * @param {Array}  messages  chat messages, provider format
 * @param {Object} options   { model, tools, toolChoice, temperature, maxTokens, signal }
 * @returns {Promise<Object>} the assistant message, plus usage
 *
 * `options.model` lets a caller pick a different model on the same key pool.
 * The analytics planner uses it: both services share these keys and this
 * rotation logic, but they do very different work and should not be pinned to
 * one model by accident. Omitted, it stays on the assistant's configured
 * model, so every existing caller is unaffected.
 */
const complete = async (messages, options = {}) => {

    if (!keys.length) {
        throw new Error("No Groq API key is configured");
    }

    const body = {
        model: options.model || config.groq.model,
        messages,
        temperature: options.temperature ?? config.groq.temperature,
        max_tokens: options.maxTokens ?? config.groq.maxTokens
    };

    /*
     * gpt-oss models emit a hidden reasoning pass before their answer, billed
     * as completion tokens. Left at the default it consumed 406 of a 700-token
     * budget on a planner call and truncated the JSON to nothing; at "low" the
     * same call reasons in 11. Planning which tool to run is a classification,
     * not a proof, so there is nothing here for deep reasoning to improve.
     *
     * Only sent when a caller asks, so models that reject the parameter are
     * unaffected.
     */
    if (options.reasoningEffort) {
        body.reasoning_effort = options.reasoningEffort;
    }

    if (options.tools && options.tools.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice || "auto";
    }

    let lastError;

    /*
     * One extra attempt per additional key, so a pool of two keys can have the
     * first rate-limited and still answer on the second within the same call.
     */
    const maxAttempts = config.groq.maxRetries + keys.length;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {

        let entry = nextKey();

        if (!entry) {
            /*
             * Every key is resting. Whether that is worth waiting out depends
             * entirely on how long.
             *
             * Groq's per-minute token window clears in seconds — the live logs
             * showed keys resting for 7 and 10 seconds — and failing a user's
             * question rather than pausing that long is the wrong trade: they
             * got a 500 for something that would have succeeded almost
             * immediately. A daily exhaustion is different; no amount of
             * waiting inside one request fixes it.
             *
             * So: wait out a short rest, surrender on a long one.
             */
            const soonest = Math.min(...keys.map((k) => k.cooldownUntil));
            const waitMs = soonest - Date.now();

            if (waitMs > 0 && waitMs <= SHORT_REST_MS && attempt < maxAttempts) {
                await wait(waitMs + 250);
                entry = nextKey();
            }

            if (!entry) {
                const seconds = Math.max(1, Math.ceil((soonest - Date.now()) / 1000));

                const failure = new Error(
                    seconds > 90
                        ? `The assistant has reached its usage limit. Please try again in ` +
                          `about ${Math.ceil(seconds / 60)} minute${seconds > 90 ? "s" : ""}.`
                        : `The assistant is busy right now. Please try again in ` +
                          `${seconds} second${seconds === 1 ? "" : "s"}.`
                );

                // Lets the controller answer 503 with an accurate Retry-After
                // instead of a 500 that implies something is broken.
                failure.retryAfterSeconds = seconds;
                failure.capacity = true;

                throw failure;
            }
        }


        /*
         * A per-attempt timeout, combined with any caller abort signal. Without
         * this a stalled upstream holds the user's request open until the HTTP
         * server times it out, and the user watches a spinner for a minute.
         */
        const timer = new AbortController();
        const timeout = setTimeout(() => timer.abort(), config.groq.timeoutMs);

        if (options.signal) {
            options.signal.addEventListener("abort", () => timer.abort(), { once: true });
        }

        try {

            const response = await fetch(`${config.groq.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${entry.key}`
                },
                body: JSON.stringify(body),
                signal: timer.signal
            });

            if (!response.ok) {

                const detail = await response.text().catch(() => "");

                /*
                 * A rate-limited key is set aside immediately and the loop
                 * continues, which picks up the next key on the very next
                 * attempt. With a healthy second key that is a retry with no
                 * wait at all, rather than sleeping out a limit that only
                 * applied to the key just used.
                 */
                if (response.status === 429) {

                    cooldown(entry, detail, response.headers.get("retry-after"));

                    if (keys.some(isAvailable) && attempt < maxAttempts) {
                        lastError = new Error("Groq 429");
                        continue;
                    }
                }

                if (isRetryable(response.status) && attempt < maxAttempts) {

                    /*
                     * Honour the provider's own backoff rather than guessing.
                     *
                     * Groq's free tier is capped on tokens per minute, and a
                     * request carrying the admin tool set is large enough to
                     * hit it. When it does, the reply says exactly how long to
                     * wait — "try again in 21.81s" — and blind exponential
                     * backoff of half a second simply burns the remaining
                     * retries against a window that has not moved.
                     *
                     * Retry-After is preferred; the wait embedded in the error
                     * message is the fallback, because Groq does not always
                     * send the header.
                     */
                    const headerWait = Number(response.headers.get("retry-after"));

                    const messageWait = Number(
                        (detail.match(/try again in ([\d.]+)s/i) || [])[1]
                    );

                    const suggested = Number.isFinite(headerWait) && headerWait > 0
                        ? headerWait * 1000
                        : Number.isFinite(messageWait) && messageWait > 0
                            ? messageWait * 1000
                            : 500 * 2 ** attempt;

                    // Capped so a long stated wait cannot hold the user's
                    // request open past the point they would rather be told
                    // to try again themselves.
                    await wait(Math.min(suggested + 250, 25000));

                    lastError = new Error(`Groq ${response.status}`);
                    continue;
                }

                /*
                 * The provider's body can echo request content. It is logged
                 * for diagnosis but not put into the thrown message, which
                 * travels back toward the user.
                 */
                console.error(`[assistant] Groq ${response.status}:`, detail.slice(0, 500));

                /*
                 * `tool_use_failed` means the model produced a tool call whose
                 * arguments do not match the schema — a registration number in
                 * an integer field, an enum value that is not in the enum. The
                 * provider rejects the whole completion, so there is no message
                 * to feed back and correct.
                 *
                 * It is flagged rather than described, so the orchestrator can
                 * recover by asking again without tools instead of failing the
                 * user's turn over the model's formatting mistake.
                 */
                if (/tool_use_failed/.test(detail)) {
                    const failure = new Error(
                        "The assistant could not format that lookup correctly."
                    );
                    failure.toolUseFailed = true;
                    throw failure;
                }

                if (response.status === 429) {

                    // Every key is spent. Report the shortest rest so the
                    // caller can send an accurate Retry-After rather than a
                    // vague "in a moment".
                    const soonest = Math.min(...keys.map((k) => k.cooldownUntil));
                    const seconds = Math.max(1, Math.ceil((soonest - Date.now()) / 1000));

                    const failure = new Error(
                        seconds > 90
                            ? `The assistant has reached its usage limit. Please try ` +
                              `again in about ${Math.ceil(seconds / 60)} minutes.`
                            : `The assistant is busy right now. Please try again in ` +
                              `${seconds} second${seconds === 1 ? "" : "s"}.`
                    );

                    failure.retryAfterSeconds = seconds;
                    failure.capacity = true;

                    throw failure;
                }

                throw new Error(
                    response.status === 401
                        ? "The assistant's API credentials were rejected."
                        : `The assistant service returned an error (${response.status}).`
                );
            }

            const payload = await response.json();
            const choice = payload.choices?.[0];

            if (!choice) {
                throw new Error("The assistant service returned an empty response.");
            }

            return {
                message: choice.message,
                finishReason: choice.finish_reason,
                usage: payload.usage || null
            };

        } catch (error) {

            // A caller-initiated abort is not a failure to retry — the user
            // navigated away or sent a new message.
            if (options.signal?.aborted) throw error;

            const timedOut = error.name === "AbortError";

            if (attempt < maxAttempts) {
                lastError = error;
                await wait(Math.min(500 * 2 ** attempt, 4000));
                continue;
            }

            throw timedOut
                ? new Error("The assistant took too long to respond. Try again.")
                : error;

        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError || new Error("The assistant service is unavailable.");
};

/** Cheap liveness check for the health endpoint. */
const ping = async () => {
    try {
        await complete(
            [{ role: "user", content: "ok" }],
            { maxTokens: 1, temperature: 0 }
        );
        return { ok: true };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
};

module.exports = { complete, ping, keyStatus };
