import { useEffect, useState } from 'react';
import { getAvatarUrl } from '../../api/avatarCache';
import './Avatar.css';

const COLORS = [
  '#7c3aed',
  '#2a63c9',
  '#1f9d55',
  '#b6791b',
  '#d1373f',
  '#0e7490',
  '#c2410c',
  '#6b7078',
];

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/*
 * The faculty portal's avatar.
 *
 * It drew initials and nothing else, on every class roster, mark sheet,
 * attendance register and user list in the portal. Given a `userId` it now
 * shows the account's stored profile picture instead, falling back to the same
 * initials when there is none — which is still the common case, so the letters
 * are what most rows keep showing.
 *
 * The id is optional on purpose. Several call sites list people the API does
 * not send a users row for; those pass no id, make no request, and behave
 * exactly as they did before.
 */
export default function Avatar({ name = '', size = 34, className = '', style, userId = null }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!userId) { setUrl(null); return undefined; }

    let live = true;
    getAvatarUrl(userId).then((next) => { if (live) setUrl(next); });
    return () => { live = false; };
  }, [userId]);

  if (url) {
    return (
      <img
        src={url}
        alt={name ? `${name}'s profile picture` : 'Profile picture'}
        title={name}
        className={`avatar-initials ${className}`.trim()}
        style={{
          width: size,
          height: size,
          objectFit: 'cover',
          background: '#E2E8F0',
          animation: 'aims-avatar-in 0.28s ease-out both',
          ...style,
        }}
      />
    );
  }

  return (
    <span
      className={`avatar-initials ${className}`.trim()}
      style={{
        width: size,
        height: size,
        background: colorFor(name),
        fontSize: Math.round(size * 0.38),
        ...style,
      }}
      title={name}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
}
