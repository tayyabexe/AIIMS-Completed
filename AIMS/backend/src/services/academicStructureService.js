/*
 * The academic structure: departments, programmes, batches, sections,
 * classrooms and semesters.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * These six tables describe the shape of the institute — which departments run
 * which programmes, which intake years exist, how each is divided into classes,
 * and which rooms and terms those classes occupy. Every other table points at
 * them: a student has a program_id, a batch_id and a section_id, a voucher has a
 * semester_id, a timetable row has a classroom_id.
 *
 * They were also the least served part of the API. Departments were a single
 * hardcoded SELECT with no way to add one. Semesters were read-only. Classrooms
 * had no endpoint at all. Batches and sections had CRUD, but on routers with no
 * authenticate() on them whatsoever — any unauthenticated caller could DELETE
 * every section in the institute, which soft-deletes the class of every student
 * in it. None of them checked whether the row they were deleting was still
 * referenced, so removing a batch left its students pointing at nothing.
 *
 * WHAT IS DIFFERENT HERE
 * ----------------------
 * 1. Every write is authenticated and admin-gated (enforced by the router).
 * 2. Every write validates its own inputs and its foreign keys, so a section
 *    cannot be created under a batch that does not exist.
 * 3. Every delete removes the row, and refuses while the row is still
 *    referenced — saying by what. A structural row is not something to remove
 *    quietly (340 students would lose their programme), but neither is it
 *    something to leave behind under an is_deleted flag: the unique keys here
 *    do not include that column, so a hidden row went on reserving its name and
 *    made the department's own programme impossible to recreate.
 * 4. Every list carries live counts from the tables that point at it, because
 *    "can I delete this?" and "how big is this?" are the two questions this
 *    screen exists to answer.
 *
 * Written as SQL rather than through the models for the same reason as
 * adminPortalService: the counts are aggregates over other tables, and doing
 * them as associations would be six extra round trips per row.
 */

const { sequelize } = require("../database/connection");
// The room-type vocabulary and the one rule that matches a room to a subject.
// Imported rather than restated so the list cannot drift from the scheduler's.
const { ROOM_TYPES, isRoomType } = require("../config/roomTypes");

const select = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

/*
 * INSERT and UPDATE/DELETE are separate helpers because Sequelize returns
 * different things for each: an INSERT resolves to [insertId, affectedRows],
 * which is the only way to learn the id of the row just written, while an
 * UPDATE resolves to metadata that nothing here reads.
 */
const insert = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.INSERT,
        replacements
    });

const execute = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.UPDATE,
        replacements
    });

// ------------------------------------------------------------------ helpers

/**
 * An error the controller turns into a 4xx rather than a 500.
 * `status` is what makes the difference between "you asked for something
 * impossible" and "this service is broken", which the caller needs to tell
 * apart.
 */
const fail = (status, message, extra = {}) => {
    const error = new Error(message);
    error.status = status;
    Object.assign(error, extra);
    return error;
};

const asId = (value) => {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const asText = (value, { max, label, required = false }) => {
    if (value === undefined || value === null) {
        if (required) throw fail(400, `${label} is required.`);
        return undefined;
    }

    const text = String(value).trim();

    if (!text) {
        if (required) throw fail(400, `${label} is required.`);
        return undefined;
    }
    if (text.length > max) {
        throw fail(400, `${label} cannot be longer than ${max} characters.`);
    }

    return text;
};

const asYear = (value, label) => {
    if (value === undefined || value === null || value === "") return undefined;

    const year = Number.parseInt(value, 10);

    // The `year` column type accepts 1901-2155; the narrower window here is what
    // an intake year can plausibly be, and catches a mistyped 20205.
    if (!Number.isInteger(year) || year < 1950 || year > 2100) {
        throw fail(400, `${label} must be a four-digit year between 1950 and 2100.`);
    }

    return year;
};

const asDate = (value, label, { required = false } = {}) => {
    if (value === undefined || value === null || value === "") {
        if (required) throw fail(400, `${label} is required.`);
        return undefined;
    }

    const text = String(value).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(text).getTime())) {
        throw fail(400, `${label} must be a date in YYYY-MM-DD form.`);
    }

    return text;
};

/** Throws unless a row with this id exists and is not soft-deleted. */
const mustExist = async (table, idColumn, id, label, { softDeleted = true } = {}) => {
    const [row] = await select(
        `SELECT ${idColumn} AS id FROM ${table}
          WHERE ${idColumn} = :id ${softDeleted ? "AND is_deleted = 0" : ""}
          LIMIT 1`,
        { id }
    );

    if (!row) throw fail(400, `${label} ${id} does not exist.`);

    return row;
};

/**
 * Refuses a delete while other rows still point at this one.
 *
 * @param blockers  [{ sql, replacements, describe: (n) => string }]
 *
 * The counts deliberately do NOT filter out soft-deleted children. The delete
 * they guard is a real DELETE, and MySQL's RESTRICT does not care that a
 * student row has is_deleted = 1 — it is still a row holding a foreign key.
 * Counting only the live ones is what would let a delete pass this guard and
 * then fail at the database with a raw 1451.
 *
 * Every blocker is counted, not just the first, so the message can name
 * everything standing in the way at once — being told about the students, fixing
 * that, and only then being told about the sections is three round trips to
 * learn one thing.
 */
const refuseIfReferenced = async (label, blockers) => {
    const counts = await Promise.all(
        blockers.map(async (blocker) => {
            const [row] = await select(blocker.sql, blocker.replacements);
            return { n: Number(row?.n || 0), describe: blocker.describe };
        })
    );

    const blocking = counts.filter((c) => c.n > 0);

    if (blocking.length) {
        throw fail(
            409,
            `This ${label} is still in use: ${blocking.map((c) => c.describe(c.n)).join(", ")}. `
            + "Move or remove those first.",
            { blockedBy: blocking.map((c) => c.describe(c.n)) }
        );
    }
};

/*
 * These strings are read by an administrator on a refused delete — "This
 * programme is still in use: 408 students, 2 batches, 8 semesters" — so a bare
 * `+ "s"` is not good enough: it produced "2 batchs". Words ending in a sibilant
 * take -es, which covers every noun this module actually pluralises (batch,
 * class) without pretending to be a general English pluraliser.
 */
const plural = (n, word) => {
    if (n === 1) return `${n} ${word}`;
    const suffix = /(?:s|x|z|ch|sh)$/i.test(word) ? "es" : "s";
    return `${n} ${word}${suffix}`;
};

