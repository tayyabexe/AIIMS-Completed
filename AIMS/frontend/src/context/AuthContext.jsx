import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { auth as authApi, parentAuth } from '../api/endpoints';
import { tabForPath, pathForTab, studentProfilePath } from '../pages/admin/adminNav';
import {
  getStoredUser,
  setSession,
  clearSession,
  setUnauthorizedHandler,
} from '../api/client';
import { ROLES, portalForRole, landingPathForRole, roleLabel } from '../api/roles';

import { loadParentData } from '../api/parentData';


const AuthContext = createContext(null);


// The session now lives in the api client under the `aims.*` keys, written
// there by setSession() when the backend returns a token. The old `aiims_user`
// key held a fabricated user and is cleared on first load so a stale mock
// session can never be mistaken for a real one.
function loadPersistedUser() {
  localStorage.removeItem('aiims_user');
  return getStoredUser();
}

function loadPersistedView() {
  return localStorage.getItem('aiims_view') || 'dashboard';
}

/*
 * LAST RESORT ONLY. Prefer `res.user.full_name`.
 *
 * `users.full_name` now carries the account holder's name for every role, so
 * this runs only for an account created before that column existed and never
 * since named. It is kept because returning nothing at all would render an
 * empty greeting, and a wrong-looking name is easier to notice and correct
 * than a blank one.
 *
 * This function is the reason administrators were greeted as "Admin2" — it was
 * the only name the frontend had, and being computed at render time there was
 * nowhere for an admin to fix it. It is no longer the primary path.
 */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'User';
}

/*
 * The last-resort wording for a sign-in that fails without the server saying
 * why. It matches GENERIC_FAILURE in backend/src/services/loginSecurity.js
 * word for word, because a second phrasing appearing only in certain cases is
 * itself a signal.
 *
 * There used to be a separate 'Invalid credentials, or wrong portal selected.'
 * here, shown when the credentials were valid but belonged to another portal.
 * It gave the game away twice over: seeing it at all meant the password was
 * right, and the 200 response that produced it carried a real token. The
 * portal is now checked by the server before any token exists, and a mismatch
 * comes back as an ordinary failed attempt like everything else.
 */
const SIGN_IN_FAILED = 'Email or password is incorrect.';

// Which roles cause this provider to fetch into `students`.
//
// Only Parent now: a parent's loader pulls their own children, which is a
// handful of rows. Admin used to be here too and pulled the entire student
// table; its screens each load their own page from /api/admin/* instead.
//
// Getting this list right matters because `studentsLoading` is seeded from it:
// a role that never fetches must not start out loading, or its screens wait
// forever on a request nobody makes.
function roleFetchesStudents(account) {
  if (!account) return false;
  return Number(account.roleId) === ROLES.PARENT;
}

