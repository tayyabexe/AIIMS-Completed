import { useEffect, useState } from 'react';
import { getAvatarUrl } from '../../api/avatarCache';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  The one avatar in the product
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT REPLACES
 * ----------------
 * Every screen drew its own. The admin directory had `initialsOf(name)` in a
 * coloured square, the faculty portal had components/faculty/Avatar.jsx, the
 * parent portal read `child.initials` and `child.avatarBg` off the mapped
 * record, the student dashboard had `.welcome-avatar`. All of them rendered
 * letters, and none of them ever asked whether the person had actually uploaded
 * a photograph — so an avatar that WAS in the database showed up on exactly one
 * screen, the uploader's own profile, and nowhere else in the institute.
 *
 * WHAT IT DOES
 * ------------
 * Given a user id it fetches that account's picture through the shared cache
 * and draws it. With no id, no picture on record, or a failed load, it draws
 * the initials — the same fallback each screen already had, so nothing regresses
 * for the majority of accounts that have no portrait.
 *
 * WHY THE ID AND NOT A URL
 * ------------------------
 * /api/users/:id/avatar needs a bearer token, so the URL cannot be handed to an
 * <img src> directly (it 401s and renders broken). The bytes are fetched with
 * the token attached and wrapped in a blob: URL. Callers pass the id they
 * already have and are spared knowing any of that.
 *
 * WHY THE INITIALS ARE DRAWN FIRST AND NOT A SPINNER
 * --------------------------------------------------
 * The initials are a legitimate final state for most accounts, so showing them
 * while the picture loads costs nothing when there is no picture — which is the
 * common case — and cross-fades to the photograph when there is one. A spinner
 * would flash on every row of a directory and settle on letters anyway.
 */

const COLORS = [
  '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
  '#0891B2', '#EA580C', '#4F46E5', '#BE123C', '#0D9488', '#9333EA',
];

const initialsOf = (name = '', fallback = '?') => {
  const parts = String(name).replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/i, '')
    .trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Stable per name, so the same person keeps the same colour on every screen.
const colorFor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
};

/**
 * @param {number}  [userId]    the users row whose picture to show
 * @param {string}  [name]      used for the initials and the default colour
 * @param {string}  [initials]  override, when the caller already computed them
 * @param {number}  [size]      pixels, square
 * @param {string}  [shape]     'circle' (default) | 'rounded'
 * @param {string}  [bg]        override background for the initials state
 * @param {string}  [color]     initials colour
 * @param {string}  [version]   checksum / updated_at; changes refetch
 * @param {boolean} [hasPhoto]  when the caller already knows there is none,
 *                              pass false and no request is made at all
 * @param {string}  [ring]      optional border, e.g. '2px solid #fff'
 */
export default function UserAvatar({
  userId = null,
  name = '',
  initials = null,
  size = 40,
  shape = 'circle',
  bg = null,
  color = '#FFFFFF',
  version = null,
  hasPhoto = undefined,
  ring = null,
  className = '',
  style = {},
  title,
}) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    // `hasPhoto === false` is the caller telling us the row's
    // has_profile_picture flag is off. Believing it saves a request per row
    // that would 404 — on a fifty-row directory that is the difference between
    // one request and fifty.
    if (!userId || hasPhoto === false) {
      setUrl(null);
      return undefined;
    }

    let live = true;
    getAvatarUrl(userId, version).then((next) => { if (live) setUrl(next); });

    return () => { live = false; };
  }, [userId, version, hasPhoto]);

  const label = initials || initialsOf(name);
  const radius = shape === 'circle' ? '50%' : `${Math.round(size * 0.28)}px`;

  const base = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    border: ring || undefined,
    boxSizing: 'border-box',
    ...style,
  };

  if (url) {
    return (
      <img
        src={url}
        alt={name ? `${name}'s profile picture` : 'Profile picture'}
        title={title ?? name ?? undefined}
        className={className}
        style={{
          ...base,
          objectFit: 'cover',
          backgroundColor: '#E2E8F0',
          // The cross-fade from initials to photograph. Without it the letters
          // are replaced in a single frame, which reads as a glitch on a list
          // where rows resolve at slightly different moments.
          animation: 'aims-avatar-in 0.28s ease-out both',
        }}
      />
    );
  }

  return (
    <span
      className={className}
      title={title ?? name ?? undefined}
      aria-hidden="true"
      style={{
        ...base,
        backgroundColor: bg || colorFor(name || String(userId || '')),
        color,
        fontWeight: 800,
        fontFamily: "'Outfit', sans-serif",
        fontSize: Math.max(9, Math.round(size * 0.38)),
        letterSpacing: '0.02em',
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
}

export { initialsOf, colorFor };