/*
 * A real DELETE, and the reason this helper is named rather than inlined.
 *
 * Every structural delete here used to flip is_deleted instead of removing the
 * row, which is not what these endpoints claim to do and not what the schema
 * supports. departments.department_name and programs.uq_program_per_department
 * are plain unique keys with no is_deleted in them, so a "deleted" programme
 * went on owning its name forever: invisible on every screen, unreachable by
 * every endpoint, and recreating it under the same department came back as
 * "Duplicate entry '1-BS Computer Science'" — a 500 with nothing the
 * administrator could do about it. The row is now removed.
 *
 * What makes that safe is the blocker list on each delete below: nothing is
 * removed while another table still points at it.
 *
 * (Accounts are the deliberate exception and are not touched here. A user is
 * soft-deleted, because an account is the author of audit entries, results and
 * payments that have to keep naming somebody.)
 */
const removeRow = async (table, idColumn, id, label) => {
    try {
        await sequelize.query(
            `DELETE FROM ${table} WHERE ${idColumn} = :id`,
            { type: sequelize.QueryTypes.DELETE, replacements: { id } }
        );
    } catch (error) {
        /*
         * A foreign key the blocker list does not know about. 1451 is
         * ER_ROW_IS_REFERENCED_2 and means exactly what a blocker means —
         * something still points here — so it is answered the same way rather
         * than as a 500 claiming this service is broken.
         */
        const errno = error?.parent?.errno ?? error?.original?.errno;

        if (errno === 1451) {
            throw fail(409,
                `This ${label} is still referenced by other records, so it cannot be deleted. `
                + "Move or remove those first.");
        }

        throw error;
    }
};

// ==========================================================================
// DEPARTMENTS
// ==========================================================================
/*
 * A department is the top of the tree: programmes hang off it, and employees
 * (which is where teachers get theirs from) belong to one.
 *
 * The counts are what make the row actionable — a department with 3 programmes
 * and 11 staff is not one to delete by accident, and the list is the only place
 * that fact is visible before the attempt.
 */
const listDepartments = async (queryParams = {}) => {
    const clauses = ["d.is_deleted = 0"];
    const replacements = {};

    if (queryParams.q) {
        clauses.push("(d.department_name LIKE :q OR CONCAT(e.first_name, ' ', e.last_name) LIKE :q)");
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT d.department_id, d.department_name, d.head_employee_id,
                CONCAT(e.first_name, ' ', e.last_name) AS head_name,
                (SELECT COUNT(*) FROM programs p
                  WHERE p.department_id = d.department_id AND p.is_deleted = 0) AS program_count,
                (SELECT COUNT(*) FROM employees em
                  WHERE em.department_id = d.department_id AND em.is_deleted = 0) AS employee_count,
                (SELECT COUNT(*) FROM students s
                   JOIN programs p2 ON p2.program_id = s.program_id
                  WHERE p2.department_id = d.department_id
                    AND p2.is_deleted = 0 AND s.is_deleted = 0) AS student_count
           FROM departments d
           LEFT JOIN employees e ON e.employee_id = d.head_employee_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY d.department_name`,
        replacements
    );

    return rows.map((r) => ({
        id: r.department_id,
        departmentId: r.department_id,
        name: r.department_name,
        headEmployeeId: r.head_employee_id ?? null,
        headName: r.head_name || null,
        programCount: Number(r.program_count),
        employeeCount: Number(r.employee_count),
        studentCount: Number(r.student_count)
    }));
};

const getDepartment = async (id) => {
    const [row] = await listDepartmentsById(id);
    return row || null;
};

const listDepartmentsById = async (id) => {
    const rows = await listDepartments();
    return rows.filter((r) => r.id === id);
};

const createDepartment = async (body) => {
    const name = asText(body.department_name ?? body.name, {
        max: 100, label: "Department name", required: true
    });

    const headEmployeeId = asId(body.head_employee_id);
    if (body.head_employee_id && !headEmployeeId) {
        throw fail(400, "head_employee_id must be a numeric employee id.");
    }
    if (headEmployeeId) await mustExist("employees", "employee_id", headEmployeeId, "Employee");

    // department_name is UNIQUE in the schema, so a soft-deleted row keeps
    // holding the name after the department is removed. Checking first turns
    // what would be a raw constraint error into something the caller can act on.
    const [clash] = await select(
        `SELECT department_id, is_deleted FROM departments
          WHERE department_name = :name LIMIT 1`,
        { name }
    );

    if (clash && !clash.is_deleted) {
        throw fail(409, `A department named "${name}" already exists.`);
    }

    // The clashing row is soft-deleted, and nothing in the app can reach it to
    // restore or rename it - the name would be reserved forever. Re-adding it
    // revives that row instead of inserting a second one, which also keeps the
    // original department_id so old references still resolve.
    if (clash) {
        await execute(
            `UPDATE departments
                SET is_deleted = 0, head_employee_id = :headEmployeeId
              WHERE department_id = :id`,
            { id: clash.department_id, headEmployeeId: headEmployeeId ?? null }
        );

        return getDepartment(clash.department_id);
    }

    const [id] = await insert(
        `INSERT INTO departments (department_name, head_employee_id, is_deleted)
         VALUES (:name, :headEmployeeId, 0)`,
        { name, headEmployeeId: headEmployeeId ?? null }
    );

    return getDepartment(id);
};

const updateDepartment = async (id, body) => {
    await mustExist("departments", "department_id", id, "Department");

    const sets = [];
    const replacements = { id };

    const name = asText(body.department_name ?? body.name, { max: 100, label: "Department name" });
    if (name !== undefined) {
        const [clash] = await select(
            `SELECT department_id FROM departments
              WHERE department_name = :name AND department_id <> :id LIMIT 1`,
            { name, id }
        );
        if (clash) throw fail(409, `A department named "${name}" already exists.`);

        sets.push("department_name = :name");
        replacements.name = name;
    }

    // Explicit null clears the head; undefined leaves it alone. The two are
    // different requests and a shared falsy check would collapse them.
    if (body.head_employee_id !== undefined) {
        const headEmployeeId = body.head_employee_id === null ? null : asId(body.head_employee_id);
        if (body.head_employee_id !== null && !headEmployeeId) {
            throw fail(400, "head_employee_id must be a numeric employee id, or null to clear it.");
        }
        if (headEmployeeId) await mustExist("employees", "employee_id", headEmployeeId, "Employee");

        sets.push("head_employee_id = :headEmployeeId");
        replacements.headEmployeeId = headEmployeeId;
    }

    if (!sets.length) throw fail(400, "Nothing to update.");

    await execute(
        `UPDATE departments SET ${sets.join(", ")} WHERE department_id = :id`,
        replacements
    );

    return getDepartment(id);
};

const deleteDepartment = async (id) => {
    await mustExist("departments", "department_id", id, "Department");

    await refuseIfReferenced("department", [
        {
            sql: "SELECT COUNT(*) AS n FROM programs WHERE department_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "programme")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM employees WHERE department_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "employee")
        }
    ]);

    await removeRow("departments", "department_id", id, "department");

    return { id, deleted: true };
};

// ==========================================================================
// PROGRAMMES
// ==========================================================================
const listPrograms = async (queryParams = {}) => {
    const clauses = ["p.is_deleted = 0"];
    const replacements = {};

    const departmentId = asId(queryParams.department_id);
    if (departmentId) {
        clauses.push("p.department_id = :departmentId");
        replacements.departmentId = departmentId;
    }

    if (queryParams.q) {
        clauses.push("(p.program_name LIKE :q OR d.department_name LIKE :q)");
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT p.program_id, p.program_name, p.department_id, p.duration_semesters,
                d.department_name,
                (SELECT COUNT(*) FROM batches b
                  WHERE b.program_id = p.program_id AND b.is_deleted = 0) AS batch_count,
                (SELECT COUNT(*) FROM semesters sm
                  WHERE sm.program_id = p.program_id) AS semester_count,
                (SELECT COUNT(*) FROM students s
                  WHERE s.program_id = p.program_id AND s.is_deleted = 0) AS student_count
           FROM programs p
           LEFT JOIN departments d ON d.department_id = p.department_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY d.department_name, p.program_name`,
        replacements
    );

    return rows.map((r) => ({
        id: r.program_id,
        programId: r.program_id,
        name: r.program_name,
        departmentId: r.department_id,
        department: r.department_name || null,
        durationSemesters: Number(r.duration_semesters),
        batchCount: Number(r.batch_count),
        semesterCount: Number(r.semester_count),
        studentCount: Number(r.student_count)
    }));
};

