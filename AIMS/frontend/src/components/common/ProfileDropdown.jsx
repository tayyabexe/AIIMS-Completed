import { useEffect, useRef, useState } from 'react';
import { ChevronDown, User, Settings, LogOut } from 'lucide-react';
import { getAvatarUrl } from '../../api/avatarCache';
import './TopNav.css';

function getInitials(name) {
  return (name || 'U')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Profile dropdown matching the reference design:
 * avatar + name + role in the trigger, then a card with user details,
 * My Profile / Settings, and a red Logout.
 */
export default function ProfileDropdown({
  name = 'User',
  role = '',
  department = '',
  email = '',
  avatarUrl = null,
  /*
   * The signed-in account's users row.
   *
   * Given one, this resolves the stored profile picture itself rather than
   * making all four portals do it. `avatarUrl` still wins when a caller has
   * already loaded the image (the student portal resolves it once into its
   * profile context and passes it down), so nothing double-fetches.
   */
  userId = null,
  avatarColor = '#7C3AED',
  initials,
  onMyProfile,
  onSettings,
  onLogout,
  extraItems = [],
  align = 'right',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [resolvedAvatar, setResolvedAvatar] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (avatarUrl || !userId) { setResolvedAvatar(null); return undefined; }

    let live = true;
    getAvatarUrl(userId).then((url) => { if (live) setResolvedAvatar(url); });
    return () => { live = false; };
  }, [userId, avatarUrl]);

  const shownAvatar = avatarUrl || resolvedAvatar;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const subtitle = [role, department].filter(Boolean).join(' · ') || email || 'Member';

  const handleAction = (fn) => () => {
    setOpen(false);
    fn?.();
  };

  return (
    <div className={`aims-profile ${className}`} ref={ref}>
      <button
        type="button"
        className={`aims-profile-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
      >
        {shownAvatar ? (
          <img src={shownAvatar} alt={name} className="aims-profile-avatar-img" />
        ) : (
          <span className="aims-profile-avatar" style={{ backgroundColor: avatarColor }}>
            {initials || getInitials(name)}
          </span>
        )}
        <span className="aims-profile-text">
          <span className="aims-profile-name">{name}</span>
          <span className="aims-profile-role">{role || 'Member'}</span>
        </span>
        <ChevronDown size={15} className="aims-profile-chevron" />
      </button>

      {open && (
        <div className={`aims-menu aims-menu-profile${align === 'left' ? ' align-left' : ''}`} role="menu">
          <div className="aims-menu-head">
            <div className="aims-menu-head-name">{name}</div>
            <div className="aims-menu-head-sub">{subtitle}</div>
            {email && <div className="aims-menu-head-mail">{email}</div>}
          </div>

          <button type="button" className="aims-menu-item" onClick={handleAction(onMyProfile)} role="menuitem">
            <User size={16} /> My Profile
          </button>
          <button type="button" className="aims-menu-item" onClick={handleAction(onSettings)} role="menuitem">
            <Settings size={16} /> Settings
          </button>

          {extraItems.map((item) => (
            <button
              type="button"
              className="aims-menu-item"
              key={item.label}
              onClick={handleAction(item.onClick)}
              role="menuitem"
            >
              {item.icon} {item.label}
            </button>
          ))}

          <div className="aims-menu-sep" />
          <button type="button" className="aims-menu-item danger" onClick={handleAction(onLogout)} role="menuitem">
            <LogOut size={16} /> Logout
          </button>
        </div>
      )}
    </div>
  );
}
