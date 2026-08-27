// Role IDs and the role -> portal mapping. This is the ONLY place in the
// frontend that knows what a role number means; change it here and every
// redirect, guard and label follows.
//
// These values mirror the backend `roles` table as documented in
// backend/src/testing/API_TEST_PLAN.md and backend/src/config/roles.js.
// If your database numbers Teacher and Student the other way round, swap
// TEACHER and STUDENT below and nothing else needs to change.

export const ROLES = {
  SUPER_ADMIN: 1,
  ADMIN: 2,
  TEACHER: 3,
  STUDENT: 4,
  PARENT: 5,
  HR: 6,
  ACCOUNTANT: 7,
  LIBRARY: 8,
};

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.TEACHER]: 'Teacher',
  [ROLES.STUDENT]: 'Student',
  [ROLES.PARENT]: 'Parent',
  [ROLES.HR]: 'HR',
  [ROLES.ACCOUNTANT]: 'Accountant',
  [ROLES.LIBRARY]: 'Library Staff',
};

// Which portal a role lands in after signing in.
export const PORTALS = {
  ADMIN: 'admin',
  FACULTY: 'faculty',
  STUDENT: 'student',
  PARENT: 'parent',
};

const ROLE_TO_PORTAL = {
  [ROLES.SUPER_ADMIN]: PORTALS.ADMIN,
  [ROLES.ADMIN]: PORTALS.ADMIN,
  [ROLES.TEACHER]: PORTALS.FACULTY,
  [ROLES.STUDENT]: PORTALS.STUDENT,
  [ROLES.PARENT]: PORTALS.PARENT,
  // Staff roles have no portal of their own yet and use the admin views.
  [ROLES.HR]: PORTALS.ADMIN,
  [ROLES.ACCOUNTANT]: PORTALS.ADMIN,
  [ROLES.LIBRARY]: PORTALS.ADMIN,
};

const PORTAL_LANDING = {
  [PORTALS.ADMIN]: '/dashboard',
  [PORTALS.FACULTY]: '/faculty/dashboard',
  [PORTALS.STUDENT]: '/student/dashboard',
  [PORTALS.PARENT]: '/parent/dashboard',
};

/*
 * The three staff roles land in the admin portal but cannot open its dashboard:
 * GET /api/admin/dashboard is guarded by authorize(...ADMINS), which is only
 * Super Admin and Admin. Sending them to /dashboard meant every one of them
 * signed in to a 403 as their first screen.
 *
 * Each goes to the first module it can actually load — see ROLE_MODULES in
 * pages/admin/adminNav.js, which this must stay in step with.
 */
const ROLE_LANDING = {
  [ROLES.ACCOUNTANT]: '/fee-management',
  [ROLES.HR]: '/notifications',
  [ROLES.LIBRARY]: '/notifications',
};

export const portalForRole = (roleId) => ROLE_TO_PORTAL[Number(roleId)] || null;

export const landingPathForRole = (roleId) =>
  ROLE_LANDING[Number(roleId)]
  || PORTAL_LANDING[portalForRole(roleId)]
  || '/choose-portal';

export const roleLabel = (roleId) => ROLE_LABELS[Number(roleId)] || 'User';

// True when the signed-in role is allowed into the given portal.
export const canAccessPortal = (roleId, portal) => portalForRole(roleId) === portal;
