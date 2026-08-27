/*
 * The audit trail.
 *
 * WHY THIS EXISTS
 * ---------------
 * `audit_logs` was created by the original schema and never written to. The
 * consequence showed up as soon as provisioning landed: an admin can now create
 * a student, their parent, a teacher, and issue every one of those passwords —
 * and nothing recorded which admin did it. The passwords themselves are shown
 * once and hashed, which is right, but "shown once to whom" was unanswerable.
 *
 * WHAT IS RECORDED
 * ----------------
 * Acts, not reads. Creating an account, issuing or reissuing a password,
 * deleting a student, raising a fee voucher, and an accounts officer's decision
 * on a payment a parent declared. A GET leaves no entry: a log that records
 * every page view buries the twelve rows that matter under a hundred thousand
 * that do not.
 *
 * WHAT IS NEVER RECORDED
 * ----------------------
 * Passwords, in any form. `record()` strips any key that looks like a
 * credential from both snapshots before the row is written, so a caller that
 * carelessly passes the provisioning result — which does contain the one-time
 * plaintext password — cannot put it on disk. An audit trail holding
 * credentials is simply a second place to steal them from.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * A failed audit write must never fail the act it was describing. Refusing to
 * admit a student because the log table was locked would be a worse outcome
 * than an incomplete log, so record() swallows its own errors to the console.
 * The reverse — writing the log inside the caller's transaction — would be
 * stricter, but it would also mean a rolled-back admission left no trace of
 * having been attempted, which is the opposite of what an audit trail is for.
 */

const { sequelize } = require("../database/connection");
const AuditLog = require("../models/auditLog.model");

const MODULES = {
    PROVISIONING: "Provisioning",
    FEES: "Fees",
    STUDENTS: "Students",
    USERS: "Users",
    // Departments, programmes, batches, sections, classrooms and semesters.
    // One module rather than six, because they are edited together on one
    // screen and read back as one trail.
    ACADEMICS: "Academics",
    // Teachers and parents: the person records, as distinct from the accounts
    // that PROVISIONING creates for them.
    PEOPLE: "People",
    // Sign-in, sign-out and every route to a new password. Separate from USERS
    // because "who changed this account" and "who used this account" are
    // different questions, and an admin reading the trail after an incident is
    // usually asking only one of them.
    AUTH: "Auth",
    // Exams, marks and published results — the academic record itself, as
    // opposed to the structure it hangs off.
    EXAMS: "Examinations",
    ATTENDANCE: "Attendance"
};

