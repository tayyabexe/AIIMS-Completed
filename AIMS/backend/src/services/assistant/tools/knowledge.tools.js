/*
 * Documentation and navigation tools.
 *
 * These answer "how do I" rather than "what is my", so nothing here reads a
 * student record and nothing here needs a scope filter. What they do need is
 * to be honest about not knowing: a question the corpus does not cover must
 * produce "that is not documented", never a plausible invention. An invented
 * fee deadline or an invented transcript procedure is worse than no answer,
 * because the user has no way to tell it apart from a real one.
 */

const config = require("../../../config/assistant");

/*
 * The vector store is required lazily, inside the call.
 *
 * Qdrant runs in a local Docker container that may simply not be up — during
 * development, on a fresh clone, or because someone rebooted. Requiring it at
 * module load would take the whole assistant down with it, when in fact every
 * database tool still works perfectly well without it. Loaded here, an absent
 * Qdrant costs exactly one tool.
 */
const loadVectorStore = () => {
    try {
        return require("../rag/vectorStore");
    } catch {
        return null;
    }
};

/*
 * Where things live in each portal.
 *
 * Deliberately hardcoded rather than retrieved. Navigation is a small, exact,
 * frequently-asked fact set, and RAG over it would introduce the possibility
 * of confidently directing someone to a screen that does not exist. If a route
 * moves, this table is wrong in an obvious, greppable way.
 *
 * Kept in step with frontend/src/pages/{admin,faculty,student}.
 */
const NAVIGATION = {
    student: [
        ["Dashboard", "/student", "Overall summary: attendance, upcoming classes, notices"],
        ["My Courses", "/student/courses", "Enrolled subjects and per-course detail"],
        ["Attendance", "/student/attendance", "Attendance per subject, with percentages"],
        ["Timetable", "/student/timetable", "Weekly class schedule"],
        ["Results", "/student/results", "Published semester results, GPA and CGPA"],
        ["Fees", "/student/fees", "Vouchers, balance and payment history"],
        ["Documents", "/student/documents", "Uploaded identity and academic documents"],
        ["Notifications", "/student/notifications", "Alerts about fees, results and attendance"],
        ["Profile", "/student/profile", "Personal details and password change"]
    ],
    teacher: [
        ["Dashboard", "/faculty", "Teaching summary and pending tasks"],
        ["My Classes", "/faculty/classes", "Every subject and section assigned to you"],
        ["Attendance", "/faculty/attendance", "Mark and review class attendance"],
        ["Marks", "/faculty/marks", "Enter and verify exam marks; the examination section publishes them"],
        ["Assignments", "/faculty/assignments", "Assignment setup and submissions"],
        ["Students", "/faculty/students", "Roster for the classes you teach"],
        ["Timetable", "/faculty/timetable", "Your weekly teaching schedule"],
        ["Reports", "/faculty/reports", "Class performance and attendance reports"],
        ["Announcements", "/faculty/announcements", "Post notices to your classes"],
        ["Profile", "/faculty/profile", "Your staff profile and settings"]
    ],
    /*
     * Kept in step with frontend/src/pages/parent. Seven views, no marks
     * entry and no fee payment — a parent reads, and pays through the same
     * voucher channel the student uses.
     */
    parent: [
        ["Dashboard", "/parent", "Summary for each child you are linked to"],
        ["Attendance", "/parent/attendance", "Your child's attendance per subject"],
        ["Results", "/parent/results", "Published results, GPA and CGPA"],
        ["Fees", "/parent/fees", "Vouchers, balance and payment history"],
        ["Timetable", "/parent/timetable", "Your child's weekly class schedule"],
        ["Notifications", "/parent/notifications", "Alerts about fees, results and attendance"],
        ["Profile", "/parent/profile", "Your details and password change"]
    ],
    admin: [
        ["Dashboard", "/admin", "Institute-wide KPIs"],
        ["Students", "/admin/students", "Admissions, records and credential reissue"],
        ["Teachers", "/admin/teachers", "Onboarding and staff records"],
        ["Academics", "/admin/academics", "Programmes, batches, sections, semesters, subjects"],
        ["Enrollment", "/admin/enrollment", "Subject enrolment per semester"],
        ["Attendance", "/admin/attendance", "Institute-wide attendance oversight"],
        ["Examination", "/admin/examination", "Exam scheduling and result publication"],
        ["Fees", "/admin/fees", "Fee structures, vouchers, payments and verification"],
        ["Reports", "/admin/reports", "Exportable operational reports"],
        ["Audit Logs", "/admin/audit-logs", "Record of administrative actions"],
        ["Settings", "/admin/settings", "System configuration"]
    ]
};

