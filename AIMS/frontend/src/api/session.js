// The signed-in session, scoped to ONE BROWSER TAB, with a PER-PORTAL seed.
//
// THE ORIGINAL BUG (why the tab session exists)
// ---------------------------------------------
// The session used to live in localStorage, which every tab of an origin
// shares. Signing into the Faculty portal in a second tab therefore overwrote
// the token the Admin tab was already using, and the admin tab — still showing
// the admin UI, still holding an admin `user` object in React state — began
// sending a teacher's JWT with every request. The chatbot was simply where it
// became visible; every request in the app had the same fault.
//
// The fix for that was sessionStorage: per-tab, survives a reload, and nothing
// another tab does can reach it. That part is unchanged.
//
// THE SECOND BUG (why the seed is now per-portal)
// -----------------------------------------------
// A brand-new tab has no sessionStorage of its own, so it "adopts" a seed kept
// in localStorage — that is what lets "open link in new tab" and a browser
// restart keep you signed in. But the seed used to be a SINGLE slot, so it held
// whichever portal signed in LAST. Opening a Faculty URL in a new tab while a
// Student was the most recent sign-in adopted the STUDENT seed, the guard saw a
// student on a faculty route, and it bounced you to the student dashboard (or,
// if nothing usable was there, to the sign-in page). Reported as "open in new
// tab jumps me to the student portal".
//
// HOW IT WORKS NOW
// ----------------
// The seed is keyed by PORTAL: aims.token.<portal> / aims.user.<portal>, one
// slot each for admin | faculty | student | parent. A new tab adopts the seed
// for the portal ITS URL belongs to, so a Faculty tab restores the faculty
// session and a Student tab restores the student one, and you can be signed
// into several portals in several tabs at the same time without any of them
// moving the others. After that single adoption at load the tab is pinned to
// its own sessionStorage and never reads a seed again.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It does not keep two tabs of the SAME account in step. That was never broken,
// and a "session" that reaches across tabs to correct them is how the very
// first bug happened.

import { portalForRole } from './roles';

const TAB_TOKEN_KEY = 'aims.token';
const TAB_USER_KEY = 'aims.user';

// Per-portal seed slots. The bare `aims.token` / `aims.user` keys are the OLD
// single seed; they are read once for migration and then left alone.
const LEGACY_TOKEN_KEY = 'aims.token';
const LEGACY_USER_KEY = 'aims.user';
const LAST_PORTAL_KEY = 'aims.seed.portal';

const KNOWN_PORTALS = ['admin', 'faculty', 'student', 'parent'];

const seedTokenKey = (portal) => `aims.token.${portal}`;
const seedUserKey = (portal) => `aims.user.${portal}`;

/*
 * Storage that cannot throw.
 *
 * Safari in private mode, and any browser with site data blocked, throw on
 * setItem rather than failing quietly. A sign-in must not break there — the
 * session simply lasts as long as the page does, which is the honest outcome
 * of storage being unavailable.
 */
const safe = (store) => {
  // One map per wrapper, never a shared one — see the long note below.
  const memory = new Map();
  return {
    get(key) {
      try {
        const value = store ? store.getItem(key) : null;
        return value === null || value === undefined
          ? memory.get(key) ?? null
          : value;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        if (store) store.setItem(key, value);
      } catch { /* storage unavailable; memory holds it for this page */ }
    },
    remove(key) {
      memory.delete(key);
      try {
        if (store) store.removeItem(key);
      } catch { /* nothing to do */ }
    },
  };
};

const hasWindow = typeof window !== 'undefined';

// This tab's own session — a single identity for the whole tab.
const tab = safe(hasWindow ? window.sessionStorage : null);

// The per-portal seeds a brand-new tab may adopt, and only then.
const seed = safe(hasWindow ? window.localStorage : null);

/**
 * Which portal a stored user object belongs to.
 *
 * Prefers the numeric roleId (authoritative, mapped in api/roles.js); falls
 * back to a role string already normalised to a portal name.
 */
const portalOfUser = (user) => {
  if (!user) return null;
  const byId = portalForRole(user.roleId ?? user.role_id);
  if (byId) return byId;
  const role = String(user.role || '').toLowerCase();
  if (role === 'teacher' || role === 'faculty') return 'faculty';
  if (role === 'student') return 'student';
  if (role === 'parent') return 'parent';
  if (role === 'admin' || role === 'super_admin') return 'admin';
  return null;
};

const parseUser = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * The portal a path belongs to, so a brand-new tab knows which seed to adopt.
 *
 * Faculty, student and parent live under their own path prefixes. The admin
 * portal mounts its modules at bare paths (/dashboard, /fee-management,
 * /enrollments, …), so anything that is not one of the others and is not a
 * public page is treated as admin. Public and cross-portal pages (/, the portal
 * chooser, forgot/change-password) return null: they carry no portal of their
 * own and adopt nothing here.
 */