const getProgram = async (id) => {
    const rows = await listPrograms();
    return rows.find((r) => r.id === id) || null;
};

const createProgram = async (body) => {
    const name = asText(body.program_name ?? body.name, {
        max: 150, label: "Programme name", required: true
    });

    const departmentId = asId(body.department_id);
    if (!departmentId) throw fail(400, "A numeric department_id is required.");
    await mustExist("departments", "department_id", departmentId, "Department");

    const duration = Number.parseInt(body.duration_semesters, 10);
    if (!Number.isInteger(duration) || duration < 1 || duration > 20) {
        throw fail(400, "duration_semesters must be a whole number between 1 and 20.");
    }

    /*
     * uq_program_per_department is (department_id, program_name) with no
     * is_deleted in it, so the check has to see every row and not only the live
     * ones — see the revival below.
     */
    const [clash] = await select(
        `SELECT program_id, is_deleted FROM programs
          WHERE program_name = :name AND department_id = :departmentId
          LIMIT 1`,
        { name, departmentId }
    );

    if (clash && !clash.is_deleted) {
        throw fail(409, `That department already runs a programme named "${name}".`);
    }

    /*
     * A programme left soft-deleted by the delete this module used to do.
     * Nothing in the app can see it, but it still holds the name in the unique
     * key, so an INSERT beside it is the duplicate-entry 500 that made this
     * screen unusable. Reviving the row is the only way to give the name back,
     * and it keeps the original program_id so anything still pointing at it
     * resolves.
     */
    if (clash) {
        await execute(
            `UPDATE programs
                SET duration_semesters = :duration, is_deleted = 0
              WHERE program_id = :id`,
            { id: clash.program_id, duration }
        );

        return getProgram(clash.program_id);
    }

    const [id] = await insert(
        `INSERT INTO programs (department_id, program_name, duration_semesters, is_deleted)
         VALUES (:departmentId, :name, :duration, 0)`,
        { departmentId, name, duration }
    );

    return getProgram(id);
};

const updateProgram = async (id, body) => {
    await mustExist("programs", "program_id", id, "Programme");

    const sets = [];
    const replacements = { id };

    const name = asText(body.program_name ?? body.name, { max: 150, label: "Programme name" });
    if (name !== undefined) {
        sets.push("program_name = :name");
        replacements.name = name;
    }

    if (body.department_id !== undefined) {
        const departmentId = asId(body.department_id);
        if (!departmentId) throw fail(400, "department_id must be a numeric department id.");
        await mustExist("departments", "department_id", departmentId, "Department");
        sets.push("department_id = :departmentId");
        replacements.departmentId = departmentId;
    }

    if (body.duration_semesters !== undefined) {
        const duration = Number.parseInt(body.duration_semesters, 10);
        if (!Number.isInteger(duration) || duration < 1 || duration > 20) {
            throw fail(400, "duration_semesters must be a whole number between 1 and 20.");
        }

        /*
         * Shortening a programme past semesters that already exist would leave
         * those semesters — and every subject, enrolment and voucher hanging off
         * them — belonging to a term the programme says it does not have.
         */
        const [{ n }] = await select(
            `SELECT COUNT(*) AS n FROM semesters
              WHERE program_id = :id AND semester_number > :duration`,
            { id, duration }
        );

        if (Number(n) > 0) {
            throw fail(409,
                `This programme already has ${plural(Number(n), "semester")} numbered above ${duration}. `
                + "Remove those semesters before shortening it.");
        }

        sets.push("duration_semesters = :duration");
        replacements.duration = duration;
    }

    if (!sets.length) throw fail(400, "Nothing to update.");

    await execute(`UPDATE programs SET ${sets.join(", ")} WHERE program_id = :id`, replacements);

    return getProgram(id);
};

const deleteProgram = async (id) => {
    await mustExist("programs", "program_id", id, "Programme");

    await refuseIfReferenced("programme", [
        {
            sql: "SELECT COUNT(*) AS n FROM students WHERE program_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "student")
        },
        // batches.program_id and semesters.program_id both CASCADE, so without
        // these two the delete would take the whole subtree with it in silence.
        {
            sql: "SELECT COUNT(*) AS n FROM batches WHERE program_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "batch")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM semesters WHERE program_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "semester")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM fee_structures WHERE program_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "fee structure")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM announcement_targets WHERE program_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "announcement")
        }
    ]);

    await removeRow("programs", "program_id", id, "programme");

    return { id, deleted: true };
};