export function AuthProvider({ children }) {
  // The shared server-state cache, so signing out can empty it. Available
  // because QueryClientProvider is mounted above this one in App.jsx.
  const queryClient = useQueryClient();

  /*
   * Which admin module is showing is decided by the URL, not by a piece of
   * state beside it.
   *
   * It used to be the other way round: `adminSubTab` was ordinary state, the
   * sidebar set it directly, and the address bar was never touched. Every
   * screen in the portal therefore lived at whichever URL you arrived on, so
   * no module could be bookmarked, linked to, opened in a second tab or
   * reached with the back button — which left the portal altogether.
   *
   * Deriving the tab from the path and making the setter navigate means all
   * ~20 existing setAdminSubTab() call sites now change the URL as well,
   * without any of them having to be rewritten.
   */
  const location = useLocation();
  const navigate = useNavigate();

  const adminSubTab = tabForPath(location.pathname);

  const setAdminSubTab = useCallback((tab) => {
    navigate(pathForTab(tab));
  }, [navigate]);

  const [currentView, setCurrentView] = useState(loadPersistedView);
  const [user, setUser] = useState(loadPersistedUser);

  // Students now come from the backend. They start empty and are filled by the
  // loader below once an admin session exists.
  const [students, setStudents] = useState([]);
  // Starts true when the restored session belongs to a role that will fetch
  // below. Starting at false meant the very first paint after sign-in — before
  // the effect had even run — showed a fully drawn dashboard reporting zero
  // students, zero fees and empty charts, then snapped to the real numbers.
  const [studentsLoading, setStudentsLoading] = useState(() => roleFetchesStudents(user));
  const [studentsError, setStudentsError] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [batches, setBatches] = useState([]);
  const [sections, setSections] = useState([]);

  // Parents come from GET /api/parents, which lists each parent with their
  // linked children.
  const [parents, setParents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState(null);

  /*
   * The admin alert list used to be generated here from `students`.
   *
   * With the portal-wide student load removed, that array is empty for an
   * admin — and generating alerts from it produced confident falsehoods:
   * "0 active students across 0 programs (0 total enrolled)". The alerts moved
   * to hooks/useAdminAlerts.js, which counts the same conditions from
   * GET /api/admin/dashboard.
   */

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Signs in every role except Parent, which has its own endpoint below.
  // `expectedPortal` is the portal the user picked on the sign-in screen; a
  // valid account for a different portal is rejected rather than redirected.
  const loginAsAdmin = useCallback(async (email, password, expectedPortal) => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      // The chosen portal goes WITH the credentials now, so a mismatch is
      // refused by the server before a token is ever minted.
      const res = await authApi.login(email, password, expectedPortal);
      const roleId = Number(res.user.role_id);
      const portal = portalForRole(roleId);

      /*
       * Kept as a belt-and-braces check for the case the server did not do it
       * — an older backend that ignores `portal`. It no longer has its own
       * wording: whatever reason a sign-in failed for, the user is told the
       * same thing.
       */
      if (expectedPortal && portal !== expectedPortal) {
        clearSession();
        setAuthError(SIGN_IN_FAILED);
        return { ok: false, error: SIGN_IN_FAILED };
      }

      const account = {
        userId: res.user.user_id,
        email: res.user.email,
        roleId,
        role: portal,
        roleName: roleLabel(roleId),

        /*
         * The account's own name, from `users.full_name`, with the email
         * derivation kept only as a fallback for accounts that predate the
         * column.
         *
         * A portal that loads a richer profile later — a student's registered
         * name, a teacher's employee record — may still refine this through
         * ChatbotContext.configure. This is the value everything renders until
         * then, and it is now a stored fact rather than a guess.
         */
        name: (res.user.full_name || '').trim() || nameFromEmail(res.user.email),
        /*
         * True when this account is still using a password the administration
         * office generated and read off a screen. ProtectedRoute sends the
         * user to /change-password until they pick their own; the backend
         * clears the flag when they do.
         */
        mustChangePassword: !!res.user.must_change_password,
      };

      setSession(res.token, account);
      // Raise the flag with the user, not in the effect that follows it, so the
      // portal never renders a zeroed screen in between.
      if (roleFetchesStudents(account)) setStudentsLoading(true);
      setUser(account);

      const view = portal === 'parent' ? 'parent' : 'dashboard';
      setCurrentView(view);
      localStorage.setItem('aiims_view', view);

      return { ok: true, user: account, redirectTo: landingPathForRole(roleId) };

    } catch (err) {
      setAuthError(err.message);
      return { ok: false, error: err.message };

    } finally {
      setAuthLoading(false);
    }
  }, []);

  // Parents authenticate against /api/parent/login, which returns the parent
  // record instead of a users row and carries no role_id.
  const loginAsParent = useCallback(async (email, password) => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      const res = await parentAuth.login(email, password);
      const parent = res.parent || {};

      const account = {
        userId: parent.user_id,
        parentId: parent.parent_id,
        email,
        roleId: ROLES.PARENT,
        role: 'parent',
        roleName: roleLabel(ROLES.PARENT),
        name: [parent.first_name, parent.last_name].filter(Boolean).join(' ')
          || nameFromEmail(email),

        /*
         * Same meaning as on the admin/faculty/student branch above, and read
         * for the same reason: a parent's login is created by the admission
         * flow with a generated password that an administrator has seen.
         *
         * This was missing, which is the whole of the bug. `mustChangePassword`
         * was simply undefined on a parent account, so the guard in
         * ProtectedRoute never fired, the parent was never taken to
         * /change-password, and User Management kept reporting them as never
         * having changed it. The endpoint worked the whole time — nothing sent
         * the parent to the screen that calls it.
         */
        mustChangePassword: !!res.must_change_password,
      };

      setSession(res.token, account);
      setStudentsLoading(true);
      setUser(account);
      setCurrentView('parent');
      localStorage.setItem('aiims_view', 'parent');

      return { ok: true, user: account, redirectTo: landingPathForRole(ROLES.PARENT) };

    } catch (err) {
      /*
       * A non-parent account reaching this endpoint used to get a 403 that
       * this line translated into "wrong portal selected" — which told the
       * person at the keyboard that the password had been accepted. The
       * backend now answers it as an ordinary failed attempt, so there is
       * nothing left to translate and the server's own message is shown.
       */
      const message = err.message || SIGN_IN_FAILED;
      setAuthError(message);
      return { ok: false, error: message };

    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Fire and forget: the backend logout is stateless, so a failure here
    // must not stop the local session from being cleared.
    authApi.logout().catch(() => {});

    /*
     * Empty the shared server-state cache.
     *
     * Everything it holds was fetched with the outgoing account's token and
     * scoped to that account — a teacher's class list, a parent's children, a
     * student's marks. Left in place, the next person to sign in on this
     * machine would be served the previous one's rows from cache before their
     * own request returned. `clear()` rather than `invalidateQueries()`,
     * because invalidating keeps the old data on screen while it refetches,
     * which is precisely what must not happen here.
     */
    queryClient.clear();

    clearSession();
    setUser(null);
    setAuthError(null);
    setStudents([]);
    setStudentsLoading(false);
    setStudentsError(null);
    setParentData(null);
    setCurrentView('portals');
    // The module no longer needs clearing here: it is read from the URL, and
    // ProtectedRoute sends a signed-out visitor to the sign-in page anyway.
    localStorage.removeItem('aiims_view');
  }, [queryClient]);

  // An expired or rejected token clears the session from inside the api client.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setCurrentView('portals');
      setStudents([]);
      // Without this the portal is left showing a spinner after the token is
      // rejected, because nothing else clears the in-flight flag.
      setStudentsLoading(false);
      setStudentsError(null);
    });
  }, []);

  /*
   * THE ADMIN BULK LOAD IS GONE.
   *
   * This used to call loadAdminData() the moment an admin signed in, which
   * fired ten general-purpose list endpoints in parallel and held the result
   * here for every screen to read. Measured against the live database:
   *
   *   /api/students               916 KB   /api/parents             695 KB
   *   /api/summaries/fee-status   676 KB   /api/summaries/attendance 297 KB
   *   /api/student-results        281 KB   /api/marks/summary       175 KB
   *   + programs / batches / sections / grades
   *   = 3.04 MB and ~6.5s of database work before ANY screen could render.
   *
   * It was paid in full whether the admin went on to open the Students list or
   * the Settings page, and it grew with the institute: every new student made
   * every screen slower.
   *
   * Each admin screen now calls its own endpoint under /api/admin/*, returning
   * only that screen's columns for one page — see api/endpoints.js. The
   * dashboard went from 3.04 MB to 485 bytes.
   *
   * `students` and `parents` below are NOT dead: the parent portal's loader
   * writes each parent's own children into them, and that is a handful of rows
   * scoped to one family. Only the admin-wide fetch has been removed.
   */
  const refreshStudents = useCallback(async () => null, []);

  // A parent gets only their own children, through the /api/parent/* endpoints.
  // They are put into the same `students` / `parents` state the dashboard
  // already reads, so that screen needed no changes.
  const [parentData, setParentData] = useState(null);
  const isParent = !!user && user.roleId === ROLES.PARENT;

  /*
   * Loads the family bundle. Extracted from the effect below so it can be
   * called again on demand.
   *
   * THE BUG THIS EXISTS FOR
   * -----------------------
   * The bundle was fetched exactly once, when the parent signed in, and every
   * parent screen reads its figures out of it. So a parent who declared a fee
   * payment saw the server accept it, saw the confirmation message — and then
   * saw the fee screen go on showing the position from before they submitted,
   * for the rest of the session. The "Submit payment" button stayed offered
   * against a voucher that was now fully claimed, and pressing it a second
   * time was refused by the server as "already settled or fully claimed".
   *
   * That is the same fault that was fixed on the student portal, where the
   * profile provider's `reload()` is called after a successful submit. The
   * parent portal had no equivalent, so the fix could not be applied there.
   * This is it.
   *
   * `silent` skips the loading flag: a refresh after an action the parent has
   * already been told succeeded should update the numbers in place, not blank
   * the portal back to a skeleton.
   */
  const fetchParentData = useCallback(async (currentUser, { silent = false } = {}) => {
    if (!silent) {
      setStudentsLoading(true);
      setStudentsError(null);
    }

    try {
      const data = await loadParentData(currentUser);
      setParentData(data);
      setStudents(data.students);
      setParents(data.parents);
      setSelectedStudentId((current) => current ?? data.students[0]?.id ?? null);
      return data;
    } catch (err) {
      // A silent refresh that fails leaves the last good figures on screen
      // rather than replacing a working portal with an error page.
      if (!silent) setStudentsError(err.message);
      return null;
    } finally {
      if (!silent) setStudentsLoading(false);
    }
  }, [setSelectedStudentId]);

  useEffect(() => {
    if (!isParent) return;
    let cancelled = false;

    (async () => {
      setStudentsLoading(true);
      setStudentsError(null);

      try {
        const data = await loadParentData(user);
        if (cancelled) return;

        setParentData(data);
        setStudents(data.students);
        setParents(data.parents);
        setSelectedStudentId((current) => current ?? data.students[0]?.id ?? null);

      } catch (err) {
        if (!cancelled) setStudentsError(err.message);
      } finally {
        if (!cancelled) setStudentsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isParent, user]);

  /**
   * Re-reads the family bundle from /api/parent/*.
   *
   * Called by any parent screen that has just changed something the bundle
   * reports — today that is the fee declaration flow. Silent by default,
   * because the caller has already told the parent the action succeeded.
   */
  const reloadParentData = useCallback(
    () => (isParent ? fetchParentData(user, { silent: true }) : Promise.resolve(null)),
    [isParent, user, fetchParentData],
  );

  /*
   * Opening a student's profile puts their id in the URL, so a profile can be
   * linked to, bookmarked and reloaded. The id stays in state as well because
   * the screens read it from there, but the URL is what survives a refresh.
   */
  /*
   * Called by the change-password screen once the server has accepted the new
   * password. Mirrors the backend clearing must_change_password, so the guard
   * in ProtectedRoute stops redirecting without needing a fresh sign-in.
   */
  const clearMustChangePassword = useCallback(() => {
    setUser((current) => {
      if (!current) return current;
      const updated = { ...current, mustChangePassword: false };
      setSession(null, updated);
      return updated;
    });
  }, []);

  /*
   * Opening a student's profile.
   *
   * The destination is /students/:id — underneath the list the student was
   * clicked in — rather than the old top-level /student-profile. Called with no
   * id it goes to the list, because a profile with no student to show was the
   * dead end that route existed as.
   */
  const viewStudentProfile = useCallback((studentId) => {
    setSelectedStudentId(studentId);
    navigate(studentProfilePath(studentId));
  }, [navigate, setSelectedStudentId]);

  return (
    <AuthContext.Provider value={{
      adminSubTab, setAdminSubTab,
      currentView, setCurrentView,
      user, loginAsAdmin, loginAsParent, logout,
      authLoading, authError, isAuthenticated: !!user,
      students, setStudents,
      studentsLoading, studentsError, refreshStudents,
      programs, batches, sections,
      // The parent loader writes into the same students/loading/error state the
      // admin loader uses, so these are aliases rather than separate flags —
      // exposed under parent-shaped names so parent screens read clearly.
      parentData,
      parentLoading: studentsLoading,
      parentError: studentsError,
      reloadParentData,
      parents, setParents,
      selectedStudentId, setSelectedStudentId,
      viewStudentProfile,
      clearMustChangePassword,

    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
