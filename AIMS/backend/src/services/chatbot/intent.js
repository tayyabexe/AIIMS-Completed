/*
 * What kind of question this is, decided BEFORE retrieval runs.
 *
 * WHY A GATE AT ALL
 * -----------------
 * Every question used to take the same path: retrieve, prompt, answer. Two
 * kinds of question are actively harmed by that path.
 *
 *   - "What can you help me with?" is a question about THIS SERVICE, and the
 *     corpus does not describe this service. Retrieval returns whatever chunk
 *     happens to contain "help", and the model writes a capability list out
 *     of it — different every time, and frequently naming modules the asker's
 *     role has no screen for. See config/assistantCapabilities.js.
 *
 *   - "What's the weather tomorrow?" retrieves nothing, and the empty-passage
 *     instruction then produces "I don't have that in the AIMS
 *     documentation." That sentence is true and useless: it describes a
 *     documentation gap, implying the answer might be added one day, when in
 *     fact the question was never this assistant's to answer. It also spends
 *     a full retrieval and a full model call to say so.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not treat "retrieval found nothing" as "out of scope". Those are
 * different failures with opposite remedies: the first is a hole in the
 * corpus, which someone should fill, and the second is a question that does
 * not belong here at all. Collapsing them would tell a student asking about a
 * genuine but undocumented AIMS procedure that their question was off-topic,
 * and would quietly hide every gap in the knowledge base behind a refusal.
 *
 * So the out-of-scope test never looks at retrieval results. It looks at the
 * question.
 *
 * HOW CONSERVATIVE THIS IS, AND WHY
 * ---------------------------------
 * A false positive here REFUSES a legitimate AIMS question, which is the
 * worst outcome available. So the deterministic rule needs two independent
 * signals to fire: the question must match an off-topic subject AND contain
 * no AIMS vocabulary anywhere. Either one alone is not enough — "is there a
 * cricket match in the timetable" names a sport and is a real question about
 * a real screen.
 *
 * Anything the rules do not settle is returned as `unknown`, which means
 * "carry on exactly as before". A miss costs nothing; only a false positive
 * costs anything, and the shape of the rule is chosen accordingly.
 */

const config = require("../../config/chatbot");
const groq = require("../assistant/groq.client");

/* ------------------------------------------------------- capability ------ */

/*
 * Questions about the ASSISTANT's own coverage.
 *
 * Written as an explicit list of phrasings rather than one clever regex,
 * because each line here is a claim that a particular sentence is a
 * capability question and it should be readable as such. An unmatched
 * phrasing falls through to normal retrieval, which is the old behaviour.
 */
const CAPABILITY_PATTERNS = [
    /\bwhat\s+(?:can|could|may)\s+(?:i|we)\s+ask\b/i,
    /\bwhat\s+(?:can|could)\s+you\s+(?:help|do|answer|tell|assist|explain)/i,
    /\bwhat\s+(?:do|can)\s+you\s+know\b/i,
    /\bwhat\s+(?:else\s+)?can\s+you\s+do\b/i,
    /\bwhat\s+(?:are|is)\s+your\s+(?:capabilit|feature|function|skill|scope|purpose|topic)/i,
    /\bwhat\s+(?:topics?|modules?|features?|areas?|things|subjects?)\b[^?]{0,40}\b(?:can|do)\s+you\b/i,
    /\bwhich\s+[^?]{0,40}\b(?:modules?|features?|topics?|areas?|parts?)\b[^?]{0,30}\b(?:can|do)\s+you\b/i,
    /\bwhat\s+(?:kind|sort|type)s?\s+of\s+(?:questions?|things)\b/i,
    /\bwhat\s+are\s+you\s+(?:for|able\s+to|good\s+at)\b/i,
    /\bhow\s+(?:can|could)\s+you\s+help\b/i,
    /\bwhat\s+(?:do|can)\s+you\s+(?:cover|support)\b/i
];

