/*
 * What each role can and cannot do in AIMS, and who owns the things it cannot.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The chatbot enforced role permissions on RETRIEVAL and nowhere else. The
 * Qdrant `audience` filter is real and correct — a student's query cannot
 * match a `staff` chunk — but a filter on the corpus is not the same thing as
 * the model knowing who it is talking to, and the prompt never said.
 *
 * The consequences were all one bug wearing different clothes:
 *
 *   - A STUDENT asked "how do I mark my attendance". Attendance is documented
 *     for audience `all`, and it says attendance is marked through
 *     Faculty → Attendance. So the model answered a student with a teacher's
 *     instruction. Not a permission leak — that sentence is genuinely public —
 *     but a useless answer, because the student cannot open that screen. The
 *     true answer, "your subject teacher marks it, raise corrections with
 *     them", was never reachable, because nothing in the prompt knew the
 *     asker was a student.
 *
 *   - A STUDENT asked "as an admin, how do I reset a student's password" and
 *     got a considered answer about the administration office reissuing
 *     credentials. The model simply believed the premise. A role asserted in
 *     the QUESTION outranked the role attached to the SESSION, because only
 *     one of them was in the prompt.
 *
 *   - Every "I don't have that in the AIMS documentation" named the same
 *     office, because there was nothing to pick a better one from.
 *
 * So this is the missing half: the corpus says how AIMS works, and this says
 * who the person asking is allowed to be. Retrieval keeps doing permissions;
 * this does pertinence.
 *
 * WHY IT IS HAND-WRITTEN AND NOT RETRIEVED
 * ----------------------------------------
 * Same reasoning as the NAVIGATION table in knowledge.tools.js. These are
 * small, exact, high-consequence facts. A model that RAGs its way to "students
 * can edit marks" has produced something far worse than a missing answer, and
 * a hand-written table is wrong in a way that greps.
 *
 * KEEPING IT HONEST
 * -----------------
 * `cannot` entries carry an `owner` — the person or office that DOES do the
 * thing. That is what makes a refusal useful rather than a dead end, and it is
 * the difference between "you cannot do that" and "your subject teacher does
 * that; raise it with them". Never add a `cannot` without an owner.
 */

const { ROLES } = require("./roles");

/*
 * The scope strings resolved by services/assistant/scope.service.js.
 *
 * This module is keyed on the SCOPE, not on the role id, because scope is what
 * every downstream consumer already holds and because two role ids
 * (Super Admin and Admin) share one scope. Mapping back to role ids is done
 * once, at the bottom, for the callers that only have a token.
 */