const ACTIONS = {
    STUDENT_ADMITTED: "STUDENT_ADMITTED",
    TEACHER_ONBOARDED: "TEACHER_ONBOARDED",
    CREDENTIALS_REISSUED: "CREDENTIALS_REISSUED",
    PARENT_LINKED: "PARENT_LINKED",
    VOUCHER_ISSUED: "VOUCHER_ISSUED",
    VOUCHER_CANCELLED: "VOUCHER_CANCELLED",
    PAYMENT_RECORDED: "PAYMENT_RECORDED",
    PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
    PAYMENT_REJECTED: "PAYMENT_REJECTED",
    STUDENT_DELETED: "STUDENT_DELETED",
    VOUCHER_UPDATED: "VOUCHER_UPDATED",
    TEACHER_UPDATED: "TEACHER_UPDATED",
    TEACHER_DELETED: "TEACHER_DELETED",
    PARENT_CREATED: "PARENT_CREATED",
    PARENT_UPDATED: "PARENT_UPDATED",
    PARENT_DELETED: "PARENT_DELETED",
    PARENT_CHILD_LINKED: "PARENT_CHILD_LINKED",
    PARENT_CHILD_UNLINKED: "PARENT_CHILD_UNLINKED",
    ADMIN_CREATED: "ADMIN_CREATED",
    ADMIN_UPDATED: "ADMIN_UPDATED",
    ADMIN_DELETED: "ADMIN_DELETED",

    // --- accounts and credentials, across every role ---
    PASSWORD_CHANGED: "PASSWORD_CHANGED",
    PASSWORD_RESET: "PASSWORD_RESET",
    PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
    USER_REGISTERED: "USER_REGISTERED",
    USER_CREATED: "USER_CREATED",
    USER_UPDATED: "USER_UPDATED",
    USER_DELETED: "USER_DELETED",

    // Locked by the system after repeated failed sign-ins; unlocked by an
    // administrator. Two sides of the same incident, and the pair is what an
    // admin reads to answer "how long was this account shut, and who opened
    // it again".
    ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
    ACCOUNT_UNLOCKED: "ACCOUNT_UNLOCKED",

    // --- students ---
    STUDENT_UPDATED: "STUDENT_UPDATED",
    STUDENT_RESTORED: "STUDENT_RESTORED",
    STUDENT_ENROLLED: "STUDENT_ENROLLED",

    // --- fees ---
    FEE_STRUCTURE_CREATED: "FEE_STRUCTURE_CREATED",
    FEE_STRUCTURE_UPDATED: "FEE_STRUCTURE_UPDATED",
    FEE_STRUCTURE_DELETED: "FEE_STRUCTURE_DELETED",
    PAYMENT_UPDATED: "PAYMENT_UPDATED",
    PAYMENT_DELETED: "PAYMENT_DELETED",
    PAYMENT_SUBMITTED: "PAYMENT_SUBMITTED",

    // --- examinations ---
    EXAM_CREATED: "EXAM_CREATED",
    EXAM_UPDATED: "EXAM_UPDATED",
    EXAM_DELETED: "EXAM_DELETED",
    MARKS_ENTERED: "MARKS_ENTERED",
    MARKS_UPDATED: "MARKS_UPDATED",
    MARKS_VERIFIED: "MARKS_VERIFIED",
    RESULT_PUBLISHED: "RESULT_PUBLISHED",

    // --- attendance ---
    ATTENDANCE_MARKED: "ATTENDANCE_MARKED",
    ATTENDANCE_UPDATED: "ATTENDANCE_UPDATED",
    ATTENDANCE_DELETED: "ATTENDANCE_DELETED"
};

/*
 * Anything whose name suggests a credential is removed, at every depth.
 *
 * Matching on the key rather than on a whitelist of known callers is
 * deliberate: a new call site added later inherits the protection without
 * anyone having to remember it.
 */
const SECRET_KEY = /password|passwd|secret|token|hash|otp|pin\b/i;

const scrub = (value, depth = 0) => {
    if (value === null || value === undefined) return value;
    if (depth > 6) return "[too deep]";

    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));

    if (typeof value === "object") {
        const out = {};
        for (const [key, inner] of Object.entries(value)) {
            out[key] = SECRET_KEY.test(key) ? "[redacted]" : scrub(inner, depth + 1);
        }
        return out;
    }

    return value;
};

/**
 * The caller's IP, for the `ip_address` column.
 *
 * Behind a proxy Express reports the proxy unless `trust proxy` is set, so the
 * forwarded header is preferred where one is present. The first entry is the
 * originating client; the rest are the hops.
 */
const ipOf = (req) => {
    if (!req) return null;
    const forwarded = req.headers?.["x-forwarded-for"];
    const raw = (typeof forwarded === "string" && forwarded.split(",")[0].trim())
        || req.ip
        || req.connection?.remoteAddress
        || null;
    return raw ? String(raw).slice(0, 45) : null;
};

/**
 * Writes one entry. Never throws.
 *
 * @param {object} entry
 * @param {number} entry.userId    who did it — required; without it there is
 *                                 nothing to audit and the row is dropped
 * @param {string} entry.action    one of ACTIONS
 * @param {string} entry.module    one of MODULES
 * @param {string} [entry.entity]  what was acted on, e.g. "students#2014"
 * @param {object} [entry.before]  state before, for updates
 * @param {object} [entry.after]   state after
 * @param {object} [entry.req]     the request, for the IP address
 */
