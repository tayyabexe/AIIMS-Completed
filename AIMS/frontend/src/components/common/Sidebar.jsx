import { NavLink, useLocation } from 'react-router-dom';
import { GraduationCap, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navForRole, tabForPath } from '../../pages/admin/adminNav';

/*
 * Admin sidebar.
 *
 * Every entry is a real <NavLink>, so the address bar follows the portal and a
 * module can be middle-clicked into a new tab, bookmarked or shared. These used
 * to be <button>s calling setAdminSubTab(), which swapped the screen without
 * touching the URL — see pages/admin/adminNav.js for what that broke.
 *
 * The list itself comes from ADMIN_NAV rather than being written out here, so
 * the sidebar cannot offer a module the router does not serve.
 */
export default function Sidebar({ isOpen, onClose }) {
  const { setCurrentView, user } = useAuth();
  const { pathname } = useLocation();

  // Compared by module rather than by exact path so /student-profile/42 still
  // highlights the Student Profile entry.
  const activeTab = tabForPath(pathname);

  return (
    <aside
      style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        /*
         * The SAME token AdminDashboard offsets its content by.
         *
         * This was a flat 260px while the content beside it was pushed over by
         * `--aims-sidebar-w` (clamp(200px, 15vw, 260px)). Those agree only on a
         * viewport wide enough for 15vw to reach the 260px ceiling — about
         * 1733px. On anything narrower the panel was wider than the gutter left
         * for it and covered the left edge of every admin screen: ~44px eaten
         * at 1440, which is where "Good morning" read as "ood morning" and the
         * first card in every row was clipped.
         *
         * A fixed panel cannot measure the space it was given, so the width and
         * the gutter have to be one value. It is this one.
         */
        width: 'var(--aims-sidebar-w, 260px)',
        backgroundColor: '#0B132B', color: '#F8FAFC',
        zIndex: 100, display: 'flex', flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '4px 0 25px rgba(0,0,0,0.3)',
        overflowY: 'auto',
      }}
    >
      {/* Brand Header */}
      <div style={{
        padding: '1.25rem',
        borderBottom: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div
          onClick={() => setCurrentView('portals')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
        >
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            backgroundColor: '#991b1b', display: 'flex', alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(220,38,38,0.4)',
          }}>
            <GraduationCap size={20} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'white', letterSpacing: '-0.02em', lineHeight: 1, margin: 0 }}>
              AIIMS
            </h1>
            <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 500 }}>
              Institute Management
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px' }}
          title="Hide Sidebar"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ padding: '1.25rem 0.85rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Scoped to what this role's token can actually load. HR, Accountant
            and Library Staff land in the admin portal but hold almost no admin
            permissions, so the full menu handed them a wall of 403s. */}
        {navForRole(user?.roleId).map((group) => (
          <div key={group.section}>
            <p style={{
              fontSize: '0.7rem', fontWeight: 700, color: '#64748B',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              padding: '0 0.75rem 0.5rem', margin: 0,
            }}>
              {group.section}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {group.items.map(({ tab, path, label, icon: Icon, spaced }) => (
                <NavLink
                  key={tab}
                  to={path}
                  className={`sidebar-nav-item ${activeTab === tab ? 'active' : ''}`}
                  style={spaced ? { marginTop: '0.75rem' } : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Icon size={18} />
                    <span>{label}</span>
                  </div>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer Profile — the signed-in account, not a hardcoded one. The
          sidebar used to print "Admin / admin@aiims.edu" for every user. */}
      <div style={{
        padding: '1rem',
        borderTop: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.03)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            backgroundColor: '#991b1b', color: 'white', fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.85rem', flexShrink: 0,
          }}>
            {(user?.name || 'A')
              .split(/\s+/).filter(Boolean).slice(0, 2)
              .map((part) => part[0]).join('').toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'white', lineHeight: 1.1, margin: 0 }}>
              {user?.roleName || 'Admin'}
            </h4>
            <span style={{
              fontSize: '0.7rem', color: '#94A3B8', display: 'block',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user?.email || '—'}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
        >
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
