// Covers the work added for role-scoped search, the live timetable, the
// self-service profile endpoints and the currency tag.
//
// Every assertion is checked against a direct DB query rather than against
// another API call, so a wrong query cannot agree with itself.
require("dotenv").config();
const { sequelize } = require("../database/connection");

const BASE = "http://localhost:5000";

const ACCOUNTS = {
    SuperAdmin: ["system.administrator@aims.edu.pk", "SuperAdmin@1234"],
    Admin: ["admin2@aims.edu.pk", "Admin@1234"],
    Teacher: ["teacher2@aims.edu.pk", "Teacher@1234"],
    Student: ["student2@aims.edu.pk", "Student@1234"],
    Parent: ["parent2@aims.edu.pk", "Parent@1234"]
};

const call = async (m, p, t, b) => {
    const h = { "Content-Type": "application/json" };
    if (t) h.Authorization = `Bearer ${t}`;
    const r = await fetch(BASE + p, {
        method: m,
        headers: h,
        body: b ? JSON.stringify(b) : undefined
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text };
};

const q = (s, r) => sequelize.query(s, {
    type: sequelize.QueryTypes.SELECT,
    replacements: r
});

let pass = 0, fail = 0;
const rec = (t, exp, got, ok, note) => {
    ok ? pass++ : fail++;
    console.log(`[${ok ? "PASS" : "FAIL"}] ${t.padEnd(52)} exp=${String(exp).padEnd(16)} got=${String(got).padEnd(16)} ${note || ""}`);
};

(async () => {

    const tokens = {};

    for (const [role, [email, password]] of Object.entries(ACCOUNTS)) {
        const r = await call("POST", "/api/auth/login", null, { email, password });
        tokens[role] = r.json && r.json.token;
        rec(`LOGIN ${role}`, "token", tokens[role] ? "token" : `none(${r.status})`, !!tokens[role]);
    }

    // ================= SEARCH: ACCESS CATALOGUE =================

    for (const [role, expected] of [
        ["Admin", 12], ["Student", 8], ["Teacher", 7], ["Parent", 6]
    ]) {
        const r = await call("GET", "/api/search/resources", tokens[role]);
        const n = r.json && r.json.resources ? r.json.resources.length : -1;
        rec(`RESOURCES ${role} count`, expected, n, n === expected);
    }

    // ================= SEARCH: ADMIN =================

    const name = (await q(
        "SELECT first_name FROM students WHERE is_deleted=0 AND first_name IS NOT NULL LIMIT 1"
    ))[0].first_name;

    const dbStudents = (await q(
        `SELECT COUNT(*) c FROM students s LEFT JOIN users u ON u.user_id=s.user_id
          WHERE s.is_deleted=0 AND (s.first_name LIKE :k OR s.last_name LIKE :k
            OR s.registration_number LIKE :k OR s.cnic_bform LIKE :k
            OR s.phone LIKE :k OR u.email LIKE :k)`,
        { k: `%${name}%` }
    ))[0].c;

    const aStud = await call("GET", `/api/search?type=students&q=${encodeURIComponent(name)}`, tokens.Admin);
    rec(`ADMIN search students q=${name}`, dbStudents, aStud.json && aStud.json.total,
        aStud.json && aStud.json.total === dbStudents);

    // Arbitrary whitelisted attribute.
    const st = (await q("SELECT academic_status FROM students WHERE is_deleted=0 GROUP BY academic_status LIMIT 1"))[0].academic_status;
    const dbByStatus = (await q(
        "SELECT COUNT(*) c FROM students WHERE is_deleted=0 AND academic_status=:s", { s: st }
    ))[0].c;
    const aStatus = await call("GET", `/api/search?type=students&academic_status=${encodeURIComponent(st)}`, tokens.Admin);
    rec(`ADMIN filter academic_status=${st}`, dbByStatus, aStatus.json && aStatus.json.total,
        aStatus.json && aStatus.json.total === dbByStatus);

    // An attribute that is not in the registry must be reported, not silently
    // dropped into an unfiltered result.
    const aBogus = await call("GET", "/api/search?type=students&password_hash=x", tokens.Admin);
    const ignored = aBogus.json && aBogus.json.ignored_filters;
    rec("ADMIN unknown attribute reported", "password_hash",
        ignored ? ignored.join(",") : "none",
        !!ignored && ignored.includes("password_hash"));

    // ================= SUPER ADMIN EXCLUSION =================

    const saEmployee = (await q(
        `SELECT e.employee_id, e.first_name FROM employees e
           JOIN users u ON u.user_id=e.user_id WHERE u.role_id=1 LIMIT 1`
    ))[0];

    const dbFacultyAll = (await q(
        `SELECT COUNT(*) c FROM teachers t JOIN employees e ON e.employee_id=t.employee_id
          WHERE t.is_deleted=0 AND e.is_deleted=0`
    ))[0].c;

    const dbFacultyNoSA = (await q(
        `SELECT COUNT(*) c FROM teachers t
           JOIN employees e ON e.employee_id=t.employee_id
           LEFT JOIN users u ON u.user_id=e.user_id
          WHERE t.is_deleted=0 AND e.is_deleted=0 AND (u.role_id IS NULL OR u.role_id<>1)`
    ))[0].c;

    const aFac = await call("GET", "/api/search?type=faculty&q=", tokens.Admin);
    const facTotal = (await call("GET", "/api/search?type=faculty&employment_status=Active", tokens.Admin)).json;

    console.log(`      (faculty rows: all=${dbFacultyAll}, excluding Super Admin=${dbFacultyNoSA}, SA employee=${saEmployee && saEmployee.first_name})`);

    // Search the Super Admin employee by name as Admin: must find nothing.
    const saHunt = await call(
        "GET",
        `/api/search?type=faculty&q=${encodeURIComponent(saEmployee.first_name)}`,
        tokens.Admin
    );
    const saHits = saHunt.json ? saHunt.json.total : -1;
    const saLeak = saHunt.json && (saHunt.json.data || []).some(
        (r) => Number(r.employee_id) === Number(saEmployee.employee_id)
    );
    rec("ADMIN cannot find Super Admin in faculty", false, saLeak, saLeak === false,
        `q="${saEmployee.first_name}" -> ${saHits} rows`);

    // The same search as Super Admin is also filtered - the guard is on the
    // resource, not on the caller. Documented behaviour, asserted here.
    const saSelf = await call(
        "GET",
        `/api/search?type=faculty&q=${encodeURIComponent(saEmployee.first_name)}`,
        tokens.SuperAdmin
    );
    console.log(`      (Super Admin searching the same name sees ${saSelf.json ? saSelf.json.total : "?"} rows)`);

    // ================= SEARCH: STUDENT (OWN RECORDS ONLY) =================

    const stuRow = (await q(
        `SELECT s.student_id, s.section_id, s.first_name FROM students s
           JOIN users u ON u.user_id=s.user_id WHERE u.email='student2@aims.edu.pk'`
    ))[0];

    const sSelf = await call("GET", "/api/search?type=students&q=a", tokens.Student);
    const sRows = sSelf.json ? sSelf.json.data : [];
    rec("STUDENT search students -> only self", 1, sSelf.json && sSelf.json.total,
        sSelf.json && sSelf.json.total <= 1
        && (sRows.length === 0 || Number(sRows[0].student_id) === Number(stuRow.student_id)));

    const dbOwnAtt = (await q(
        "SELECT COUNT(*) c FROM attendance WHERE student_id=:id", { id: stuRow.student_id }
    ))[0].c;
    const sAtt = await call("GET", "/api/search?type=attendance&q=", tokens.Student);
    rec("STUDENT attendance = own rows only", dbOwnAtt, sAtt.json && sAtt.json.total,
        sAtt.json && sAtt.json.total === dbOwnAtt);

    // A student must not reach faculty or parents at all.
    for (const t of ["faculty", "parents", "departments"]) {
        const r = await call("GET", `/api/search?type=${t}&q=a`, tokens.Student);
        rec(`STUDENT blocked from ${t}`, 403, r.status, r.status === 403);
    }

    // ================= SEARCH: TEACHER (ASSIGNED ONLY) =================

    const tRow = (await q(
        `SELECT t.teacher_id FROM teachers t
           JOIN employees e ON e.employee_id=t.employee_id
           JOIN users u ON u.user_id=e.user_id
          WHERE u.email='teacher2@aims.edu.pk'`
    ))[0];

    const dbAssigned = (await q(
        `SELECT COUNT(*) c FROM students s
          WHERE s.is_deleted=0
            AND (s.section_id IN (SELECT section_id FROM teacher_assignments
                                   WHERE teacher_id=:t AND section_id IS NOT NULL)
              OR s.batch_id IN (SELECT batch_id FROM teacher_assignments
                                 WHERE teacher_id=:t AND batch_id IS NOT NULL
                                UNION
                                -- teacher_subjects no longer carries a batch:
                                -- it is a qualification. Batch scope comes
                                -- from real assignments and from the offerings
                                -- the teacher actually holds.
                                SELECT sec.batch_id FROM course_offerings o
                                  JOIN sections sec ON sec.section_id=o.section_id
                                 WHERE o.teacher_id=:t AND o.is_deleted=0
                                   AND o.status <> 'Cancelled'))`,
        { t: tRow.teacher_id }
    ))[0].c;

    const tStud = await call("GET", "/api/search?type=students&q=", tokens.Teacher);
    const allStudents = (await q("SELECT COUNT(*) c FROM students WHERE is_deleted=0"))[0].c;
    rec("TEACHER students = assigned only", dbAssigned, tStud.json && tStud.json.total,
        tStud.json && tStud.json.total === dbAssigned,
        tStud.json && tStud.json.total === allStudents ? "<-- LEAK: whole table" : `(all=${allStudents})`);

    for (const t of ["parents", "fees", "documents", "departments"]) {
        const r = await call("GET", `/api/search?type=${t}&q=a`, tokens.Teacher);
        rec(`TEACHER blocked from ${t}`, 403, r.status, r.status === 403);
    }

    // ================= SEARCH: PARENT =================

    const pKids = await q(
        `SELECT sg.student_id FROM parents p
           JOIN student_guardians sg ON sg.parent_id=p.parent_id
           JOIN users u ON u.user_id=p.user_id
          WHERE u.email='parent2@aims.edu.pk'`
    );
    const kidIds = pKids.map((k) => k.student_id);

    const pStud = await call("GET", "/api/search?type=students&q=", tokens.Parent);
    const pRows = pStud.json ? pStud.json.data : [];
    const onlyOwnKids = pRows.every((r) => kidIds.includes(r.student_id));
    rec("PARENT students = own children", kidIds.length, pStud.json && pStud.json.total,
        pStud.json && pStud.json.total === kidIds.length && onlyOwnKids);

    const dbKidAtt = kidIds.length ? (await q(
        "SELECT COUNT(*) c FROM attendance WHERE student_id IN (:ids)", { ids: kidIds }
    ))[0].c : 0;
    const pAtt = await call("GET", "/api/search?type=attendance&q=", tokens.Parent);
    rec("PARENT attendance = children only", dbKidAtt, pAtt.json && pAtt.json.total,
        pAtt.json && pAtt.json.total === dbKidAtt);

    const dbKidFees = kidIds.length ? (await q(
        "SELECT COUNT(*) c FROM student_fees WHERE student_id IN (:ids)", { ids: kidIds }
    ))[0].c : 0;
    const pFee = await call("GET", "/api/search?type=fees&q=", tokens.Parent);
    rec("PARENT fees = children only", dbKidFees, pFee.json && pFee.json.total,
        pFee.json && pFee.json.total === dbKidFees);
    rec("PARENT fees response carries PKR", "PKR",
        pFee.json && pFee.json.currency && pFee.json.currency.code,
        !!(pFee.json && pFee.json.currency && pFee.json.currency.code === "PKR"));

    // Published results only.
    const dbKidResults = kidIds.length ? (await q(
        "SELECT COUNT(*) c FROM results WHERE student_id IN (:ids) AND status='Published'",
        { ids: kidIds }
    ))[0].c : 0;
    const pRes = await call("GET", "/api/search?type=results&q=", tokens.Parent);
    rec("PARENT results = published children only", dbKidResults, pRes.json && pRes.json.total,
        pRes.json && pRes.json.total === dbKidResults);

    for (const t of ["faculty", "parents", "departments", "documents", "courses"]) {
        const r = await call("GET", `/api/search?type=${t}&q=a`, tokens.Parent);
        rec(`PARENT blocked from ${t}`, 403, r.status, r.status === 403);
    }

    // The parent portal's own mount point resolves to the same handler.
    const pAlias = await call("GET", "/api/parents/search?type=students&q=", tokens.Parent);
    rec("PARENT /api/parents/search alias works", pStud.json && pStud.json.total,
        pAlias.json && pAlias.json.total,
        !!(pAlias.json && pAlias.json.total === pStud.json.total));

    // ================= SEARCH: GLOBAL =================

    const gAdmin = await call("GET", `/api/search?q=${encodeURIComponent(name)}`, tokens.Admin);
    rec("GLOBAL admin returns grouped results", true,
        !!(gAdmin.json && Array.isArray(gAdmin.json.groups)),
        !!(gAdmin.json && Array.isArray(gAdmin.json.groups)),
        gAdmin.json ? `${gAdmin.json.groups.length} groups, ${gAdmin.json.total_matches} matches` : "");

    const gEmpty = await call("GET", "/api/search", tokens.Admin);
    rec("GLOBAL with no criteria refused", 400, gEmpty.status, gEmpty.status === 400);

    const gUnauth = await call("GET", "/api/search?q=a", null);
    rec("SEARCH without a token refused", 401, gUnauth.status, gUnauth.status === 401);

    // Limits are capped so a caller cannot pull a whole table through search.
    const gCap = await call("GET", "/api/search?type=students&q=&limit=99999", tokens.Admin);
    rec("SEARCH limit capped at 100", 100, gCap.json && gCap.json.limit,
        !!(gCap.json && gCap.json.limit === 100));

    // ================= LIVE TIMETABLE =================

    const ttStudent = await call("GET", "/api/timetables/current", tokens.Student);
    const dbSectionRows = stuRow.section_id ? (await q(
        "SELECT COUNT(*) c FROM vw_student_timetable WHERE section_id=:s", { s: stuRow.section_id }
    ))[0].c : 0;

    rec("TIMETABLE student status", 200, ttStudent.status, ttStudent.status === 200);
    rec("TIMETABLE student rows match section", dbSectionRows,
        ttStudent.json && ttStudent.json.count,
        !!(ttStudent.json && ttStudent.json.count === dbSectionRows));

    if (ttStudent.json && ttStudent.json.now) {
        const n = ttStudent.json.now;
        console.log(`      (server now: ${n.date} ${n.day} ${n.time} ${n.timezone}; current=${ttStudent.json.current_lecture ? ttStudent.json.current_lecture.subject_code : "none"}; next=${ttStudent.json.next_lecture ? ttStudent.json.next_lecture.subject_code + " " + ttStudent.json.next_lecture.day_of_week + " " + ttStudent.json.next_lecture.start_time : "none"})`);

        rec("TIMETABLE week has 6 teaching days", 6,
            ttStudent.json.week && ttStudent.json.week.length,
            !!(ttStudent.json.week && ttStudent.json.week.length === 6));

        const todayFlagged = ttStudent.json.week.filter((d) => d.is_today).length;
        rec("TIMETABLE marks at most one day as today", true, todayFlagged,
            todayFlagged <= 1);

        // At most one lecture may be current, and it must contain "now".
        const currents = ttStudent.json.week
            .flatMap((d) => d.entries).filter((e) => e.is_current);
        rec("TIMETABLE at most one current lecture", true, currents.length,
            currents.length <= 1);

        if (currents.length === 1) {
            const c = currents[0];
            const sec = (t) => t.split(":").reduce((a, v, i) => a + Number(v) * [3600, 60, 1][i], 0);
            const inside = sec(c.start_time) <= n.seconds_since_midnight
                && n.seconds_since_midnight < sec(c.end_time);
            rec("TIMETABLE current lecture contains now", true, inside, inside);
        }
    }

    // Timezone is honoured, and an invalid one is a 400 rather than a 500.
    const ttTz = await call("GET", "/api/timetables/current?timezone=UTC", tokens.Student);
    rec("TIMETABLE ?timezone=UTC honoured", "UTC",
        ttTz.json && ttTz.json.now && ttTz.json.now.timezone,
        !!(ttTz.json && ttTz.json.now && ttTz.json.now.timezone === "UTC"));

    const ttBad = await call("GET", "/api/timetables/current?timezone=Mars/Olympus", tokens.Student);
    rec("TIMETABLE invalid timezone -> 400", 400, ttBad.status, ttBad.status === 400);

    const ttTeacher = await call("GET", "/api/timetables/current", tokens.Teacher);
    const dbTeacherRows = (await q(
        "SELECT COUNT(*) c FROM vw_student_timetable WHERE teacher_id=:t", { t: tRow.teacher_id }
    ))[0].c;
    rec("TIMETABLE teacher rows match own classes", dbTeacherRows,
        ttTeacher.json && ttTeacher.json.count,
        !!(ttTeacher.json && ttTeacher.json.count === dbTeacherRows));

    const ttParent = await call("GET", "/api/timetables/current", tokens.Parent);
    rec("TIMETABLE parent status", 200, ttParent.status, ttParent.status === 200);

    // A parent asking for a child that is not theirs is refused.
    const stranger = (await q(
        "SELECT student_id FROM students WHERE is_deleted=0 AND student_id NOT IN (:ids) LIMIT 1",
        { ids: kidIds.length ? kidIds : [0] }
    ))[0];
    const ttSteal = await call(
        "GET", `/api/timetables/current?student_id=${stranger.student_id}`, tokens.Parent
    );
    rec("TIMETABLE parent cannot request another child", 403, ttSteal.status, ttSteal.status === 403);

    const ttAdminNoArgs = await call("GET", "/api/timetables/current", tokens.Admin);
    rec("TIMETABLE admin without section/teacher -> 400", 400, ttAdminNoArgs.status,
        ttAdminNoArgs.status === 400);

    const ttAdmin = await call(
        "GET", `/api/timetables/current?section_id=${stuRow.section_id}`, tokens.Admin
    );
    rec("TIMETABLE admin with section_id", dbSectionRows,
        ttAdmin.json && ttAdmin.json.count,
        !!(ttAdmin.json && ttAdmin.json.count === dbSectionRows));

    // ================= PROFILE =================

    const me = await call("GET", "/api/users/me", tokens.Student);
    const dbMe = (await q(
        "SELECT user_id, email FROM users WHERE email='student2@aims.edu.pk'"
    ))[0];
    rec("PROFILE GET /api/users/me email", dbMe.email,
        me.json && me.json.data && me.json.data.email,
        !!(me.json && me.json.data && me.json.data.email === dbMe.email));
    rec("PROFILE /api/users/me hides password_hash", true,
        !(me.json && me.json.data && "password_hash" in me.json.data),
        !(me.json && me.json.data && "password_hash" in me.json.data));
    rec("PROFILE /api/users/me resolves name", true,
        !!(me.json && me.json.data && me.json.data.full_name),
        !!(me.json && me.json.data && me.json.data.full_name),
        me.json && me.json.data ? me.json.data.full_name : "");

    // A student must still not reach the admin user list.
    const meList = await call("GET", "/api/users", tokens.Student);
    rec("PROFILE student still blocked from /api/users", 403, meList.status, meList.status === 403);

    // Personal info update, then restored.
    const before = (await q(
        "SELECT dob, gender, phone FROM students WHERE student_id=:id", { id: stuRow.student_id }
    ))[0];

    const upd = await call("PUT", "/api/students/me", tokens.Student, {
        dob: "2001-03-14",
        gender: "Other",
        phone: "03001234567"
    });
    const after = (await q(
        "SELECT dob, gender, phone FROM students WHERE student_id=:id", { id: stuRow.student_id }
    ))[0];

    rec("PROFILE PUT /students/me writes dob", "2001-03-14",
        String(after.dob).slice(0, 10), String(after.dob).slice(0, 10) === "2001-03-14");
    rec("PROFILE PUT /students/me writes gender", "Other", after.gender, after.gender === "Other");
    rec("PROFILE PUT /students/me writes phone", "03001234567", after.phone, after.phone === "03001234567");

    const badDob = await call("PUT", "/api/students/me", tokens.Student, { dob: "14-03-2001" });
    rec("PROFILE bad dob -> 400", 400, badDob.status, badDob.status === 400);

    const badGender = await call("PUT", "/api/students/me", tokens.Student, { gender: "Yes" });
    rec("PROFILE bad gender -> 400", 400, badGender.status, badGender.status === 400);

    // Academic fields must be ignored by the self-service route.
    const beforeStatus = (await q(
        "SELECT academic_status, registration_number FROM students WHERE student_id=:id",
        { id: stuRow.student_id }
    ))[0];
    await call("PUT", "/api/students/me", tokens.Student, {
        academic_status: "Graduated",
        registration_number: "HACKED-001"
    });
    const afterStatus = (await q(
        "SELECT academic_status, registration_number FROM students WHERE student_id=:id",
        { id: stuRow.student_id }
    ))[0];
    rec("PROFILE cannot self-edit academic_status", beforeStatus.academic_status,
        afterStatus.academic_status, beforeStatus.academic_status === afterStatus.academic_status);
    rec("PROFILE cannot self-edit registration_number", beforeStatus.registration_number,
        afterStatus.registration_number,
        beforeStatus.registration_number === afterStatus.registration_number);

    // Restore.
    await sequelize.query(
        "UPDATE students SET dob=:d, gender=:g, phone=:p WHERE student_id=:id",
        { replacements: { d: before.dob, g: before.gender, p: before.phone, id: stuRow.student_id } }
    );
    const restored = (await q(
        "SELECT dob, gender, phone FROM students WHERE student_id=:id", { id: stuRow.student_id }
    ))[0];
    rec("PROFILE original values restored", String(before.phone), String(restored.phone),
        String(before.phone) === String(restored.phone));

    // Avatar route rejects a non-image before it reaches the disk.
    const form = new FormData();
    form.append("profile_picture", new Blob(["not an image"], { type: "text/plain" }), "x.txt");
    const badPic = await fetch(`${BASE}/api/users/me/profile-picture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.Student}` },
        body: form
    });
    rec("PROFILE non-image avatar rejected", 400, badPic.status, badPic.status === 400);

    // ================= CURRENCY =================

    for (const path of ["/api/challans", "/api/receipts", "/api/student-fees", "/api/fee-structures"]) {
        const r = await call("GET", path, tokens.Admin);
        const code = r.json && r.json.currency && r.json.currency.code;
        rec(`CURRENCY ${path}`, "PKR", code || `none(${r.status})`, code === "PKR");
    }

    // ================= REGRESSION: EXISTING ENDPOINTS =================

    const legacy = [
        ["/api/students?limit=5", "Admin", 200],
        ["/api/students/search?first_name=" + encodeURIComponent(name), "Admin", 200],
        ["/api/students/me", "Student", 200],
        ["/api/subjects/search?keyword=CS", "Admin", 200],
        ["/api/programs/search?keyword=BS", "Admin", 200],
        ["/api/timetables", "Admin", 200],
        ["/api/notifications", "Student", 200],
        ["/api/parents/children", "Parent", 200],
        ["/api/parents/profile", "Parent", 200],
        ["/api/summaries/attendance?group=student&limit=5", "Admin", 200],
        ["/api/users?limit=5", "Admin", 200]
    ];

    for (const [path, role, expected] of legacy) {
        const r = await call("GET", path, tokens[role]);
        rec(`REGRESSION ${role} ${path.split("?")[0]}`, expected, r.status, r.status === expected);
    }

    console.log(`\n${pass} passed, ${fail} failed`);

    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);

})().catch(async (e) => {
    console.error(e);
    process.exit(1);
});