const record = async ({ userId, action, module, entity, before, after, req }) => {
    try {
        /*
         * user_id is NOT NULL with a foreign key to users. An unauthenticated
         * or system-initiated act therefore cannot be attributed, and writing
         * it would fail the insert anyway — so it is skipped, loudly enough to
         * be noticed in the server log but without disturbing the caller.
         */
        if (!userId) {
            console.warn(`[audit] ${action} had no actor and was not recorded`);
            return null;
        }

        return await AuditLog.create({
            user_id: userId,
            action,
            module,
            entity_affected: entity ? String(entity).slice(0, 100) : null,
            old_value: before === undefined ? null : scrub(before),
            new_value: after === undefined ? null : scrub(after),
            action_timestamp: new Date(),
            ip_address: ipOf(req)
        });

    } catch (error) {
        // Deliberately swallowed. See the header comment.
        console.error("[audit] could not write entry:", error.message);
        return null;
    }
};

/*
 * ---------------------------------------------------------------- narrative
 *
 * An audit row is `MARKS_UPDATED` plus two JSON blobs. That is the right thing
 * to STORE — it survives a rename and it can be filtered — but it is not what
 * an administrator opening the screen can read.
 *
 * The phrasing therefore lives here, next to the actions it describes, rather
 * than in the two React components that show them. The dashboard feed and the
 * audit page render the same sentence for the same row because they are handed
 * the sentence, not the enum.
 */

const ACTION_LABEL = {
    STUDENT_ADMITTED: "Student admitted",
    STUDENT_UPDATED: "Student record updated",
    STUDENT_DELETED: "Student removed",
    STUDENT_RESTORED: "Student reinstated",
    STUDENT_ENROLLED: "Student enrolled in a semester",
    TEACHER_ONBOARDED: "Teacher onboarded",
    TEACHER_UPDATED: "Teacher record updated",
    TEACHER_DELETED: "Teacher removed",

    CREDENTIALS_REISSUED: "Login credentials reissued",
    PASSWORD_CHANGED: "Password changed",
    PASSWORD_RESET: "Password reset completed",
    PASSWORD_RESET_REQUESTED: "Password reset requested",
    USER_REGISTERED: "Account self-registered",
    USER_CREATED: "Account created",
    USER_UPDATED: "Account updated",
    USER_DELETED: "Account deactivated",
    ACCOUNT_LOCKED: "Account locked after failed sign-ins",
    ACCOUNT_UNLOCKED: "Account unlocked by an administrator",
    ADMIN_CREATED: "Staff account created",
    ADMIN_UPDATED: "Staff account updated",
    ADMIN_DELETED: "Staff account removed",

    PARENT_CREATED: "Parent registered",
    PARENT_UPDATED: "Parent record updated",
    PARENT_DELETED: "Parent removed",
    PARENT_LINKED: "Parent linked",
    PARENT_CHILD_LINKED: "Child linked to a parent",
    PARENT_CHILD_UNLINKED: "Child unlinked from a parent",

    VOUCHER_ISSUED: "Fee voucher issued",
    VOUCHER_UPDATED: "Fee voucher updated",
    VOUCHER_CANCELLED: "Fee voucher cancelled",
    PAYMENT_RECORDED: "Payment recorded",
    PAYMENT_SUBMITTED: "Payment submitted for approval",
    PAYMENT_VERIFIED: "Payment approved",
    PAYMENT_REJECTED: "Payment rejected",
    PAYMENT_UPDATED: "Payment amended",
    PAYMENT_DELETED: "Payment deleted",
    FEE_STRUCTURE_CREATED: "Fee structure created",
    FEE_STRUCTURE_UPDATED: "Fee structure updated",
    FEE_STRUCTURE_DELETED: "Fee structure removed",

    EXAM_CREATED: "Exam created",
    EXAM_UPDATED: "Exam updated",
    EXAM_DELETED: "Exam deleted",
    MARKS_ENTERED: "Marks entered",
    MARKS_UPDATED: "Marks updated",
    MARKS_VERIFIED: "Marks verified",
    RESULT_PUBLISHED: "Result published",

    ATTENDANCE_MARKED: "Attendance marked",
    ATTENDANCE_UPDATED: "Attendance amended",
    ATTENDANCE_DELETED: "Attendance record deleted"
};