// ==========================================================================
// BATCHES
// ==========================================================================
/*
 * A batch is an intake: "BSCS-2022", the cohort that started a programme in a
 * given year. Sections divide it, and every student belongs to exactly one.
 *
 * ON "A BATCH OF A PARTICULAR SEMESTER"
 * -------------------------------------
 * A batch is not a child of a semester in this schema and cannot be made one: it
 * belongs to a programme and spans every semester of that programme's duration,
 * which is precisely what start_year/end_year record. What a caller asking for
 * "the batches of semester N" actually wants is the batches currently sitting in
 * that semester, and `semester_id` on the list below answers exactly that — it
 * filters to the batches whose students' current_semester_id is that semester,
 * with `current_semesters` on each row naming where the cohort has got to.
 */
const listBatches = async (queryParams = {}) => {
    const clauses = ["b.is_deleted = 0"];
    const replacements = {};

    const programId = asId(queryParams.program_id);
    if (programId) {
        clauses.push("b.program_id = :programId");
        replacements.programId = programId;
    }

    const departmentId = asId(queryParams.department_id);
    if (departmentId) {
        clauses.push("p.department_id = :departmentId");
        replacements.departmentId = departmentId;
    }

    // "Which batches are sitting in this semester right now."
    const semesterId = asId(queryParams.semester_id);
    if (semesterId) {
        clauses.push(
            `EXISTS (SELECT 1 FROM students s2
                      WHERE s2.batch_id = b.batch_id
                        AND s2.is_deleted = 0
                        AND s2.current_semester_id = :semesterId)`
        );
        replacements.semesterId = semesterId;
    }

    if (queryParams.q) {
        clauses.push("(b.batch_name LIKE :q OR p.program_name LIKE :q OR d.department_name LIKE :q)");
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT b.batch_id, b.batch_name, b.program_id, b.start_year, b.end_year,
                p.program_name, p.department_id, d.department_name,
                (SELECT COUNT(*) FROM sections sc
                  WHERE sc.batch_id = b.batch_id AND sc.is_deleted = 0) AS section_count,
                (SELECT COUNT(*) FROM students s
                  WHERE s.batch_id = b.batch_id AND s.is_deleted = 0) AS student_count,
                (SELECT COUNT(*) FROM students s
                  WHERE s.batch_id = b.batch_id AND s.is_deleted = 0
                    AND s.academic_status = 'Active') AS active_student_count
           FROM batches b
           LEFT JOIN programs    p ON p.program_id    = b.program_id
           LEFT JOIN departments d ON d.department_id = p.department_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY b.start_year DESC, b.batch_name`,
        replacements
    );

    const batchIds = rows.map((r) => r.batch_id);

    /*
     * Where each cohort has actually got to.
     *
     * A batch has no semester column — the students carry it — so a cohort that
     * has split (repeats a semester behind, the rest ahead) shows both. Without
     * this the screen can only say which year a batch started, which is not what
     * anyone asks when they are looking for "the third-semester batches".
     */
    const semesters = batchIds.length
        ? await select(
            `SELECT s.batch_id, sm.semester_id, sm.semester_number, COUNT(*) AS n
               FROM students s
               JOIN semesters sm ON sm.semester_id = s.current_semester_id
              WHERE s.batch_id IN (:batchIds) AND s.is_deleted = 0
              GROUP BY s.batch_id, sm.semester_id, sm.semester_number
              ORDER BY n DESC`,
            { batchIds }
        )
        : [];

    const byBatch = new Map();
    for (const row of semesters) {
        const list = byBatch.get(row.batch_id) || [];
        list.push({
            semesterId: row.semester_id,
            semesterNumber: Number(row.semester_number),
            studentCount: Number(row.n)
        });
        byBatch.set(row.batch_id, list);
    }

    return rows.map((r) => ({
        id: r.batch_id,
        batchId: r.batch_id,
        name: r.batch_name,
        programId: r.program_id,
        program: r.program_name || null,
        departmentId: r.department_id ?? null,
        department: r.department_name || null,
        startYear: r.start_year != null ? Number(r.start_year) : null,
        endYear: r.end_year != null ? Number(r.end_year) : null,
        sectionCount: Number(r.section_count),
        studentCount: Number(r.student_count),
        activeStudentCount: Number(r.active_student_count),
        currentSemesters: byBatch.get(r.batch_id) || []
    }));
};

const getBatch = async (id) => {
    const rows = await listBatches();
    return rows.find((r) => r.id === id) || null;
};

const readBatchBody = async (body, { partial = false } = {}) => {
    const out = {};

    const name = asText(body.batch_name ?? body.name, {
        max: 50, label: "Batch name", required: !partial
    });
    if (name !== undefined) out.batch_name = name;

    if (body.program_id !== undefined || !partial) {
        const programId = asId(body.program_id);
        if (!programId) throw fail(400, "A numeric program_id is required.");
        await mustExist("programs", "program_id", programId, "Programme");
        out.program_id = programId;
    }

    const startYear = asYear(body.start_year, "start_year");
    if (startYear !== undefined) out.start_year = startYear;

    const endYear = asYear(body.end_year, "end_year");
    if (endYear !== undefined) out.end_year = endYear;

    if (!partial && out.start_year === undefined) throw fail(400, "start_year is required.");
    if (!partial && out.end_year === undefined) throw fail(400, "end_year is required.");

    if (out.start_year !== undefined && out.end_year !== undefined
        && out.end_year < out.start_year) {
        throw fail(400, "end_year cannot be before start_year.");
    }

    return out;
};

const createBatch = async (body) => {
    const values = await readBatchBody(body);

    const [clash] = await select(
        `SELECT batch_id FROM batches
          WHERE batch_name = :name AND program_id = :programId AND is_deleted = 0
          LIMIT 1`,
        { name: values.batch_name, programId: values.program_id }
    );
    if (clash) throw fail(409, `That programme already has a batch named "${values.batch_name}".`);

    const [id] = await insert(
        `INSERT INTO batches (program_id, batch_name, start_year, end_year, is_deleted)
         VALUES (:program_id, :batch_name, :start_year, :end_year, 0)`,
        values
    );

    return getBatch(id);
};

const updateBatch = async (id, body) => {
    await mustExist("batches", "batch_id", id, "Batch");

    const values = await readBatchBody(body, { partial: true });
    const keys = Object.keys(values);
    if (!keys.length) throw fail(400, "Nothing to update.");

    /*
     * A partial update can still produce an invalid pair — sending only
     * end_year: 2023 against a batch that starts in 2024 passes the check above,
     * because start_year was never in the body. The stored row is what the
     * comparison has to be made against.
     */
    if (values.start_year !== undefined || values.end_year !== undefined) {
        const [current] = await select(
            "SELECT start_year, end_year FROM batches WHERE batch_id = :id",
            { id }
        );

        const start = values.start_year ?? Number(current.start_year);
        const end = values.end_year ?? Number(current.end_year);

        if (end < start) throw fail(400, "end_year cannot be before start_year.");
    }

    await execute(
        `UPDATE batches SET ${keys.map((k) => `${k} = :${k}`).join(", ")} WHERE batch_id = :id`,
        { ...values, id }
    );

    return getBatch(id);
};

const deleteBatch = async (id) => {
    await mustExist("batches", "batch_id", id, "Batch");

    await refuseIfReferenced("batch", [
        {
            sql: "SELECT COUNT(*) AS n FROM students WHERE batch_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "student")
        },
        // sections.batch_id CASCADEs: unguarded, deleting a batch would take
        // its classes with it without ever saying so.
        {
            sql: "SELECT COUNT(*) AS n FROM sections WHERE batch_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "section")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM teacher_assignments WHERE batch_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "teaching assignment")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM announcement_targets WHERE batch_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "announcement")
        }
    ]);

    await removeRow("batches", "batch_id", id, "batch");

    return { id, deleted: true };
};

// ==========================================================================
// SECTIONS  ("classes")
// ==========================================================================
/*
 * A section is a class: batch BSCS-2022 divided into A, B and C.
 *
 * `capacity` is the number the room and the timetable were planned around, so
 * the list reports how full each section is against it — a section at 44 of 40
 * is the thing this screen exists to surface, and nothing else in the portal
 * ever said it.
 */
const listSections = async (queryParams = {}) => {
    const clauses = ["sc.is_deleted = 0"];
    const replacements = {};

    const batchId = asId(queryParams.batch_id);
    if (batchId) {
        clauses.push("sc.batch_id = :batchId");
        replacements.batchId = batchId;
    }

    const programId = asId(queryParams.program_id);
    if (programId) {
        clauses.push("b.program_id = :programId");
        replacements.programId = programId;
    }

    const departmentId = asId(queryParams.department_id);
    if (departmentId) {
        clauses.push("p.department_id = :departmentId");
        replacements.departmentId = departmentId;
    }

    if (queryParams.q) {
        clauses.push(
            `(sc.section_name LIKE :q OR b.batch_name LIKE :q
              OR p.program_name LIKE :q OR d.department_name LIKE :q
              OR CONCAT(b.batch_name, '-', sc.section_name) LIKE :q)`
        );
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT sc.section_id, sc.section_name, sc.batch_id, sc.capacity,
                b.batch_name, b.program_id, p.program_name,
                p.department_id, d.department_name,
                (SELECT COUNT(*) FROM students s
                  WHERE s.section_id = sc.section_id AND s.is_deleted = 0) AS student_count,
                (SELECT COUNT(*) FROM students s
                  WHERE s.section_id = sc.section_id AND s.is_deleted = 0
                    AND s.academic_status = 'Active') AS active_student_count,
                (SELECT COUNT(*) FROM timetables t
                  WHERE t.section_id = sc.section_id) AS timetable_count
           FROM sections sc
           LEFT JOIN batches     b ON b.batch_id      = sc.batch_id
           LEFT JOIN programs    p ON p.program_id    = b.program_id
           LEFT JOIN departments d ON d.department_id = p.department_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY b.batch_name, sc.section_name`,
        replacements
    );

    return rows.map((r) => {
        const capacity = r.capacity != null ? Number(r.capacity) : null;
        const students = Number(r.student_count);

        return {
            id: r.section_id,
            sectionId: r.section_id,
            name: r.section_name,
            // What this class is actually called out loud.
            label: [r.batch_name, r.section_name].filter(Boolean).join("-"),
            batchId: r.batch_id,
            batch: r.batch_name || null,
            programId: r.program_id ?? null,
            program: r.program_name || null,
            departmentId: r.department_id ?? null,
            department: r.department_name || null,
            capacity,
            studentCount: students,
            activeStudentCount: Number(r.active_student_count),
            timetableCount: Number(r.timetable_count),
            seatsLeft: capacity != null ? capacity - students : null,
            overCapacity: capacity != null && students > capacity
        };
    });
};

