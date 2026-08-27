/*
 * The parent portal's shell: sidebar, child picker, top bar, footer.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * This is the chrome that used to wrap a `parentTab` switch statement inside
 * one 1,400-line component. The markup is the same; the difference is that the
 * content area is an <Outlet/> now, so each module is a real route.
 *
 * Three things that were impossible before and work as a consequence:
 *
 *   1. A notification can link straight to the screen that answers it. The old
 *      `?tab=` parameter was read once and then ERASED from the URL, so it
 *      could not be bookmarked, reloaded or shared — and its whitelist was
 *      missing `my-children`, so one of the eight modules could not be linked
 *      to at all.
 *   2. Back and Forward walk the portal instead of leaving it.
 *   3. The child in view is addressable (`?child=`), so "Usman's attendance"
 *      is a link rather than a sequence of clicks. See ParentPortalContext.
 *
 * The sidebar and the router are generated from the same list, parentNav.js,
 * so they cannot disagree about which modules exist — which is precisely how
 * the missing `my-children` entry survived.
 */

import { useCallback, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import NotificationBell from '../../components/common/NotificationBell';
import ProfileDropdown from '../../components/common/ProfileDropdown';
import PortalSearch from '../../components/common/PortalSearch';
import UserAvatar from '../../components/common/UserAvatar';
import { PORTALS } from '../../api/roles';
import useServerNotifications from '../../api/notificationsData';
import ParentPortalSkeleton from './ParentPortalSkeleton';
import { ParentPortalProvider, useChildSelection, withChild } from './ParentPortalContext';
import useParentSearchRecords from './useParentSearchRecords';
import {
  PARENT_MAIN_NAV, PARENT_ACCOUNT_NAV, PARENT_HOME,
  moduleForPath, parentLinkToPath,
} from './parentNav';
import { RED, NAVY, CANVAS, INK, BORDER, FAINT } from './parentTheme';

export default function ParentLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // `parentBundle` from the context is the whole loaded bundle (children,
  // timetable, fees, results). `parentData` further down is this parent's own
  // record found within `parents`, so the two are named apart.
  const {
    user, logout, students, parents,
    parentData: parentBundle,
    parentLoading, parentError,
  } = useAuth();

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const parentData = parents.find((p) => p.id === user?.parentId);
  const childIds = parentData?.children || [];
  const myChildren = students.filter((s) => childIds.includes(s.id));

  const { selectedChild, selectChild } = useChildSelection(myChildren);
  const selectedChildId = selectedChild?.id ?? null;

  /*
   * This parent's rows from /api/notifications.
   *
   * No `limit` is passed, deliberately. The bell used to ask for 20 while the
   * Notifications page asked for the default 50 — two different react-query
   * keys, so two independent caches of the same feed. Marking a row read on
   * the page patched one cache and left the bell's bubble showing it as
   * unread, and vice versa. Both surfaces ask for the same page now, so they
   * share one cache entry and cannot disagree. See api/notificationsData.js.
   */
  const {
    items: notifications,
    unreadCount: notificationsUnread,
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
  } = useServerNotifications();

  const handleLogout = useCallback(() => {
    logout();
    navigate('/choose-portal');
  }, [logout, navigate]);

  /*
   * Opening a notification.
   *
   * `parentLinkToPath` translates both shapes: the rows already in the
   * database carrying `/parent-dashboard?tab=fees`, and the rows written from
   * now on carrying `/parent/fees`. Nothing needs migrating, and nobody's
   * existing notifications break.
   */
  const openNotification = useCallback((n) => {
    markNotificationRead(n.id);
    const path = parentLinkToPath(n.link);
    if (path) navigate(withChild(path, selectedChildId));
  }, [markNotificationRead, navigate, selectedChildId]);

  const buildParentResults = useParentSearchRecords({
    myChildren, parentBundle, notifications, markNotificationRead,
  });

  const currentModule = moduleForPath(pathname);

  /*
   * Until /api/parent/* returns, `students` and `parents` are empty, so every
   * derived value above collapses: no selected child, attendance and fee
   * figures of zero, empty result and timetable tables. That is exactly what a
   * parent with no enrolled children would see, so it is held back behind an
   * explicit loading state rather than rendered as fact.
   *
   * The failure branch is a dead end, so it takes the whole screen and offers
   * the retry. The loading branch does not: it used to be the same full-screen
   * takeover, which meant a refresh made the entire portal vanish and come
   * back, reading as a crash rather than as a load.
   */
  if (parentError) {
    return (
      <div style={{
        minHeight: '100vh', backgroundColor: CANVAS,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', sans-serif", padding: '2rem',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '420px' }}>
          <div style={{
            width: '52px', height: '52px', margin: '0 auto 1rem',
            borderRadius: '50%', backgroundColor: '#FEE2E2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={26} color={RED} />
          </div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: INK, margin: '0 0 .4rem' }}>
            Could not load your portal
          </h2>
          <p style={{ fontSize: '.85rem', color: '#64748B', margin: '0 0 1.1rem' }}>{parentError}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '.6rem 1.4rem', border: 'none', borderRadius: '10px',
              backgroundColor: RED, color: 'white', fontWeight: 700,
              fontSize: '.85rem', cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (parentLoading) {
    return <ParentPortalSkeleton tab={currentModule?.tab || 'dashboard'} />;
  }

  const navItemStyle = { width: '100%', textAlign: 'left', display: 'block' };

  const renderNavItem = (m, first) => {
    const Icon = m.icon;
    return (
      <NavLink
        key={m.path}
        to={withChild(m.path, selectedChildId)}
        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
        style={{ ...navItemStyle, marginTop: first ? 0 : '0.5rem' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Icon size={18} /> <span>{m.label}</span>
        </div>
      </NavLink>
    );
  };

  const portalValue = {
    user,
    parentData,
    parentBundle,
    myChildren,
    selectedChild,
    selectedChildId,
    selectChild,
    childQuery: selectedChildId == null ? {} : { child: String(selectedChildId) },
  };

  return (
    <ParentPortalProvider value={portalValue}>
      <div style={{ minHeight: '100vh', backgroundColor: CANVAS, display: 'flex', fontFamily: "'Inter', sans-serif" }}>
        {/* Sidebar */}
        <aside style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: '260px', backgroundColor: NAVY, color: CANVAS,
          zIndex: 100, display: 'flex', flexDirection: 'column',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '4px 0 25px rgba(0,0,0,0.3)',
          overflowY: 'auto',
        }}>
          {/* Brand */}
          <div style={{
            padding: '1.25rem', borderBottom: '1px solid #1E293B',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                backgroundColor: RED, display: 'flex', alignItems: 'center',
                justifyContent: 'center', boxShadow: '0 4px 12px rgba(220,38,38,0.4)',
              }}>
                <GraduationCap size={20} color="white" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'white', letterSpacing: '-0.02em', lineHeight: 1, margin: 0 }}>AIIMS</h1>
                <span style={{ fontSize: '0.68rem', color: FAINT, fontWeight: 500 }}>Parent Portal</span>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: FAINT, cursor: 'pointer', padding: '4px' }}>
              <X size={18} />
            </button>
          </div>

          {/* Parent Info */}
          <div style={{ padding: '1.25rem', borderBottom: '1px solid #1E293B', textAlign: 'center' }}>
            <UserAvatar
              userId={user?.userId}
              name={user?.name || 'Parent'}
              size={56}
              bg={RED}
              style={{ margin: '0 auto 0.75rem', display: 'flex', boxShadow: '0 4px 12px rgba(153,27,27,0.3)' }}
            />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'white', margin: 0 }}>{user?.name || 'Parent'}</h3>
            <p style={{ fontSize: '0.75rem', color: FAINT, margin: '0.25rem 0 0' }}>{user?.email}</p>
          </div>

          {/* Nav */}
          <nav style={{ padding: '0.85rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {/*
             * The child picker, and the only one in the portal.
             *
             * Selection used to be made from a dropdown rendered separately
             * inside the dashboard and inside each of the attendance, results,
             * fee and timetable views — five copies of the same widget, each
             * only reachable once you were already on that screen. It lives
             * here because it governs every screen at once.
             *
             * Choosing a child now writes `?child=` rather than a useState, so
             * the choice survives a reload and travels with a shared link.
             */}
            {myChildren.length > 0 && (
              <div style={{ marginBottom: '0.85rem' }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0.75rem 0.5rem 0.75rem', margin: 0 }}>
                  MY CHILDREN
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {myChildren.map((child) => {
                    const isActive = child.id === selectedChildId;
                    return (
                      <button
                        key={child.id}
                        onClick={() => selectChild(child.id)}
                        aria-pressed={isActive}
                        title={`View ${child.name}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          width: '100%', textAlign: 'left', cursor: 'pointer',
                          padding: '0.5rem 0.7rem', borderRadius: '10px',
                          border: 'none',
                          borderLeft: isActive ? `3px solid ${RED}` : '3px solid transparent',
                          backgroundColor: isActive ? 'rgba(153,27,27,0.22)' : 'transparent',
                          transition: 'background-color 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        {/* The child's real photograph when one is on record,
                            their initials when it is not. */}
                        <UserAvatar
                          userId={child.userId}
                          hasPhoto={child.hasPhoto}
                          version={child.avatarVersion}
                          name={child.name}
                          initials={child.initials}
                          bg={child.avatarBg || RED}
                          size={30}
                          shape="rounded"
                        />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{
                            display: 'block', fontSize: '0.82rem',
                            fontWeight: isActive ? 600 : 500,
                            color: isActive ? '#FFFFFF' : '#CBD5E1',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {child.name}
                          </span>
                          <span style={{
                            display: 'block', fontSize: '0.68rem', color: FAINT,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {child.regNo}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0.75rem 0.5rem 0.75rem', margin: 0 }}>
                MAIN
              </p>
              {PARENT_MAIN_NAV.map((m, i) => renderNavItem(m, i === 0))}
            </div>

            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0.75rem 0.5rem 0.75rem', margin: 0 }}>
                ACCOUNT
              </p>
              {PARENT_ACCOUNT_NAV.map((m, i) => renderNavItem(m, i === 0))}
            </div>
          </nav>

          {/* Logout */}
          <div style={{ padding: '0.85rem', borderTop: '1px solid #1E293B', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <button onClick={handleLogout} className="sidebar-nav-item" style={{ width: '100%', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#FCA5A5' }}>
                <LogOut size={18} /> <span>Sign Out</span>
              </div>
            </button>
          </div>

          <div style={{ padding: '1rem', borderTop: '1px solid #1E293B', fontSize: '0.65rem', color: '#475569', textAlign: 'center' }}>
            AIIMS · Parent Portal v2.0
          </div>
        </aside>

        {/* Main Content */}
        <div style={{
          display: 'flex', flexDirection: 'column', flex: 1,
          marginLeft: sidebarOpen ? '260px' : '0',
          transition: 'margin-left 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* Top Header */}
          <header className="aims-parent-header" style={{
            backgroundColor: '#FFFFFF', borderBottom: `1px solid ${BORDER}`,
            padding: '0 2rem', height: '64px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 50,
          }}>
            <div className="aims-parent-header-left" style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                style={{
                  width: '42px', height: '42px', borderRadius: '12px',
                  border: `1px solid ${BORDER}`, backgroundColor: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: INK, cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                <Menu size={20} />
              </button>
              {/* The page title came from an eight-branch ternary that had to
                  be edited in step with the sidebar. It is a property of the
                  route now. */}
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: INK, fontFamily: "'Outfit', sans-serif", margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentModule?.title || 'Parent Portal'}
              </h2>
            </div>

            {/* Search — restricted to this parent's own children, their
                attendance, results, fees, timetable and notices. */}
            <PortalSearch
              portal={PORTALS.PARENT}
              recordGroups={buildParentResults}
              onNavigate={(m) => navigate(withChild(m.path, selectedChildId))}
              placeholder="Search your children, fees, results..."
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/*
               * The AI assistant button was here.
               *
               * It is gone because the assistant does not serve the Parent
               * role. A parent's scope is their wards, which needs its own
               * resolver and its own tools. Until that exists the backend
               * refuses role 5 with a 403 before spending a token, and
               * offering a button that always fails is worse than offering
               * none.
               *
               * To restore it: add PARENT to ASSISTANT_ROLES in
               * config/assistant.js and ChatbotContext.jsx, add a parent
               * branch to scope.service.js using the existing resolveWardIds
               * helper, and give the per-student tools a parent path in
               * targetStudent().
               */}

              {/* Notifications */}
              <NotificationBell
                items={notifications}
                unreadCount={notificationsUnread}
                onItemClick={openNotification}
                onMarkAllRead={markAllNotificationsRead}
                onViewAll={() => navigate(withChild('/parent/notifications', selectedChildId))}
              />

              {/* Profile */}
              <ProfileDropdown
                userId={user?.userId}
                name={user?.name || 'Parent'}
                role="Parent"
                department={myChildren.length ? `Guardian of ${myChildren.length} ward${myChildren.length > 1 ? 's' : ''}` : 'Guardian'}
                email={user?.email}
                avatarColor="#991B1B"
                onMyProfile={() => navigate('/parent/profile')}
                onSettings={() => navigate('/parent/profile')}
                onLogout={handleLogout}
              />
            </div>
          </header>

          {/* Page Content */}
          <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '100%', width: '100%' }}>
            <Outlet />
          </main>

          {/* Footer */}
          <footer style={{ textAlign: 'center', padding: '1.25rem', borderTop: `1px solid ${BORDER}`, fontSize: '0.85rem', color: FAINT, backgroundColor: '#FFFFFF' }}>
            AIIMS · AI-Based Institute Management System · Parent Portal · © 2025 AIIMS. All rights reserved.
          </footer>
        </div>
      </div>
    </ParentPortalProvider>
  );
}

export { PARENT_HOME };