/*
 * A concrete AIMS noun anywhere in the question disqualifies the capability
 * branch.
 *
 * "What can you tell me about fee vouchers" matches a capability pattern by
 * accident — it is a real question about a real module, and answering it with
 * a menu of modules would be a non-answer. The presence of a specific subject
 * is what separates "what do you cover" from "cover this".
 *
 * "aims" is absent on purpose: "which AIMS modules do you cover" is a
 * capability question and naming the system is not naming a subject.
 */
const SPECIFIC_SUBJECT =
    /\b(attendance|marks?|grades?|gpa|cgpa|results?|exams?|examinations?|fees?|vouchers?|payments?|enroll?ments?|enroll?|admissions?|timetables?|schedules?|assignments?|documents?|uploads?|notifications?|announcements?|passwords?|credentials?|accounts?|reports?|audit|students?|teachers?|classes|sections?|batches|programmes?|programs?|semesters?|subjects?|courses?|rechecks?|appeals?|transcripts?)\b/i;

/* ------------------------------------------------------- out of scope ---- */

/*
 * Subjects that are not AIMS, by any reading.
 *
 * Each entry is a topic someone has plausibly typed into a chat box out of
 * habit — the assistant looks like every other chat box on the internet, and
 * people test it accordingly.
 */
const OFF_TOPIC = [
    // weather
    /\b(weather|forecast|temperature outside|will it rain|humidity|monsoon)\b/i,

    // sport
    /\b(football|cricket|soccer|hockey|tennis|basketball|nba|fifa|world cup|premier league|psl|ipl|scoreboard|who won the (?:match|game|final))\b/i,

    // entertainment and small talk
    /\b(tell me a joke|make me laugh|a joke|riddle|write (?:me )?a (?:poem|song|story|essay)|movie|film|netflix|celebrity|actor|actress|singer)\b/i,

    // programming and general authoring
    /\b(write|build|create|generate|code|program)\b[^?]{0,30}\b(python|javascript|java|c\+\+|html|css|sql script|app|game|website|script|function|algorithm)\b/i,
    /\b(python|javascript|leetcode|regex|stack overflow)\b/i,

    // general knowledge and trivia
    /\b(capital of|population of|who is the (?:president|prime minister|king|queen)|when did .* die|distance between|convert .* to (?:usd|euro|dollars))\b/i,

    // news, markets, life advice
    /\b(stock market|share price|bitcoin|crypto|forex|breaking news|election|horoscope|zodiac)\b/i,
    /\b(recipe|how to cook|restaurant|nearest hospital|medical advice|symptoms of)\b/i,
    /\b(translate .* (?:into|to) \w+|dating advice|relationship advice)\b/i
];

/*
 * Anything that makes a question plausibly about AIMS.
 *
 * Broader than SPECIFIC_SUBJECT on purpose — this list is a VETO on refusing,
 * so it errs towards including a word that might be innocent. "Portal",
 * "login" and "policy" are all here even though none of them is uniquely
 * AIMS: a question containing one of them is a question worth attempting.
 */
const AIMS_VOCAB =
    /\b(aims|portal|dashboard|attendance|marks?|grades?|grading|gpa|cgpa|results?|exams?|examinations?|datesheet|fees?|vouchers?|payments?|dues?|challan|enroll?ments?|enroll?|admissions?|registration|timetables?|classes|classroom|lectures?|assignments?|submissions?|documents?|uploads?|notifications?|announcements?|passwords?|credentials?|login|log ?in|sign ?in|accounts?|profile|reports?|analytics|audit|students?|teachers?|faculty|staff|parents?|guardian|admin|administrator|sections?|batches|programmes?|programs?|departments?|semesters?|subjects?|courses?|syllabus|rechecks?|appeals?|transcripts?|degree|university|institute|campus|policy|policies|procedures?|rules?|deadlines?|screens?|pages?|menus?|tabs?)\b/i;