const getSection = async (id) => {
    const rows = await listSections();
    return rows.find((r) => r.id === id) || null;
};

const readSectionBody = async (body, { partial = false } = {}) => {
    const out = {};

    const name = asText(body.section_name ?? body.name, {
        max: 10, label: "Section name", required: !partial
    });
    if (name !== undefined) out.section_name = name;

    if (body.batch_id !== undefined || !partial) {
        const batchId = asId(body.batch_id);
        if (!batchId) throw fail(400, "A numeric batch_id is required.");
        await mustExist("batches", "batch_id", batchId, "Batch");
        out.batch_id = batchId;
    }

    if (body.capacity !== undefined && body.capacity !== null && body.capacity !== "") {
        const capacity = Number.parseInt(body.capacity, 10);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
            throw fail(400, "capacity must be a whole number between 1 and 500.");
        }
        out.capacity = capacity;
    }

    return out;
};

const createSection = async (body) => {
    const values = await readSectionBody(body);

    const [clash] = await select(
        `SELECT section_id FROM sections
          WHERE batch_id = :batchId AND section_name = :name AND is_deleted = 0
          LIMIT 1`,
        { batchId: values.batch_id, name: values.section_name }
    );
    if (clash) throw fail(409, `That batch already has a section "${values.section_name}".`);

    const columns = Object.keys(values);

    const [id] = await insert(
        `INSERT INTO sections (${columns.join(", ")}, is_deleted)
         VALUES (${columns.map((c) => `:${c}`).join(", ")}, 0)`,
        values
    );

    return getSection(id);
};