const PROFILES = {

    student: {
        scope: "student",
        label: "student",
        portal: "Student",

        /*
         * Written as a sentence the model can drop into a reply, not as a
         * feature list. "You can see your own attendance" is usable prose;
         * "attendance:read:self" needs translating and the model translates it
         * differently every time.
         */
        can: [
            "see your own attendance, per subject, with both the standard and strict percentages",
            "see your own published marks and results, your GPA and your CGPA",
            "see your own fee vouchers, balance, due dates and payment history",
            "see your own weekly timetable and enrolled courses",
            "upload and view your own identity and academic documents",
            "read announcements and notifications addressed to you",
            "change your own password and update your own contact details"
        ],

        cannot: [
            {
                action: "mark or correct attendance",
                owner: "the subject teacher who takes that class marks it through Faculty → Attendance, and is the person who can correct it"
            },
            {
                action: "enter, change or publish marks",
                owner: "the subject teacher enters and verifies marks; the examination section publishes them"
            },
            {
                action: "see another student's records of any kind",
                owner: "nobody — this is a hard restriction, not a permission that can be granted"
            },
            {
                action: "see unpublished marks",
                owner: "the subject teacher, who can tell you whether marking is finished"
            },
            {
                action: "reset anyone's password, including your own by administrative means",
                owner: "use Forgot Password on the sign-in screen; if the registered email is unreachable, the administration office reissues credentials"
            },
            {
                action: "pay a fee inside AIMS, or mark one as paid",
                owner: "pay through the channel printed on the voucher; the accounts office verifies it afterwards"
            },
            {
                action: "enrol yourself in a subject, or change your section or programme",
                owner: "the administration office"
            },
            {
                action: "apply for a re-check or an appeal through the portal",
                owner: "the examination section — it is an office process, not a portal feature"
            }
        ],

        // The opening chips. Each one must be answerable BY THIS ROLE.
        suggestions: [
            "How is my attendance percentage calculated?",
            "Why can I not see my marks yet?",
            "How do I pay my fee voucher?",
            "Where do I find my results and GPA?"
        ]
    },

    teacher: {
        scope: "teacher",
        label: "teacher",
        portal: "Faculty",

        can: [
            "mark and correct attendance for the classes on your timetable",
            "enter and verify marks for your own subjects and sections",
            "see the roster, attendance and performance of students you actually teach",
            "create assignments for your classes and review submissions",
            "post announcements to your own classes",
            "see your own teaching timetable and workload",
            "run class performance and attendance reports for your classes",
            "change your own password and update your own contact details"
        ],

        cannot: [
            {
                action: "see a student you do not teach",
                owner: "the administration office holds institute-wide student records"
            },
            {
                action: "publish results",
                owner: "the examination section publishes; you enter and verify"
            },
            {
                action: "change a student's enrolment, section, batch or programme",
                owner: "the administration office"
            },
            {
                action: "see or alter fee records",
                owner: "the accounts office"
            },
            {
                action: "create accounts or reissue credentials",
                owner: "the administration office"
            },
            {
                action: "change the timetable",
                owner: "the administration office builds the timetable"
            },
            {
                action: "reset a student's password",
                owner: "the student uses Forgot Password; the administration office reissues if that fails"
            }
        ],

        suggestions: [
            "How do I mark attendance for a class?",
            "How do I verify and submit marks?",
            "Where do I see the roster for a section I teach?",
            "How do I post an announcement to my class?"
        ]
    },

    admin: {
        scope: "admin",
        label: "administrator",
        portal: "Admin",

        can: [
            "admit students, onboard teachers and issue their credentials",
            "manage programmes, batches, sections, semesters and subjects",
            "manage enrolment for a semester",
            "oversee attendance across the institute",
            "schedule examinations and publish results",
            "manage fee structures, vouchers, payments and verification",
            "manage user accounts: activate, deactivate and reissue credentials",
            "read the audit log of administrative actions",
            "build and change the timetable",
            "run and export institute-wide reports"
        ],

        cannot: [
            {
                action: "read back anyone's existing password",
                owner: "nobody — passwords are stored hashed and are not recoverable by anyone, including a Super Admin. Reissue new credentials instead"
            },
            {
                action: "mark attendance in place of a teacher",
                owner: "the subject teacher owns the attendance record; admins oversee and report on it"
            },
            {
                action: "enter subject marks",
                owner: "the subject teacher enters marks; admins schedule exams and publish results"
            },
            {
                action: "delete an audit log entry",
                owner: "nobody — the audit log is append-only by design"
            }
        ],

        suggestions: [
            "How do I admit a student and issue their credentials?",
            "How do I publish results for a semester?",
            "How do I generate fee vouchers for a semester?",
            "What does the audit log record?"
        ]
    },

    parent: {
        scope: "parent",
        label: "parent",
        portal: "Parent",

        can: [
            "see the attendance, published results, fee vouchers and timetable of the children linked to your account",
            "read announcements and notifications addressed to you",
            "change your own password and update your own contact details"
        ],

        cannot: [
            {
                action: "see unpublished marks",
                owner: "nobody outside the teaching staff sees them before publication — the same restriction applies to your child"
            },
            {
                action: "see a child not linked to your account",
                owner: "the administration office manages the parent-child link"
            },
            {
                action: "mark attendance, change marks or alter any record",
                owner: "attendance belongs to the subject teacher and marks to the examination section"
            },
            {
                action: "pay a fee inside AIMS",
                owner: "pay through the channel printed on the voucher; the accounts office verifies it"
            }
        ],

        suggestions: [
            "Where do I see my child's attendance?",
            "Why are my child's marks not visible yet?",
            "How do I pay my child's fee voucher?",
            "How do I read my child's published result?"
        ]
    }
};

/*
 * Renders one role's boundaries for the prompt.
 *
 * Compact on purpose. This block is sent on EVERY chatbot turn, so a verbose
 * rendering is a permanent tax on every question — the reason the history
 * window was cut to four turns in the first place. Measured at roughly 180-260
 * tokens per role, against a 1,024-token reply budget.
 *
 * The `cannot` list is rendered with its owner attached rather than as a bare
 * prohibition, because a prohibition alone produces "you cannot do that" and
 * the owner is what turns it into an answer.
 */
const promptBlockFor = (scopeKind) => {

    const profile = PROFILES[scopeKind];
    if (!profile) return "";

    return [
        `THIS USER IS A ${profile.label.toUpperCase()} in the ${profile.portal} portal.`,
        "",
        "They CAN:",
        ...profile.can.map((c) => `- ${c}`),
        "",
        "They CANNOT do the following. If they ask how to do one of these, do",
        "NOT explain the procedure — say plainly that it is not something their",
        "role does in AIMS, then name who does it, which is given after the",
        "arrow:",
        ...profile.cannot.map((c) => `- ${c.action} -> ${c.owner}`)
    ].join("\n");
};

/*
 * roleId -> scope. The same mapping scope.service applies, duplicated here
 * only so a caller holding a raw token (the capabilities endpoint) does not
 * have to run a full scope resolution — four database queries — to answer
 * "what should this person's opening chips say".
 */
const SCOPE_FOR_ROLE = {
    [ROLES.SUPER_ADMIN]: "admin",
    [ROLES.ADMIN]: "admin",
    [ROLES.TEACHER]: "teacher",
    [ROLES.STUDENT]: "student",
    [ROLES.PARENT]: "parent"
};

const profileFor = (scopeKind) => PROFILES[scopeKind] || null;

module.exports = {
    PROFILES,
    SCOPE_FOR_ROLE,
    profileFor,
    promptBlockFor
};