/*
 * Turns an action enum into a sentence.
 *
 * An unrecognised action is not an error and must not render as a blank row —
 * a new action added by a later change should still read sensibly the first
 * time it appears, so it falls back to title-casing the enum itself.
 */
const labelFor = (action) => ACTION_LABEL[action]
    || String(action || "")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());

/*
 * The one phrase that identifies WHAT was acted on.
 *
 * Preference order matters: for a marks row the student's name is what an
 * administrator is scanning for, not the exam id, so names come before
 * identifiers. The "after" snapshot wins over "before" except on deletions,
 * where "after" is only the tombstone and "before" holds the record.
 */
const SUBJECT_KEYS = [
    "studentName", "name", "targetEmail", "title", "examTitle",
    "subjectName", "registrationNumber", "email", "voucherNumber",
    "receiptNumber", "departmentName", "programName", "batchName",
    "sectionName", "semesterName"
];

const subjectOf = (row) => {
    const sources = row.action && String(row.action).includes("DELETE")
        ? [row.before, row.after]
        : [row.after, row.before];

    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of SUBJECT_KEYS) {
            const value = source[key];
            if (typeof value === "string" && value.trim()) return value.trim();
            if (typeof value === "number") return String(value);
        }
    }

    // Nothing named itself, so fall back to the entity reference the row
    // always carries — "students#2014" is less useful than a name, but it is
    // still an answer to "which one".
    return row.entity || null;
};

/*
 * A bulk act says how many rows it touched. Marking a register for a section of
 * 40 is one audit entry, and "Attendance marked" without "40 students" loses
 * the only part of it worth reading.
 */