const updateSection = async (id, body) => {
    await mustExist("sections", "section_id", id, "Section");

    const values = await readSectionBody(body, { partial: true });
    const keys = Object.keys(values);
    if (!keys.length) throw fail(400, "Nothing to update.");

    /*
     * Lowering capacity below the number of students already in the class is
     * refused rather than accepted-and-flagged: the number would immediately
     * describe something untrue, and the reason it was lowered is always that
     * somebody read the wrong row.
     */
    if (values.capacity !== undefined) {
        const [{ n }] = await select(
            "SELECT COUNT(*) AS n FROM students WHERE section_id = :id AND is_deleted = 0",
            { id }
        );

        if (Number(n) > values.capacity) {
            throw fail(409,
                `This section already holds ${plural(Number(n), "student")}, `
                + `so its capacity cannot be set to ${values.capacity}.`);
        }
    }

    await execute(
        `UPDATE sections SET ${keys.map((k) => `${k} = :${k}`).join(", ")} WHERE section_id = :id`,
        { ...values, id }
    );

    return getSection(id);
};

const deleteSection = async (id) => {
    await mustExist("sections", "section_id", id, "Section");

    await refuseIfReferenced("section", [
        {
            // students.section_id is ON DELETE SET NULL, so without this the
            // delete would succeed and quietly leave every one of them
            // classless — invisible on every section-shaped screen.
            sql: "SELECT COUNT(*) AS n FROM students WHERE section_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "student")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM timetables WHERE section_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "timetable slot")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM teacher_assignments WHERE section_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "teaching assignment")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM course_offerings WHERE section_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "course offering")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM announcement_targets WHERE section_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "announcement")
        }
    ]);

    await removeRow("sections", "section_id", id, "section");

    return { id, deleted: true };
};

// ==========================================================================
// CLASSROOMS
// ==========================================================================
/*
 * The rooms. These had no API at all, which is why the timetable screens could
 * show a room's name only where a timetable row already pointed at one, and no
 * screen could ever add a room.
 */
const listClassrooms = async (queryParams = {}) => {
    const clauses = ["c.is_deleted = 0"];
    const replacements = {};

    if (queryParams.q) {
        clauses.push("(c.room_name LIKE :q OR c.building LIKE :q)");
        replacements.q = `%${queryParams.q}%`;
    }

    if (queryParams.building) {
        clauses.push("c.building = :building");
        replacements.building = String(queryParams.building);
    }

    if (queryParams.room_type) {
        clauses.push("c.room_type = :roomType");
        replacements.roomType = String(queryParams.room_type);
    }

    const rows = await select(
        `SELECT c.classroom_id, c.room_name, c.building, c.capacity, c.room_type,
                (SELECT COUNT(*) FROM timetables t
                  WHERE t.classroom_id = c.classroom_id) AS timetable_count
           FROM classrooms c
          WHERE ${clauses.join(" AND ")}
          ORDER BY c.building, c.room_name`,
        replacements
    );

    return rows.map((r) => ({
        id: r.classroom_id,
        classroomId: r.classroom_id,
        name: r.room_name,
        building: r.building,
        capacity: Number(r.capacity),
        // What the room can be used for. NULL means no type was recorded, which
        // the scheduler treats as "cannot satisfy a subject that demands one".
        roomType: r.room_type || null,
        // How many weekly slots this room is booked for — the one number that
        // says whether a room is actually in service.
        timetableCount: Number(r.timetable_count)
    }));
};

const getClassroom = async (id) => {
    const rows = await listClassrooms();
    return rows.find((r) => r.id === id) || null;
};

const readClassroomBody = (body, { partial = false } = {}) => {
    const out = {};

    const name = asText(body.room_name ?? body.name, {
        max: 50, label: "Room name", required: !partial
    });
    if (name !== undefined) out.room_name = name;

    const building = asText(body.building, {
        max: 50, label: "Building", required: !partial
    });
    if (building !== undefined) out.building = building;

    if (body.capacity !== undefined || !partial) {
        const capacity = Number.parseInt(body.capacity, 10);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
            throw fail(400, "capacity must be a whole number between 1 and 1000.");
        }
        out.capacity = capacity;
    }

    /*
     * The room's type, and the reason this reader exists at all.
     *
     * `classrooms.room_type` has been on the table since the room-types
     * migration, and the placement engine matches it against
     * `subjects.required_room_type` as a HARD equality — a subject that needs a
     * Lab can only be placed in a room whose type is Lab. But nothing here read
     * the field, so a room created through the API always took the column's
     * DEFAULT of 'Lecture'. There was no way to create a laboratory, and so no
     * way to place any subject that required one: the grid reported "No room
     * fits" for every period, with nothing on screen explaining why.
     *
     * The column is NOT NULL, so unlike subjects.required_room_type there is no
     * "no type" here — every room is something. Omitting the field on create
     * therefore leaves it to the database default rather than being rejected,
     * which keeps existing callers working; clearing it on update is refused,
     * because a room with no type is not a state this table can represent.
     */
    if (body.room_type !== undefined) {
        const raw = body.room_type;

        if (raw === null || raw === "") {
            throw fail(
                400,
                `Every room has a type. Choose one of ${ROOM_TYPES.join(", ")}.`
            );
        }

        if (!isRoomType(raw)) {
            throw fail(400, `room_type must be one of ${ROOM_TYPES.join(", ")}.`);
        }

        out.room_type = raw;
    }

    return out;
};

const createClassroom = async (body) => {
    const values = readClassroomBody(body);

    // uq_room_per_building is (room_name, building) with no is_deleted in it,
    // so — exactly as with programmes — a room left soft-deleted by the old
    // delete still holds its name. Revive it rather than fail on the key.
    const [clash] = await select(
        `SELECT classroom_id, is_deleted FROM classrooms
          WHERE room_name = :name AND building = :building
          LIMIT 1`,
        { name: values.room_name, building: values.building }
    );

    if (clash && !clash.is_deleted) {
        throw fail(409, `${values.building} already has a room called "${values.room_name}".`);
    }

    if (clash) {
        await execute(
            `UPDATE classrooms
                SET ${Object.keys(values).map((c) => `${c} = :${c}`).join(", ")}, is_deleted = 0
              WHERE classroom_id = :id`,
            { ...values, id: clash.classroom_id }
        );

        return getClassroom(clash.classroom_id);
    }

    const columns = Object.keys(values);

    const [id] = await insert(
        `INSERT INTO classrooms (${columns.join(", ")}, is_deleted)
         VALUES (${columns.map((c) => `:${c}`).join(", ")}, 0)`,
        values
    );

    return getClassroom(id);
};

const updateClassroom = async (id, body) => {
    await mustExist("classrooms", "classroom_id", id, "Classroom");

    const values = readClassroomBody(body, { partial: true });
    const keys = Object.keys(values);
    if (!keys.length) throw fail(400, "Nothing to update.");

    await execute(
        `UPDATE classrooms SET ${keys.map((k) => `${k} = :${k}`).join(", ")}
          WHERE classroom_id = :id`,
        { ...values, id }
    );

    return getClassroom(id);
};

