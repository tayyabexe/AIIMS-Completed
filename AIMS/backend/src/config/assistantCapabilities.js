/*
 * What the AIMS help assistant can actually answer, as data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "What can you help me with?" used to go through retrieval like any other
 * question, and that is the one question retrieval is structurally unable to
 * answer. The corpus describes AIMS; it does not describe THIS SERVICE. So a
 * capability question matched whichever chunk happened to contain the words
 * "help" and "assistant" — usually 13-assistant-capabilities.md, sometimes a
 * portal guide — and the model wrote a list out of whatever came back. The
 * list changed between askings, named modules the reader's role cannot touch,
 * and occasionally omitted the ones it can.
 *
 * A capability list is a small, exact, high-consequence fact set, exactly like
 * the NAVIGATION table in knowledge.tools.js and the boundaries in
 * roleProfiles.js. The same rule applies: it is written down, it is returned
 * verbatim, and the model is not asked to reconstruct it.
 *
 * WHAT MAY GO IN HERE
 * -------------------
 * ONLY modules this assistant genuinely serves today. Every entry below is
 * backed by three things that already exist:
 *
 *   1. documentation in docs/knowledge-base that the retriever can reach,
 *   2. a screen in the NAVIGATION table for at least one listed scope, and
 *   3. a matching line in roleProfiles for the roles it is offered to.
 *
 * If a module has no corpus behind it, listing it here promises an answer the
 * retriever cannot produce — which is worse than not listing it, because the
 * user then reads the eventual "not in the documentation" as a malfunction.
 *
 * WHY EACH ENTRY CARRIES `scopes`
 * -------------------------------
 * The same reason the suggestion chips are per-role. Offering "Reports and
 * exports" to a student names something they have no screen for, and offering
 * "AI Analytics" to anyone but an administrator names a page that does not
 * exist in their portal. A capability list that overstates is a list that
 * starts the conversation with a wrong answer.
 */

/*
 * Scope keys are the ones scope.service.resolveFor produces: admin, teacher,
 * student, parent. Spelled out per module rather than inherited, so adding a
 * scope is a deliberate edit and not a side effect of a default.
 */
const ALL = ["admin", "teacher", "student", "parent"];