/**
 * The deterministic verdict on one question.
 *
 * @param {string} question
 * @returns {"capability"|"out_of_scope"|"unknown"}
 */
const classify = (question) => {

    const text = String(question || "").trim();
    if (!text) return "unknown";

    if (!SPECIFIC_SUBJECT.test(text)
        && CAPABILITY_PATTERNS.some((p) => p.test(text))) {
        return "capability";
    }

    if (!AIMS_VOCAB.test(text) && OFF_TOPIC.some((p) => p.test(text))) {
        return "out_of_scope";
    }

    return "unknown";
};

/**
 * Whether a question is worth spending a classifier call on.
 *
 * The model fallback exists for phrasings the topic list does not carry —
 * "who painted the ceiling of the Sistine Chapel" is off-topic and matches
 * none of the patterns above. But it must not run on questions that are
 * plainly AIMS-shaped, because the answer is already known and a call that
 * can only agree is a call worth not making.
 *
 * So: only when the question contains NO AIMS vocabulary at all. That single
 * condition removes essentially every real question, which is what keeps this
 * off the hot path.
 */
const worthClassifying = (question) => !AIMS_VOCAB.test(String(question || ""));

/*
 * The classifier prompt.
 *
 * Two words of output, no explanation, temperature zero. Measured at roughly
 * 140 prompt tokens against the 12,000-per-minute budget — about a twelfth of
 * one ordinary turn, and it only runs when retrieval has already come back
 * empty on a question with no AIMS vocabulary in it.
 *
 * The instruction leans towards IN_SCOPE deliberately. The cost of a wrong
 * IN_SCOPE is the behaviour that shipped for a year — "I don't have that in
 * the AIMS documentation" — while the cost of a wrong OUT_OF_SCOPE is
 * refusing a real question, so the tie is broken towards attempting.
 */
const CLASSIFIER = [
    "You decide whether a question belongs to a university management system's",
    "help assistant. The system is called AIMS and covers attendance, exams,",
    "marks and results, fees, admissions and enrollment, timetables,",
    "assignments, documents, notifications, accounts and passwords, reports,",
    "analytics, institute policies, and navigating the web portal.",
    "",
    "Answer with exactly one word.",
    "",
    "OUT_OF_SCOPE - the question is about something else entirely: weather,",
    "sport, entertainment, general trivia, writing code or creative text,",
    "news, markets, cooking, health, or chit-chat.",
    "",
    "IN_SCOPE - anything a student, parent, teacher or administrator might",
    "plausibly be asking about their university, their studies, their",
    "record-keeping, or this portal. If you are unsure, answer IN_SCOPE."
].join("\n");

/**
 * The model's verdict, used only when the rules above returned `unknown` and
 * retrieval also found nothing.
 *
 * Fails OPEN. A classifier that errors, times out, or answers with something
 * unexpected returns false — meaning "not proven out of scope" — so a Groq
 * outage degrades this to exactly the behaviour that existed before the gate
 * was added, rather than refusing every question it cannot classify.
 *
 * @returns {Promise<boolean>} true only when the model says OUT_OF_SCOPE
 */
const looksOutOfScope = async (question, { signal } = {}) => {

    try {
        const { message } = await groq.complete(
            [
                { role: "system", content: CLASSIFIER },
                { role: "user", content: String(question || "").slice(0, 500) }
            ],
            {
                model: config.groq.model,
                temperature: 0,

                // Enough for one word plus whatever whitespace the model adds.
                maxTokens: 5,
                signal
            }
        );

        return /OUT_OF_SCOPE/i.test(message?.content || "");

    } catch (error) {
        console.warn(`[chatbot] scope classifier skipped: ${error.message}`);
        return false;
    }
};

module.exports = {
    classify,
    worthClassifying,
    looksOutOfScope,

    // Exported for the smoke test, which asserts the two-signal rule directly
    // rather than through a live model call.
    CAPABILITY_PATTERNS,
    OFF_TOPIC,
    AIMS_VOCAB
};