const deleteClassroom = async (id) => {
    await mustExist("classrooms", "classroom_id", id, "Classroom");

    await refuseIfReferenced("classroom", [
        {
            sql: "SELECT COUNT(*) AS n FROM timetables WHERE classroom_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "timetable slot")
        },
        // exams.classroom_id is SET NULL, which would take the venue off a
        // scheduled exam without anybody being told.
        {
            sql: "SELECT COUNT(*) AS n FROM exams WHERE classroom_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "exam")
        }
    ]);

    await removeRow("classrooms", "classroom_id", id, "classroom");

    return { id, deleted: true };
};

// ==========================================================================
// SEMESTERS
// ==========================================================================
/*
 * A semester belongs to a programme and is numbered within it. Subjects,
 * enrolments and fee vouchers all point at one.
 *
 * `semesters` has no is_deleted column — it has is_archived — so a delete here
 * was always a real DELETE, which is now true of every resource in this module.
 * Archiving remains the reversible alternative and is what the UI leads with:
 * closing a term is the common act, removing one is not.
 */
const listSemesters = async (queryParams = {}) => {
    const clauses = ["1 = 1"];
    const replacements = {};

    const programId = asId(queryParams.program_id);
    if (programId) {
        clauses.push("sm.program_id = :programId");
        replacements.programId = programId;
    }

    const departmentId = asId(queryParams.department_id);
    if (departmentId) {
        clauses.push("p.department_id = :departmentId");
        replacements.departmentId = departmentId;
    }

    // Archived terms are hidden unless asked for; every dropdown in the portal
    // reads this endpoint and should not offer a term that has been closed.
    if (queryParams.include_archived !== "1" && queryParams.include_archived !== "true") {
        clauses.push("sm.is_archived = 0");
    }

    if (queryParams.q) {
        clauses.push(
            `(p.program_name LIKE :q OR d.department_name LIKE :q
              OR CONCAT('Semester ', sm.semester_number) LIKE :q)`
        );
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT sm.semester_id, sm.program_id, sm.semester_number,
                sm.start_date, sm.end_date, sm.is_archived,
                p.program_name, p.department_id, d.department_name,
                (SELECT COUNT(*) FROM subjects sb
                  WHERE sb.semester_id = sm.semester_id AND sb.is_deleted = 0) AS subject_count,
                (SELECT COUNT(*) FROM enrollments e
                  WHERE e.semester_id = sm.semester_id) AS enrollment_count,
                (SELECT COUNT(*) FROM students s
                  WHERE s.current_semester_id = sm.semester_id AND s.is_deleted = 0) AS student_count,
                (SELECT COUNT(*) FROM fee_vouchers v
                  WHERE v.semester_id = sm.semester_id) AS voucher_count
           FROM semesters sm
           LEFT JOIN programs    p ON p.program_id    = sm.program_id
           LEFT JOIN departments d ON d.department_id = p.department_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY p.program_name, sm.semester_number`,
        replacements
    );

    return rows.map((r) => ({
        id: r.semester_id,
        semesterId: r.semester_id,
        number: Number(r.semester_number),
        label: `Semester ${r.semester_number}`,
        programId: r.program_id,
        program: r.program_name || null,
        departmentId: r.department_id ?? null,
        department: r.department_name || null,
        startDate: r.start_date || null,
        endDate: r.end_date || null,
        isArchived: !!r.is_archived,
        subjectCount: Number(r.subject_count),
        enrollmentCount: Number(r.enrollment_count),
        studentCount: Number(r.student_count),
        voucherCount: Number(r.voucher_count)
    }));
};

const getSemester = async (id) => {
    const rows = await listSemesters({ include_archived: "1" });
    return rows.find((r) => r.id === id) || null;
};

const readSemesterBody = async (body, { partial = false } = {}) => {
    const out = {};

    if (body.program_id !== undefined || !partial) {
        const programId = asId(body.program_id);
        if (!programId) throw fail(400, "A numeric program_id is required.");
        await mustExist("programs", "program_id", programId, "Programme");
        out.program_id = programId;
    }

    if (body.semester_number !== undefined || !partial) {
        const number = Number.parseInt(body.semester_number, 10);
        if (!Number.isInteger(number) || number < 1 || number > 20) {
            throw fail(400, "semester_number must be a whole number between 1 and 20.");
        }
        out.semester_number = number;
    }

    const startDate = asDate(body.start_date, "start_date", { required: !partial });
    if (startDate !== undefined) out.start_date = startDate;

    const endDate = asDate(body.end_date, "end_date", { required: !partial });
    if (endDate !== undefined) out.end_date = endDate;

    if (body.is_archived !== undefined) {
        out.is_archived = body.is_archived === true
            || body.is_archived === 1
            || body.is_archived === "1"
            || body.is_archived === "true" ? 1 : 0;
    }

    return out;
};

const createSemester = async (body) => {
    const values = await readSemesterBody(body);

    if (values.end_date < values.start_date) {
        throw fail(400, "end_date cannot be before start_date.");
    }

    // A semester cannot be numbered beyond the length of its own programme.
    const [program] = await select(
        "SELECT duration_semesters FROM programs WHERE program_id = :id",
        { id: values.program_id }
    );

    if (values.semester_number > Number(program.duration_semesters)) {
        throw fail(400,
            `That programme is ${program.duration_semesters} semesters long, `
            + `so it has no semester ${values.semester_number}.`);
    }

    const [clash] = await select(
        `SELECT semester_id FROM semesters
          WHERE program_id = :programId AND semester_number = :number LIMIT 1`,
        { programId: values.program_id, number: values.semester_number }
    );
    if (clash) throw fail(409, `That programme already has a semester ${values.semester_number}.`);

    const columns = Object.keys(values);

    const [id] = await insert(
        `INSERT INTO semesters (${columns.join(", ")})
         VALUES (${columns.map((c) => `:${c}`).join(", ")})`,
        values
    );

    return getSemester(id);
};

const updateSemester = async (id, body) => {
    await mustExist("semesters", "semester_id", id, "Semester", { softDeleted: false });

    const values = await readSemesterBody(body, { partial: true });
    const keys = Object.keys(values);
    if (!keys.length) throw fail(400, "Nothing to update.");

    if (values.start_date !== undefined || values.end_date !== undefined) {
        const [current] = await select(
            "SELECT start_date, end_date FROM semesters WHERE semester_id = :id",
            { id }
        );

        const toText = (d) => String(d).slice(0, 10);
        const start = values.start_date ?? toText(current.start_date);
        const end = values.end_date ?? toText(current.end_date);

        if (end < start) throw fail(400, "end_date cannot be before start_date.");
    }

    await execute(
        `UPDATE semesters SET ${keys.map((k) => `${k} = :${k}`).join(", ")}
          WHERE semester_id = :id`,
        { ...values, id }
    );

    return getSemester(id);
};

const deleteSemester = async (id) => {
    await mustExist("semesters", "semester_id", id, "Semester", { softDeleted: false });

    await refuseIfReferenced("semester", [
        {
            sql: "SELECT COUNT(*) AS n FROM subjects WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "subject")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM enrollments WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "enrolment")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM fee_vouchers WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "fee voucher")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM students WHERE current_semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "student currently in it")
        },
        /*
         * The rest of what hangs off a term. gpa.semester_id is RESTRICT and
         * would have failed at the database as a 500; results, exams,
         * scholarships and fee_structures all CASCADE and would have gone
         * silently.
         */
        {
            sql: "SELECT COUNT(*) AS n FROM gpa WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "GPA record")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM results WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "result")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM exams WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "exam")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM scholarships WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "scholarship")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM fee_structures WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "fee structure")
        },
        {
            sql: "SELECT COUNT(*) AS n FROM announcement_targets WHERE semester_id = :id",
            replacements: { id },
            describe: (n) => plural(n, "announcement")
        }
    ]);

    await removeRow("semesters", "semester_id", id, "semester");

    return { id, deleted: true };
};

// ==========================================================================
// THE WHOLE TREE  -  GET /api/academics/overview
// ==========================================================================
/*
 * Everything above in one request, for the screen that draws the structure as a
 * tree. Six small tables (4 departments, 6 programmes, 6 batches, 8 sections,
 * 40 semesters, 5 rooms) — cheaper as one call than as six.
 */
/*
 * The curriculum, for the structure screen's Subjects tab.
 *
 * Read here rather than through subjectService because this screen wants what
 * every other tab shows: the parent it hangs off, resolved to names, and the
 * counts that say whether the row is safe to delete. subjectService.getAll
 * returns the bare table.
 */
const listSubjects = async (queryParams = {}) => {
    const clauses = ["sb.is_deleted = 0"];
    const replacements = {};

    const semesterId = asId(queryParams.semester_id);
    if (semesterId) {
        clauses.push("sb.semester_id = :semesterId");
        replacements.semesterId = semesterId;
    }

    if (queryParams.q) {
        clauses.push("(sb.subject_code LIKE :q OR sb.subject_name LIKE :q)");
        replacements.q = `%${queryParams.q}%`;
    }

    const rows = await select(
        `SELECT sb.subject_id, sb.subject_code, sb.subject_name, sb.credit_hours,
                sb.semester_id, sb.required_room_type, sb.sessions_per_week,
                sm.semester_number, sm.program_id, p.program_name,
                (SELECT COUNT(*) FROM course_offerings o
                  WHERE o.subject_id = sb.subject_id)  AS offering_count,
                (SELECT COUNT(*) FROM enrollments e
                  WHERE e.subject_id = sb.subject_id)  AS enrollment_count,
                (SELECT COUNT(*) FROM exams x
                  WHERE x.subject_id = sb.subject_id)  AS exam_count
           FROM subjects sb
           LEFT JOIN semesters sm ON sm.semester_id = sb.semester_id
           LEFT JOIN programs  p  ON p.program_id   = sm.program_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY p.program_name, sm.semester_number, sb.subject_code`,
        replacements
    );

    return rows.map((r) => ({
        id: r.subject_id,
        subjectId: r.subject_id,
        code: r.subject_code,
        name: r.subject_name,
        creditHours: Number(r.credit_hours),
        semesterId: r.semester_id,
        semesterNumber: r.semester_number == null ? null : Number(r.semester_number),
        semesterLabel: r.semester_number == null ? null : `Semester ${r.semester_number}`,
        programId: r.program_id ?? null,
        program: r.program_name || null,
        requiredRoomType: r.required_room_type || null,
        sessionsPerWeek: Number(r.sessions_per_week),
        offeringCount: Number(r.offering_count),
        enrollmentCount: Number(r.enrollment_count),
        examCount: Number(r.exam_count)
    }));
};

const getOverview = async () => {
    const [departments, programs, batches, sections, semesters, classrooms, subjects, totals] =
        await Promise.all([
            listDepartments(),
            listPrograms(),
            listBatches(),
            listSections(),
            listSemesters({ include_archived: "1" }),
            listClassrooms(),
            listSubjects(),
            select(
                `SELECT
                    (SELECT COUNT(*) FROM students  WHERE is_deleted = 0) AS students,
                    (SELECT COUNT(*) FROM students  WHERE is_deleted = 0
                       AND academic_status = 'Active')                    AS active_students,
                    (SELECT COUNT(*) FROM students  WHERE is_deleted = 0
                       AND section_id IS NULL)                            AS unsectioned_students,
                    (SELECT COUNT(*) FROM teachers  WHERE is_deleted = 0) AS teachers`
            )
        ]);

    const t = totals[0] || {};

    return {
        departments,
        programs,
        batches,
        sections,
        semesters,
        classrooms,
        subjects,
        totals: {
            departments: departments.length,
            programs: programs.length,
            batches: batches.length,
            sections: sections.length,
            semesters: semesters.length,
            classrooms: classrooms.length,
            subjects: subjects.length,
            students: Number(t.students || 0),
            activeStudents: Number(t.active_students || 0),
            // Students with no class at all. They are invisible on every
            // section-shaped screen in the portal, which is why the count
            // belongs on the screen that can fix it.
            unsectionedStudents: Number(t.unsectioned_students || 0),
            teachers: Number(t.teachers || 0)
        }
    };
};

module.exports = {
    listDepartments, getDepartment, createDepartment, updateDepartment, deleteDepartment,
    listPrograms, getProgram, createProgram, updateProgram, deleteProgram,
    listBatches, getBatch, createBatch, updateBatch, deleteBatch,
    listSections, getSection, createSection, updateSection, deleteSection,
    listClassrooms, getClassroom, createClassroom, updateClassroom, deleteClassroom,
    listSemesters, getSemester, createSemester, updateSemester, deleteSemester,
    getOverview
};