const MODULES = [
    {
        id: "attendance",
        title: "Attendance",
        summary:
            "How attendance is marked, how the standard and strict percentages "
            + "are calculated, shortage rules, and how a wrong mark is corrected.",
        scopes: ALL
    },
    {
        id: "exams",
        title: "Examinations",
        summary:
            "The six assessment types, how exams are scheduled and where "
            + "their dates appear, and how marks move from draft to "
            + "verified to published.",
        scopes: ALL
    },
    {
        id: "marks",
        title: "Marks and results",
        summary:
            "Marks entry and verification, the grading scale, GPA and CGPA, "
            + "and why marks may not be visible yet.",
        scopes: ALL
    },
    {
        id: "fees",
        title: "Fees",
        summary:
            "Fee structures, vouchers, due dates, how a payment is made and "
            + "verified, and what happens when a voucher is overdue.",
        scopes: ALL
    },
    {
        id: "enrollment",
        title: "Admissions and enrollment",
        summary:
            "Admission, programmes, batches, sections and semesters, subject "
            + "enrolment, and how a section or programme change is requested.",
        scopes: ALL
    },
    {
        id: "timetable",
        title: "Timetables",
        summary:
            "How the weekly timetable is built, where to read it, and how "
            + "classroom and slot clashes are handled.",
        scopes: ALL
    },
    {
        id: "assignments",
        title: "Assignments",
        summary:
            "Setting assignments, submission and deadlines, and how "
            + "submissions are reviewed.",

        // No assignments screen in the Admin or Parent portals; see NAVIGATION.
        scopes: ["teacher", "student"]
    },
    {
        id: "documents",
        title: "Documents and uploads",
        summary:
            "Which identity and academic documents are required, accepted "
            + "formats, and how an upload is reviewed.",

        // Student portal only — the one portal with a Documents screen.
        scopes: ["student"]
    },
    {
        id: "notifications",
        title: "Notifications and announcements",
        summary:
            "What triggers a notification, who receives it, and how class or "
            + "institute announcements are posted.",
        scopes: ALL
    },
    {
        id: "accounts",
        title: "Accounts and credentials",
        summary:
            "Signing in, changing a password, what happens when one is "
            + "forgotten, and how credentials are reissued.",
        scopes: ALL
    },
    {
        id: "reports",
        title: "Reports and exports",
        summary:
            "Which operational reports exist, what each one covers, and how "
            + "they are generated and exported.",

        // Faculty → Reports and Admin → Reports. Neither the student nor the
        // parent portal has a reports screen.
        scopes: ["admin", "teacher"]
    },
    {
        id: "ai-analytics",
        title: "AI Analytics",
        summary:
            "What the AI Analytics page does, the kinds of question it "
            + "answers from live records, and how it differs from this "
            + "assistant.",

        /*
         * Admin only, and deliberately narrower than the backend permits.
         *
         * config/analytics.js admits Super Admin, Admin and Teacher, but the
         * only implemented surface is the Admin dashboard's "ai-ask" tab —
         * there is no AI Analytics screen in the Faculty portal. Listing it
         * for a teacher would name a page they cannot open, which is the exact
         * failure roleProfiles exists to prevent.
         */
        scopes: ["admin"],
        handledBy: "analytics"
    },
    {
        id: "navigation",
        title: "Portal navigation",
        summary:
            "Where a screen lives in your portal and what each one is for. "
            + "Answered from a fixed table of routes, never guessed.",
        scopes: ALL,
        handledBy: "navigation"
    },
    {
        id: "policies",
        title: "AIMS policies and procedures",
        summary:
            "The written rules behind the modules above — eligibility, "
            + "deadlines, approvals, corrections, appeals and re-checks.",
        scopes: ALL
    }
];

/*
 * The one thing this assistant does NOT do, stated alongside what it does.
 *
 * A capability list that omits the boundary invites the next question to be a
 * data question, which then gets redirected — a redirect the user could have
 * been spared by one sentence here.
 */
const LIMITS = {
    student: "I explain how AIMS works. I cannot read your records — your own "
        + "attendance, marks and vouchers are on the screens themselves.",
    parent: "I explain how AIMS works. I cannot read your child's records — "
        + "those are on the screens themselves.",
    teacher: "I explain how AIMS works. I cannot read live records; class "
        + "figures come from your own screens and reports.",
    admin: "I explain how AIMS works. I cannot read live records — counts, "
        + "lists and totals come from the AI Analytics page, which queries the "
        + "database."
};

/**
 * The modules offered to one scope, as plain data.
 *
 * @param {string} scopeKind admin | teacher | student | parent
 * @returns {Array<{id,title,summary,handled_by?}>}
 */
const forScope = (scopeKind) =>
    MODULES
        .filter((m) => m.scopes.includes(scopeKind))
        .map((m) => ({
            id: m.id,
            title: m.title,
            summary: m.summary,
            ...(m.handledBy ? { handled_by: m.handledBy } : {})
        }));

/**
 * The limits sentence for one scope, or the student wording as a floor.
 */
const limitsFor = (scopeKind) => LIMITS[scopeKind] || LIMITS.student;

/**
 * Module titles, lower-cased, for the one-line scope refusal.
 *
 * Built from the same array as everything else so the sentence a user reads
 * when they ask about the weather cannot drift away from the list they get
 * when they ask what this assistant does.
 */
const titlesFor = (scopeKind) =>
    MODULES
        .filter((m) => m.scopes.includes(scopeKind))

        // Lower-cased to sit inside a sentence, with the two acronyms put
        // back: "aims policies" and "ai analytics" read as typos.
        .map((m) => m.title.toLowerCase()
            .replace(/\b(aims|ai)\b/g, (word) => word.toUpperCase()));

module.exports = { MODULES, forScope, limitsFor, titlesFor };
