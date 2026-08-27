// The single HTTP client for the AIMS backend.
//
// Everything that talks to the API goes through request() so that the token
// header, JSON handling, timeouts and error shape are identical everywhere.
// No component should call fetch() against the backend directly.

import {
  getToken as readToken,
  getActingUserId,
  clearSession as dropSession,
} from './session';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT || 30000);

/*
 * The session lives in api/session.js, scoped to one browser tab.
 *
 * It used to be four lines of localStorage right here, and that was the cause
 * of a real cross-role bug: localStorage is shared by every tab of an origin,
 * so signing into a second portal replaced the first tab's token and every
 * request that tab made afterwards ran as the wrong person. Re-exported rather
 * than moved wholesale so that the dozens of callers already importing
 * `getToken` and `setSession` from this module keep working.
 */
export {
  getToken,
  getStoredUser,
  setSession,
  clearSession,
  getActingUserId,
} from './session';

// Lets AuthContext react to a 401 without this module importing React.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// ------------------------------------------------------------------ error

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, fieldErrors = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.fieldErrors = fieldErrors;
  }
}

// The backend reports validation failures as { errors: [{ msg, path }] } from
// express-validator, and everything else as { message }.
const toErrorMessage = (body, status) => {
  if (body && Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map((e) => e.msg || e.message).filter(Boolean).join(', ');
  }
  if (body && body.message) return body.message;
  return `Request failed (${status})`;
};

// --------------------------------------------------------------- trimming

/*
 * Values whose whitespace is part of the secret. Kept in step with
 * PRESERVED_KEYS in backend/src/middlewares/sanitize.middleware.js — trimming
 * a password here would change the credential before it was ever sent.
 */
const PRESERVED_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'confirmpassword',
  'oldpassword', 'passwordhash', 'passwordconfirmation',
  'token', 'resettoken', 'refreshtoken', 'accesstoken',
]);

const isPreserved = (key) =>
  PRESERVED_KEYS.has(String(key).toLowerCase().replace(/[-_\s]/g, ''));

/*
 * Edge-trims every string in an outgoing payload.
 *
 * The server does this too, and the server is the one that counts — this is
 * not the guard. What it buys is that the value the user sees echoed back
 * matches what they typed into the field they just left, and that a form
 * comparing its state against the saved record (the student edit dialog builds
 * its diff that way) does not report a change when the only difference is a
 * space the server was going to drop anyway.
 *
 * Returns new objects rather than mutating: the argument is usually a
 * component's state, and rewriting it under React would be a real bug.
 */
const MAX_DEPTH = 8;

const trimDeep = (value, depth = 0) => {
  if (typeof value === 'string') return value.trim();
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return value;

  // FormData, File, Blob and Date are passed through untouched.
  if (typeof FormData !== 'undefined' && value instanceof FormData) return value;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (value instanceof Date) return value;

  if (Array.isArray(value)) return value.map((item) => trimDeep(item, depth + 1));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isPreserved(key) ? item : trimDeep(item, depth + 1);
  }
  return out;
};

export { trimDeep };

// ---------------------------------------------------------------- request

export async function request(endpoint, { method = 'GET', body, headers = {}, signal, timeout: timeoutMs } = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const finalHeaders = { ...headers };
  if (!isFormData && body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  const token = readToken();
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  /*
   * Who this tab believes it is.
   *
   * Not a credential — the server trusts the JWT and only the JWT. This is an
   * assertion the server can CHECK the token against, so that a tab whose UI
   * says Administrator can never quietly receive an answer computed for a
   * teacher. A mismatch is refused with 409 rather than served, because a
   * plausible answer for the wrong account is far worse than an error.
   */
  const actingUser = getActingUserId();
  if (actingUser) finalHeaders['X-AIMS-Acting-User'] = actingUser;

  const controller = new AbortController();
  /*
   * A caller may ask for longer than the default.
   *
   * Most requests should fail fast — a screen waiting a minute for a list is
   * broken either way. But a pinned analytics card re-runs a real query
   * against a remote database, and several of them open at once when a
   * dashboard loads; the default 30s is a fair ceiling for a page fetch and
   * too tight for that.
   */
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), limit);
  // Honour a caller's abort signal as well as our own timeout.
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  const init = { method, headers: finalHeaders, signal: controller.signal };
  // Only attach a body when there is one; GET must not carry one at all.
  // A JSON body is edge-trimmed on the way out; FormData is handed over as-is,
  // and its text fields are trimmed server-side after multer parses them.
  if (body !== undefined) {
    init.body = isFormData ? body : JSON.stringify(trimDeep(body));
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new ApiError('The server took too long to respond.', { status: 0 });
    }
    // Network-level failure: server down, DNS, or blocked by CORS.
    throw new ApiError(
      `Cannot reach the API at ${BASE_URL}. Is the backend running?`,
      { status: 0 },
    );
  }
  clearTimeout(timeout);

  // 204 and empty bodies are valid responses.
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    /*
     * 401 is an expired or invalid token. 409 with `session_mismatch` is the
     * server telling us this tab's token belongs to a different account than
     * the one it claims to be acting as — which should now be impossible, and
     * if it happens the only safe response is to stop using the session rather
     * than to retry with it.
     */
    if (response.status === 401
      || (response.status === 409 && data && data.session_mismatch)) {
      dropSession();
      if (onUnauthorized) onUnauthorized();
    }
    throw new ApiError(toErrorMessage(data, response.status), {
      status: response.status,
      data,
      fieldErrors: (data && data.errors) || [],
    });
  }

  return data;
}

