const { Op } = require("sequelize");
const User = require("../models/user.model");
const { sequelize } = require("../database/connection");

// password_hash is never returned by the read endpoints. Login reads the
// column directly through the auth service, so it is unaffected by this.
const PUBLIC_ATTRIBUTES = {
    exclude: ["password_hash"]
};

/*
 * Resolves the name behind an account.
 *
 * A person's name lives on `students`, `parents` or `employees` depending on
 * their role, and that record stays authoritative — it is the legal name that
 * goes on a transcript or a payslip. This resolves it in one query so the
 * admin screens can show who an account belongs to.
 *
 * `users.full_name` is the FALLBACK, not the override, and it exists for the
 * accounts this query cannot reach. An administrator has no student, parent or
 * employee record, so before that column existed this function returned
 * full_name: null for every admin in the institute and the frontend invented
 * "Admin2" from the email address to fill the hole.
 *
 * Order matters and is deliberate: role record first, account second. An admin
 * who is later given an employee record should start showing their HR name
 * rather than the display copy, and a student's name is corrected on the
 * student record, not on their login.
 */
const attachNames = async (users) => {

    const many = Array.isArray(users);
    const list = many ? users : [users];

    const userIds = [...new Set(list.map((u) => u.user_id).filter(Boolean))];

    if (userIds.length === 0) return users;

    const rows = await sequelize.query(
        `SELECT user_id, first_name, last_name, 'student' AS source
           FROM students  WHERE user_id IN (:userIds) AND is_deleted = 0
         UNION ALL
         SELECT user_id, first_name, last_name, 'parent'  AS source
           FROM parents   WHERE user_id IN (:userIds) AND is_deleted = 0
         UNION ALL
         SELECT user_id, first_name, last_name, 'employee' AS source
           FROM employees WHERE user_id IN (:userIds) AND is_deleted = 0`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { userIds }
        }
    );

    const byUserId = new Map(rows.map((r) => [r.user_id, r]));

    const merge = (user) => {

        const plain = user.get ? user.get({ plain: true }) : { ...user };
        const person = byUserId.get(plain.user_id) || null;

        const fromPerson = person
            ? [person.first_name, person.last_name].filter(Boolean).join(" ").trim()
            : "";

        return {
            ...plain,
            first_name: person ? person.first_name : null,
            last_name: person ? person.last_name : null,

            // Role record, then the account's own column, then null. Never a
            // placeholder — a caller must be able to tell "no name recorded"
            // apart from a name that happens to read like one.
            full_name: fromPerson || plain.full_name || null,

            /*
             * "account" is a real third value, not a missing one. It tells the
             * admin screen that this name came from the login rather than from
             * a person record, which is exactly the case for administrators
             * and is why their name is editable from Settings.
             */
            profile_type: person ? person.source : (plain.full_name ? "account" : null)
        };
    };

    return many ? list.map(merge) : merge(list[0]);
};

/*
 * The account-health cohorts the User Management screen is built around.
 *
 * `users` is the login table, and these five columns are the only record the
 * institute keeps of how its logins are actually behaving. None of them is
 * visible on the Students, Parents, Teachers or Staff screens, because those
 * screens are about PEOPLE — this is the one place the credential itself is
 * the subject.
 *
 * Expressed as WHERE fragments rather than filtered in the browser: 4,047
 * accounts is twenty pages at 200 a page, so "show me the locked ones" has to
 * be a question the database answers.
 */