const countOf = (row) => {
    const after = row.after;
    if (!after || typeof after !== "object") return null;
    for (const key of ["count", "studentCount", "recordCount", "rows", "marksCount"]) {
        const value = Number(after[key]);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
};

/** `{ label, subject, count }` for one row — see the header above. */
const describe = (row) => ({
    label: labelFor(row.action),
    subject: subjectOf(row),
    count: countOf(row)
});

/**
 * The trail, newest first, for the admin screen that reads it.
 *
 * Filters: module, action, user_id, from, to, q. Paged, because this table only
 * ever grows.
 */
const list = async ({ page = 1, limit = 25, module, action, user_id, from, to, q } = {}) => {

    const size = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * size;

    const clauses = ["1=1"];
    const replacements = { limit: size, offset };

    if (module) { clauses.push("a.module = :module"); replacements.module = module; }
    if (action) { clauses.push("a.action = :action"); replacements.action = action; }
    if (user_id) { clauses.push("a.user_id = :user_id"); replacements.user_id = Number(user_id); }
    if (from) { clauses.push("a.action_timestamp >= :from"); replacements.from = from; }
    if (to) { clauses.push("a.action_timestamp < DATE_ADD(:to, INTERVAL 1 DAY)"); replacements.to = to; }

    /*
     * Free text over the parts of a row a person would search by: the actor's
     * email, the entity reference, and the JSON snapshots — which is where the
     * student or exam NAME lives, and therefore the only way "Ayesha" finds the
     * row about Ayesha. Matched with LIKE over the serialised JSON rather than
     * a JSON path, because the useful key differs per action.
     */
    if (q && String(q).trim()) {
        clauses.push(`(
            u.email LIKE :q
            OR a.entity_affected LIKE :q
            OR a.action LIKE :q
            OR CAST(a.new_value AS CHAR) LIKE :q
            OR CAST(a.old_value AS CHAR) LIKE :q
        )`);
        replacements.q = `%${String(q).trim()}%`;
    }

    const where = clauses.join(" AND ");

    const query = (sql, extra) => sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements: { ...replacements, ...extra }
    });

    /*
     * The actor's NAME is not on `users` — the person's name lives on whichever
     * table describes what they are. An admin reading the trail wants "Sana
     * Iqbal", not "teacher12@aims.edu.pk", so all three are joined and the
     * first that answers wins.
     */
    const ACTOR_NAME = `COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', emp.first_name, emp.last_name)), ''),
        NULLIF(TRIM(CONCAT_WS(' ', st.first_name,  st.last_name)),  ''),
        NULLIF(TRIM(CONCAT_WS(' ', par.first_name, par.last_name)), '')
    )`;

    const ACTOR_JOINS = `
        LEFT JOIN users     u   ON u.user_id   = a.user_id
        LEFT JOIN roles     r   ON r.role_id   = u.role_id
        LEFT JOIN employees emp ON emp.user_id = a.user_id
        LEFT JOIN students  st  ON st.user_id  = a.user_id
        LEFT JOIN parents   par ON par.user_id = a.user_id`;

    const [[{ total }], rows, modules, actions] = await Promise.all([
        query(`SELECT COUNT(*) AS total FROM audit_logs a
               LEFT JOIN users u ON u.user_id = a.user_id
               WHERE ${where}`),
        query(
            `SELECT a.log_id, a.user_id, a.action, a.module, a.entity_affected,
                    a.old_value, a.new_value, a.action_timestamp, a.ip_address,
                    u.email AS actor_email, r.role_name AS actor_role,
                    ${ACTOR_NAME} AS actor_name
               FROM audit_logs a${ACTOR_JOINS}
              WHERE ${where}
           ORDER BY a.action_timestamp DESC, a.log_id DESC
              LIMIT :limit OFFSET :offset`
        ),
        /*
         * The filter dropdowns are built from what the table actually contains,
         * not from the MODULES/ACTIONS constants. Offering a filter that
         * matches nothing is how the old Students screen ended up with four
         * programmes this institute does not run.
         */
        sequelize.query(
            `SELECT module, COUNT(*) AS total FROM audit_logs
              WHERE module IS NOT NULL GROUP BY module ORDER BY module`,
            { type: sequelize.QueryTypes.SELECT }
        ),
        sequelize.query(
            `SELECT action, COUNT(*) AS total FROM audit_logs
              WHERE action IS NOT NULL GROUP BY action ORDER BY action`,
            { type: sequelize.QueryTypes.SELECT }
        )
    ]);

    const shaped = rows.map((r) => {
        const row = {
            id: r.log_id,
            action: r.action,
            module: r.module,
            entity: r.entity_affected,
            // MySQL's JSON columns come back parsed by mysql2, but a row
            // written before the column was JSON comes back as a string.
            before: typeof r.old_value === "string" ? safeParse(r.old_value) : r.old_value,
            after: typeof r.new_value === "string" ? safeParse(r.new_value) : r.new_value,
            at: r.action_timestamp,
            ip: r.ip_address,
            actor: {
                userId: r.user_id,
                name: r.actor_name || null,
                email: r.actor_email || null,
                role: r.actor_role || null
            }
        };

        // Phrasing travels with the row so the feed and the audit page cannot
        // word the same event differently. See describe() above.
        return { ...row, ...describe(row) };
    });

    return {
        rows: shaped,
        options: {
            modules: modules.map((m) => ({ value: m.module, total: Number(m.total) })),
            actions: actions.map((a) => ({
                value: a.action,
                label: labelFor(a.action),
                total: Number(a.total)
            }))
        },
        pagination: {
            page: Math.max(Number(page) || 1, 1),
            limit: size,
            total: Number(total),
            pages: Math.max(Math.ceil(Number(total) / size), 1)
        }
    };
};

const safeParse = (value) => {
    try { return JSON.parse(value); } catch { return value; }
};

module.exports = { record, list, describe, labelFor, ACTIONS, MODULES };
