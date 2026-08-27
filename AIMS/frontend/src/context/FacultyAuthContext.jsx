import { createContext, useContext, useMemo } from 'react';
import { useAuth as useMainAuth } from './AuthContext';
import { ROLES } from '../api/roles';

// ---------------------------------------------------------------------------
// RBAC permissions. Backend (Express) would enforce the same matrix; here it is
// enforced in the frontend simulation so the demo behaves identically.
// ---------------------------------------------------------------------------
export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  teacher: 'Teacher',
  student: 'Student',
};

export const PERMISSIONS = {
  super_admin: ['*'],
  admin: ['manage_users', 'assign_subjects', 'manage_assignments', 'manage_attendance', 'manage_marks', 'view_reports', 'export_reports', 'view_analytics', 'manage_announcements'],
  teacher: ['manage_assignments', 'manage_attendance', 'manage_marks', 'view_reports', 'export_reports', 'view_students', 'view_analytics'],
  student: ['submit_assignments', 'view_own'],
};

export function canAccess(role, permission) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

const AuthContext = createContext(null);

// The permission matrix above is keyed by role name, but the backend issues
// numeric role ids, so the signed-in role is translated once here.
const ROLE_NAME_BY_ID = {
  [ROLES.SUPER_ADMIN]: 'super_admin',
  [ROLES.ADMIN]: 'admin',
  [ROLES.TEACHER]: 'teacher',
  [ROLES.STUDENT]: 'student',
};

// This provider no longer holds a session of its own. It reads the one real
// JWT session from AuthContext, so the faculty portal cannot be entered
// without logging in and its API calls carry the same token as every other
// portal. It previously handed out a demo teacher to anyone who opened the
// URL, which is why /faculty/dashboard was reachable without a password.
export function AuthProvider({ children }) {
  const { user: account, logout: mainLogout } = useMainAuth();

  const value = useMemo(() => {
    const role = account ? ROLE_NAME_BY_ID[account.roleId] : null;

    const user = account
      ? {
          id: account.userId,
          name: account.name,
          email: account.email,
          role,
          designation: account.roleName,
        }
      : null;

    return {
      user,
      // Sign-in happens on the shared sign-in screen; kept so existing
      // callers do not crash if they still reference it.
      login: () => {},
      logout: mainLogout,
      can: (permission) => canAccess(role, permission),
      isAdmin: role === 'super_admin' || role === 'admin',
      isTeacher: role === 'teacher',
      isStudent: role === 'student',
    };
  }, [account, mainLogout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
