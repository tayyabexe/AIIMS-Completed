// Single source of truth for role IDs and the role groups passed to
// authorize(). These values mirror the `roles` table.
//
// Before this file existed the numbers were written inline in every route
// file, which is how Super Admin ended up locked out of most modules: those
// routes said authorize(2) and never included role 1.

const ROLES = {
    SUPER_ADMIN: 1,
    ADMIN: 2,
    TEACHER: 3,
    STUDENT: 4,
    PARENT: 5,
    HR: 6,
    ACCOUNTANT: 7,
    LIBRARY: 8
};

// Full management access. Super Admin is allowed everywhere Admin is.
const ADMINS = [ROLES.SUPER_ADMIN, ROLES.ADMIN];

// Reads a teacher needs for their own portal. Writes stay on ADMINS.
const ADMIN_TEACHER = [...ADMINS, ROLES.TEACHER];

// Reads a student needs for their own portal. Writes stay on ADMINS.
const ADMIN_STUDENT = [...ADMINS, ROLES.STUDENT];

// Academic reference data (subjects, timetables) that every portal reads.
const ADMIN_TEACHER_STUDENT = [...ADMINS, ROLES.TEACHER, ROLES.STUDENT];

// The same academic reference data, plus Parent.
//
// `subjects` and `semesters` are catalogue tables: a subject code, its name and
// credit hours, and the numbering of a programme's semesters. They carry no
// personal data and name no student, so a parent reading them learns nothing
// about anyone else's child.
//
// Excluding Parent from ADMIN_TEACHER_STUDENT meant the parent portal's calls
// to GET /api/subjects and GET /api/semesters came back 403. The portal builds
// its lookup maps from those responses, so every timetable row rendered its
// subject as a dash and every "Semester N" label had nothing to resolve. The
// failure was silent because the loader gathers these with Promise.allSettled.
const ACADEMIC_REFERENCE = [...ADMIN_TEACHER_STUDENT, ROLES.PARENT];

/*
 * Which portal a role belongs to.
 *
 * Mirrors ROLE_TO_PORTAL in frontend/src/api/roles.js, and exists here because
 * the portal a sign-in was attempted from is now checked BEFORE a token is
 * issued. It used to be checked only in the browser: the backend happily
 * returned 200 and a valid token for a teacher signing in on the student
 * portal, and AuthContext threw the token away. The rejection was real, but
 * the 200 on the wire confirmed the password to anyone watching.
 */
const PORTALS = {
    ADMIN: "admin",
    FACULTY: "faculty",
    STUDENT: "student",
    PARENT: "parent"
};

const ROLE_TO_PORTAL = {
    [ROLES.SUPER_ADMIN]: PORTALS.ADMIN,
    [ROLES.ADMIN]: PORTALS.ADMIN,
    [ROLES.TEACHER]: PORTALS.FACULTY,
    [ROLES.STUDENT]: PORTALS.STUDENT,
    [ROLES.PARENT]: PORTALS.PARENT,
    // The staff roles have no portal of their own and use the admin views.
    [ROLES.HR]: PORTALS.ADMIN,
    [ROLES.ACCOUNTANT]: PORTALS.ADMIN,
    [ROLES.LIBRARY]: PORTALS.ADMIN
};

const portalForRole = (roleId) => ROLE_TO_PORTAL[Number(roleId)] || null;

module.exports = {
    ROLES,
    PORTALS,
    portalForRole,
    ADMINS,
    ADMIN_TEACHER,
    ADMIN_STUDENT,
    ADMIN_TEACHER_STUDENT,
    ACADEMIC_REFERENCE
};