const tools = {

    search_aims_knowledge: {
        description:
            "Search the official AIMS documentation for policies and " +
            "procedures - admissions, examinations, grading, fee rules, " +
            "credentials, portal workflows. Use for any 'how do I' or 'what " +
            "is the policy on' question. Do not answer such questions from " +
            "memory; if this returns nothing, say the information could not " +
            "be verified.",
        roles: ["student", "teacher", "admin"],
        parameters: {
            type: "object",
            properties: {
                question: {
                    type: "string",
                    description:
                        "The user's question, in their own words. Passed to " +
                        "semantic search, so full sentences work better than " +
                        "keywords."
                }
            },
            required: ["question"]
        },

        run: async (scope, args) => {

            const question = String(args?.question || "").trim();

            if (question.length < 3) {
                return {
                    type: "refused",
                    message: "Give a fuller question to search for."
                };
            }

            const vectorStore = loadVectorStore();

            if (!vectorStore) {
                return {
                    type: "error",
                    message:
                        "The documentation index is not available right now, so " +
                        "this cannot be answered from official documentation. " +
                        "Say so rather than answering from general knowledge."
                };
            }

            try {

                /*
                 * The audience tag is a filter, not a ranking signal. Some
                 * documentation is staff-facing — how to reissue credentials,
                 * how marks are verified before publication — and a student
                 * must not receive it merely because it scored well.
                 */
                const hits = await vectorStore.search(question, {
                    topK: config.rag.topK,
                    minScore: config.rag.minScore,
                    audience: scope.kind
                });

                if (!hits.length) {
                    return {
                        type: "knowledge",
                        rows: [],
                        message:
                            "Nothing in the official AIMS documentation covers " +
                            "this. Tell the user it could not be verified rather " +
                            "than answering from general knowledge."
                    };
                }

                return {
                    type: "knowledge",
                    rows: hits.map((hit) => ({
                        source: hit.source,
                        section: hit.section,
                        score: Number(hit.score.toFixed(3)),
                        content: hit.content
                    }))
                };

            } catch (error) {

                console.error("[assistant] knowledge search failed:", error.message);

                return {
                    type: "error",
                    message:
                        "The documentation index could not be reached. Do not " +
                        "answer the question from general knowledge; say it " +
                        "could not be looked up."
                };
            }
        }
    },

    get_portal_navigation: {
        description:
            "Where to find a feature in the portal the user is signed in to - " +
            "the screen name and its route. Use for 'where do I see my " +
            "results' or 'how do I mark attendance'.",
        roles: ["student", "teacher", "admin"],
        parameters: {
            type: "object",
            properties: {
                looking_for: {
                    type: "string",
                    description:
                        "Optional keyword, e.g. 'fees' or 'marks', to narrow " +
                        "the list."
                }
            }
        },

        run: async (scope, args) => {

            // Always the caller's own portal. A student asking where marks are
            // entered is asking about their portal, not the faculty one.
            const screens = NAVIGATION[scope.kind] || [];
            const term = String(args?.looking_for || "").trim().toLowerCase();

            const matched = term
                ? screens.filter(([name, route, purpose]) =>
                    name.toLowerCase().includes(term)
                    || route.toLowerCase().includes(term)
                    || purpose.toLowerCase().includes(term))
                : screens;

            return {
                type: "table",
                rows: (matched.length ? matched : screens).map(
                    ([screen, route, purpose]) => ({ screen, route, purpose })
                )
            };
        }
    }
};

module.exports = { tools, NAVIGATION };