const STATUS_FILTERS = {
    // Issued a login and never once used it — 1,012 of them here.
    never_logged_in: { last_login: null },
    /*
     * Genuinely locked out: five failed sign-ins tripped the lock and only an
     * administrator can lift it. See services/loginSecurity.js.
     *
     * This key used to mean `failed_login_attempts > 0`, which was a mistake
     * worth naming: nothing in the system could lock an account at the time,
     * so the chip labelled "locked" was really "has ever mistyped a password
     * since the counter was last cleared" — one bad attempt on a healthy
     * account put it in the same cohort as a real lockout. That cohort is
     * still available, under the honest name below.
     */
    locked: { locked_at: { [Op.ne]: null } },
    // Failed attempts on record, lock or no lock. The count is on the row.
    failed_attempts: { failed_login_attempts: { [Op.gt]: 0 } },
    /*
     * `unverified: { email_verified: false }` used to sit here. It is gone
     * because the cohort it named was not a cohort: no verification flow exists
     * in this system, nothing ever set the column to 1, so the filter selected
     * "every account provisioned by the portal" under a security-sounding name.
     * See provisioningService.createLogin.
     */
    must_change_password: { must_change_password: true },
    inactive: { is_active: false },
    active: { is_active: true }
};

// Columns a caller may order by. Whitelisted rather than interpolated, and
// every one of them is a real column on `users`.
const SORTABLE = {
    user_id: "user_id",
    email: "email",
    role: "role_id",
    last_login: "last_login",
    created: "created_at",
    failed: "failed_login_attempts",
    password_changed: "last_password_change"
};

// Opt-in filtering and pagination, matching getStudents. Called with no
// options this returns every user exactly as before.
const getAllUsers = async (options = {}) => {

    const { role_id, is_active, email, q, status, sort, dir, orphans, page, limit } = options;

    const where = { is_deleted: false };

    if (role_id) where.role_id = role_id;
    /*
     * Accepts true/false, 1/0 and "yes"/"no".
     *
     * This read `is_active === "true"` only, so `?is_active=1` — the form every
     * other filter in this API takes, and the one a checkbox naturally
     * produces — was silently interpreted as FALSE and returned the inactive
     * accounts instead of the active ones.
     */
    if (is_active !== undefined && is_active !== "") {
        where.is_active = ["true", "1", "yes", true, 1].includes(
            typeof is_active === "string" ? is_active.toLowerCase() : is_active
        );
    }
    if (email) where.email = { [Op.like]: `%${email}%` };

    // Free text over the address. The name lives on students/parents/employees
    // and is joined in after the page is selected, so it cannot be part of
    // this WHERE without a join that would change the count.
    if (q) where.email = { [Op.like]: `%${q}%` };

    if (status && STATUS_FILTERS[status]) Object.assign(where, STATUS_FILTERS[status]);

    /*
     * Logins with no person behind them.
     *
     * Twelve accounts in this database belong to no student, parent or
     * employee record. They can sign in, they hold a role, and they appear on
     * no other screen in the portal — the Students, Parents and Teachers lists
     * are all built from the person tables, so an account with no person row is
     * invisible everywhere except here.
     */
    if (orphans === "only") {
        where[Op.and] = sequelize.literal(`user_id NOT IN (
            SELECT user_id FROM students  WHERE user_id IS NOT NULL AND is_deleted = 0
             UNION SELECT user_id FROM parents   WHERE user_id IS NOT NULL AND is_deleted = 0
             UNION SELECT user_id FROM employees WHERE user_id IS NOT NULL AND is_deleted = 0)`);
    }

    const column = SORTABLE[sort] || "user_id";
    const direction = String(dir).toLowerCase() === "desc" ? "DESC" : "ASC";

    const query = {
        where,
        attributes: PUBLIC_ATTRIBUTES,
        /*
         * NULLs last in both directions. `last_login` is null for the 1,012
         * accounts that have never been used, and sorting by "most recently
         * seen" should not open on a thousand rows that have never been seen
         * at all.
         */
        order: column === "user_id"
            ? [["user_id", direction]]
            : [[sequelize.literal(`${column} IS NULL`), "ASC"], [column, direction], ["user_id", "ASC"]]
    };

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    const paginated = Number.isInteger(limitNum) && limitNum > 0;

    if (paginated) {
        query.limit = limitNum;
        query.offset = Number.isInteger(pageNum) && pageNum > 1
            ? (pageNum - 1) * limitNum
            : 0;
    }

    const { count: total, rows } = await User.findAndCountAll(query);

    return {
        users: await attachNames(rows),
        total,
        summary: await getAccountHealth(),
        roleCounts: await getRoleCounts(),
        page: paginated ? (Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1) : undefined,
        limit: paginated ? limitNum : undefined
    };
};