export const get = (endpoint, options) => request(endpoint, { ...options, method: 'GET' });
export const post = (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body });
export const put = (endpoint, body, options) => request(endpoint, { ...options, method: 'PUT', body });
// A partial update, for endpoints where sending the whole record back would
// mean the client deciding the value of fields it was never shown.
export const patch = (endpoint, body, options) => request(endpoint, { ...options, method: 'PATCH', body });
export const del = (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' });

// Builds `?a=1&b=2`, dropping empty values so filter objects can be passed as-is.
export const query = (params = {}) => {
  const usable = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  return usable.length ? `?${new URLSearchParams(usable)}` : '';
};

export const API_BASE_URL = BASE_URL;

/**
 * Absolute URL for a file the backend serves from /uploads (profile pictures,
 * student documents). The API stores those as root-relative paths like
 * `/uploads/avatars/1712.png`, which the browser would otherwise resolve
 * against the frontend's own origin and 404.
 *
 * Passes through anything already absolute, and data: URLs, so a local preview
 * can be handed to the same <img> as a stored avatar.
 */
/*
 * Fetches a protected binary resource and returns a blob: URL for it.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Media moved out of the /uploads static mount and into the database, served
 * by authenticated API routes (/api/users/:id/avatar,
 * /api/students/documents/:id/file). Those routes need the bearer token — and
 * an <img src> cannot carry one. The browser issues that request itself, with
 * no Authorization header, and gets a 401.
 *
 * The alternatives were both worse. Putting the token in the query string
 * writes a live credential into browser history, the Referer header and every
 * access log it passes through. Making the routes public would let anyone
 * enumerate user ids and pull the photograph of every student in the
 * institute.
 *
 * So the bytes are fetched the same way as any other API call — token in the
 * header — and wrapped in an object URL that an <img> can use.
 *
 * THE CALLER MUST REVOKE
 * ----------------------
 * An object URL pins its blob in memory until it is revoked; a directory that
 * created one per row and never released them would leak steadily as the user
 * pages. Callers use this through the useAuthedImage hook (hooks/useAuthedImage.js),
 * which revokes on unmount and on change.
 *
 * @returns a blob: URL, or null if there is nothing to show (a 404 from the
 *          avatar route means "no picture on record", which is a normal state,
 *          not an error — the portal renders initials instead).
 */
export async function fetchBlobUrl(endpoint, { signal } = {}) {
  if (!endpoint) return null;

  const token = readToken();
  const actingUser = getActingUserId();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (actingUser) headers['X-AIMS-Acting-User'] = actingUser;

  let response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, { headers, signal });
  } catch (err) {
    // A missing avatar must never take a page down with it, and an aborted
    // request is the normal result of navigating away mid-load.
    if (err.name === 'AbortError') throw err;
    return null;
  }

  // 404 is expected and means "no media on record".
  if (!response.ok) {
    if (response.status === 401 || response.status === 409) {
      dropSession();
      if (onUnauthorized) onUnauthorized();
    }
    return null;
  }

  return URL.createObjectURL(await response.blob());
}

export const assetUrl = (path) => {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  // Multer stores req.file.path with the host OS separator, so rows uploaded
  // from a Windows server come back as "uploads\1785134516270.png". Normalise
  // to forward slashes or the browser requests a path that cannot resolve.
  const normalized = String(path).replace(/\\/g, '/');
  return `${BASE_URL}${normalized.startsWith('/') ? '' : '/'}${normalized}`;
};