export const portalForPath = (pathname) => {
  const p = String(pathname || '/').toLowerCase();
  if (p.startsWith('/faculty')) return 'faculty';
  if (p.startsWith('/student')) return 'student';
  if (p.startsWith('/parent')) return 'parent';
  const signIn = p.match(/^\/sign-in\/([^/]+)/);
  if (signIn && KNOWN_PORTALS.includes(signIn[1])) return signIn[1];
  if (
    p === '/' || p === '/choose-portal' || p === '/sign-in'
    || p === '/forgot-password' || p === '/change-password'
    || p === '/admin-signup'
  ) {
    return null;
  }
  return 'admin';
};

/*
 * One-time migration of the OLD single seed into a per-portal slot.
 *
 * A user who was signed in before this change has a bare aims.token/aims.user
 * pair and no per-portal seed. Read that pair once, file it under the portal
 * its own user object names, and drop the bare keys so they cannot be adopted
 * by the wrong portal ever again.
 */
(function migrateLegacySeed() {
  const legacyToken = seed.get(LEGACY_TOKEN_KEY);
  const legacyUserRaw = seed.get(LEGACY_USER_KEY);
  if (!legacyToken || !legacyUserRaw) return;

  const portal = portalOfUser(parseUser(legacyUserRaw));
  if (portal && !seed.get(seedTokenKey(portal))) {
    seed.set(seedTokenKey(portal), legacyToken);
    seed.set(seedUserKey(portal), legacyUserRaw);
    seed.set(LAST_PORTAL_KEY, portal);
  }
  // The bare keys are the tab keys too, so only remove them from the SEED
  // (localStorage), never from this tab's sessionStorage.
  try {
    if (hasWindow) {
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      window.localStorage.removeItem(LEGACY_USER_KEY);
    }
  } catch { /* storage unavailable */ }
})();

/*
 * Adoption, run once when this module is first imported.
 *
 * The order matters: this has to happen before anything reads getToken(), or
 * the first request of a restored session goes out unauthenticated. Module
 * scope guarantees that, because every consumer imports this module.
 *
 * A tab that already has a token is left completely alone. Otherwise the portal
 * is read from the URL and only THAT portal's seed is adopted — which is the
 * whole fix: a faculty URL never adopts a student seed. /change-password is the
 * one authenticated page with no portal in its path, so it falls back to the
 * seed written most recently.
 */
(function adoptSeedForThisTab() {
  if (tab.get(TAB_TOKEN_KEY)) return;

  const path = hasWindow ? window.location.pathname : '/';
  let portal = portalForPath(path);
  if (!portal && path.toLowerCase() === '/change-password') {
    portal = seed.get(LAST_PORTAL_KEY);
  }
  if (!portal) return;

  const token = seed.get(seedTokenKey(portal));
  if (!token) return;

  tab.set(TAB_TOKEN_KEY, token);
  const user = seed.get(seedUserKey(portal));
  if (user) tab.set(TAB_USER_KEY, user);
})();

export const getToken = () => tab.get(TAB_TOKEN_KEY);

export const getStoredUser = () => parseUser(tab.get(TAB_USER_KEY));

/**
 * The user id this tab believes it is acting as.
 *
 * Sent with every request so the server can reject a mismatch outright rather
 * than answering as somebody the UI is not showing. See
 * middlewares/auth.middleware.js.
 */
export const getActingUserId = () => {
  const user = getStoredUser();
  const id = user?.userId ?? user?.user_id ?? null;
  return id === null || id === undefined ? null : String(id);
};

/**
 * Records a sign-in, or refreshes the stored user after a profile edit.
 *
 * `token` may be null, which means "keep the current token and just update the
 * user" — AuthContext uses that after an avatar or name change.
 *
 * The seed is written under the user's OWN portal, so signing into one portal
 * never disturbs another portal's seed.
 */
export const setSession = (token, user) => {
  if (token) tab.set(TAB_TOKEN_KEY, token);
  if (user) tab.set(TAB_USER_KEY, JSON.stringify(user));

  // The seed is keyed by portal. Use the incoming user, or fall back to the
  // one already in this tab (the token-only refresh case).
  const forUser = user || getStoredUser();
  const portal = portalOfUser(forUser);
  if (!portal) return;

  if (token) seed.set(seedTokenKey(portal), token);
  if (forUser) seed.set(seedUserKey(portal), JSON.stringify(forUser));
  seed.set(LAST_PORTAL_KEY, portal);
};

/**
 * Signs this tab out.
 *
 * The tab's own session always goes. The SEED for THIS tab's portal goes only
 * if it still belongs to this same session — so signing out of the admin tab
 * cannot delete a faculty tab's seed, and a stale seed from a different login
 * is left for its owner. Other portals' seeds are never touched.
 */
export const clearSession = () => {
  const ownToken = tab.get(TAB_TOKEN_KEY);
  const portal = portalOfUser(getStoredUser());

  tab.remove(TAB_TOKEN_KEY);
  tab.remove(TAB_USER_KEY);

  if (portal && ownToken && seed.get(seedTokenKey(portal)) === ownToken) {
    seed.remove(seedTokenKey(portal));
    seed.remove(seedUserKey(portal));
    if (seed.get(LAST_PORTAL_KEY) === portal) seed.remove(LAST_PORTAL_KEY);
  }
};

export const SESSION_KEYS = { TOKEN_KEY: TAB_TOKEN_KEY, USER_KEY: TAB_USER_KEY };