/*
 * The account-health headline, counted over every live login in one statement.
 *
 * Deliberately NOT scoped to the current filter: these are the numbers the
 * screen's status chips are FOR, and a chip reading "Never signed in (0)"
 * because you are already filtered to that cohort tells you nothing. They
 * describe the institute; the table underneath describes the filter.
 */
const getAccountHealth = async () => {
    const [row] = await sequelize.query(
        `SELECT COUNT(*)                                  AS accounts,
                SUM(last_login IS NULL)                   AS never_logged_in,
                SUM(locked_at IS NOT NULL)                AS locked,
                SUM(failed_login_attempts > 0)            AS failed_attempts,
                SUM(must_change_password = 1)             AS must_change_password,
                SUM(is_active = 0)                        AS inactive,
                SUM(user_id NOT IN (
                        SELECT user_id FROM students  WHERE user_id IS NOT NULL AND is_deleted = 0
                         UNION SELECT user_id FROM parents   WHERE user_id IS NOT NULL AND is_deleted = 0
                         UNION SELECT user_id FROM employees WHERE user_id IS NOT NULL AND is_deleted = 0
                    ))                                    AS orphans
           FROM users
          WHERE is_deleted = 0`,
        { type: sequelize.QueryTypes.SELECT }
    );

    return {
        accounts: Number(row.accounts || 0),
        neverLoggedIn: Number(row.never_logged_in || 0),
        locked: Number(row.locked || 0),
        failedAttempts: Number(row.failed_attempts || 0),
        mustChangePassword: Number(row.must_change_password || 0),
        inactive: Number(row.inactive || 0),
        orphans: Number(row.orphans || 0)
    };
};

// Accounts per role, so the role filter can show what each option will return
// rather than offering eight values of unknown size.
const getRoleCounts = async () => {
    const rows = await sequelize.query(
        `SELECT r.role_id, r.role_name, COUNT(u.user_id) AS accounts
           FROM roles r
           LEFT JOIN users u ON u.role_id = r.role_id AND u.is_deleted = 0
          GROUP BY r.role_id, r.role_name
          ORDER BY r.role_id`,
        { type: sequelize.QueryTypes.SELECT }
    );
    return rows.map((r) => ({
        roleId: r.role_id,
        roleName: r.role_name,
        accounts: Number(r.accounts || 0)
    }));
};

const getUserById = async (id) => {
    const user = await User.findOne({
        where: {
            user_id: id,
            is_deleted: false
        },
        attributes: PUBLIC_ATTRIBUTES
    });

    if (!user) return null;

    return await attachNames(user);
};

const bcrypt = require("bcrypt");

// Create User
const createUser = async (userData) => {

    // Check Email
    const existingUser = await User.findOne({
        where: {
            email: userData.email
        }
    });

    if (existingUser) {
        throw new Error("Email already exists");
    }

    // Hash Password
    const hashedPassword = await bcrypt.hash(
        userData.password_hash,
        10
    );

    userData.password_hash = hashedPassword;

    return await User.create(userData);
};

//update user
const updateUser = async (id, userData) => {

    const user = await User.findByPk(id);

    if (!user || user.is_deleted) {
        return null;
    }

    if (userData.email) {

        const existingEmail = await User.findOne({
            where: {
                email: userData.email
            }
        });

        if (
            existingEmail &&
            existingEmail.user_id != id
        ) {
            throw new Error("Email already exists");
        }
    }

    if (userData.password_hash) {

        userData.password_hash = await bcrypt.hash(
            userData.password_hash,
            10
        );
    }

    await user.update(userData);

    return user;
};

const deleteUser = async (id) => {
    const user = await User.findByPk(id);

    if (!user || user.is_deleted) {
        return null;
    }

    await user.update({
        is_deleted: true
    });

    return user;
};

module.exports = {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser
};