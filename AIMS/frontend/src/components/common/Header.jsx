import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bot, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChatbot } from '../../context/ChatbotContext';
import NotificationBell from './NotificationBell';
import ProfileDropdown from './ProfileDropdown';
import PortalSearch from './PortalSearch';
import useNotifications from '../../hooks/useNotifications';
import useServerNotifications from '../../api/notificationsData';
import useAdminAlerts from '../../hooks/useAdminAlerts';
import useServerSearch from '../../hooks/useServerSearch';
import { PORTALS } from '../../api/roles';
import './TopNav.css';

export default function Header({ onToggleSidebar }) {
  const navigate = useNavigate();
  const {
    setAdminSubTab,
    logout,
    user,
    viewStudentProfile,
  } = useAuth();

  // Institute-wide alerts, recomputed from GET /api/admin/dashboard rather than
  // from a portal-wide copy of every student record. See hooks/useAdminAlerts.js
  // for why deriving them from the old array is no longer possible — or honest.
  const systemNotifications = useAdminAlerts();
  const { open: openChat, isAvailable: assistantAvailable } = useChatbot();

  /*
   * THE ADMIN BELL WAS NOT SHOWING THE ADMIN'S NOTIFICATIONS.
   *
   * It rendered `useAdminAlerts()` alone — seven recomputed institute
   * conditions, with read-state kept in localStorage. Meanwhile the admin's
   * own Notifications SCREEN read the real feed, /api/notifications. So the
   * two surfaces showed entirely different lists, reading one never affected
   * the other, and the admin had no route from the bell to the ten unread
   * notifications actually addressed to their account. Confirmed against
   * `aims_test`: user 2 had 10 unread rows that the bell never mentioned.
   *
   * The bell now carries both, in two labelled sections, because they are
   * genuinely two different things and merging them would be a lie about
   * either:
   *
   *   "Needs attention" — conditions true of the institute RIGHT NOW. They
   *   have no timestamp, they are not addressed to anybody, and they clear
   *   when the underlying situation clears, not when they are read. They are
   *   still marked read locally so a known case can be quietened.
   *
   *   "Notifications" — stored rows addressed to this account, read-marked on
   *   the server, shared with the Notifications screen and the badge.
   *
   * THE BADGE COUNTS ONLY THE SECOND. A badge is a promise that something can
   * be cleared; the alerts cannot be, they persist as long as the condition
   * does. Summing them would give a number that never reaches zero and so
   * means nothing. The alert count is shown on its own section header instead.
   */
  const alerts = useNotifications(
    systemNotifications,
    'aiims_admin_notifications_read',
  );

  const feed = useServerNotifications();
  const { items, unreadCount, markRead, markAllRead } = feed;

  /*
   * The admin portal has no profile record richer than the account itself —
   * an admin is a `users` row and nothing else — so there is nothing here to
   * upgrade the assistant's name with. `user.name` already reads
   * `users.full_name` straight from the login response.
   *
   * Passing it again would be a no-op at best; passing the old 'Admin'
   * fallback would be worse, because it would override a real stored name with
   * a placeholder. The portal itself is derived from the token, not announced.
   */

  const handleSignOut = () => {
    logout();
    navigate('/choose-portal');
  };

  const handleMyProfile = () => {
    // Open the Settings page on the Account category (admin profile info)
    localStorage.setItem('aiims-settings-category', 'account');
    setAdminSubTab('settings');
  };

  const handleSettings = () => {
    localStorage.setItem('aiims-settings-category', 'general');
    setAdminSubTab('settings');
  };

  const handleViewAllNotifications = () => {
    setAdminSubTab('notifications');
  };

  /**
   * Admin search now runs against GET /api/search instead of filtering the two
   * collections useAdminDirectory happened to have loaded (users + teachers).
   *
   * That old version could not find a student by registration number, a fee by
   * voucher number, or anything at all in departments, courses, subjects,
   * attendance, results, documents or the timetable — those were simply not in
   * the directory. The backend searches all of them, and it is also the thing
   * that enforces row scoping and hides Super Admin rows
   * (backend/src/config/searchResources.js), so that rule is no longer
   * re-implemented on the client where it could drift.
   */
  const [searchQuery, setSearchQuery] = useState('');

  // Where each kind of result takes the admin. Only students have a dedicated
  // record screen; the rest open the section that lists them.
  const openResult = useCallback(
    (type, row) => {
      switch (type) {
        case 'students':
          viewStudentProfile(row.student_id);
          break;
        // Tab names below are the cases AdminDashboard actually switches on.
        case 'faculty':
          setAdminSubTab('faculty');
          break;
        case 'parents':
          setAdminSubTab('parents');
          break;
        case 'fees':
          setAdminSubTab('fee-management');
          break;
        case 'attendance':
          setAdminSubTab('attendance');
          break;
        case 'results':
          setAdminSubTab('examination');
          break;
        case 'notices':
          // Announcements, not Notifications. A notice row IS an announcement
          // — /api/search reads the announcements table for this resource —
          // and Notifications is the separate per-user alert inbox, which does
          // not list it. Selecting a search hit here previously opened a screen
          // that did not contain the thing that had just been matched.
          setAdminSubTab('announcements');
          break;

        /*
         * The academic structure.
         *
         * These four used to fall through to the default below and do nothing,
         * on the grounds that they had "no admin screen of their own". That is
         * no longer true: the Academic Structure module lists departments,
         * programmes, batches, sections, classrooms and semesters, so a search
         * hit on any of them now has somewhere correct to go.
         *
         * `courses` is the search resource's name for programmes — see the
         * `courses` entry in backend/src/config/searchResources.js, which
         * selects program_id and program_name.
         */
        case 'departments':
        case 'courses':
        case 'subjects':
          setAdminSubTab('academic-structure');
          break;

        case 'timetable':
          // The timetable is edited inside Academic Structure alongside the
          // sections and rooms its slots refer to.
          setAdminSubTab('academic-structure');
          break;

        case 'documents':
          /*
           * A document row carries the student it belongs to, and the student
           * profile is where documents are actually shown — so the hit opens
           * the owner's record rather than a document list that does not
           * exist. Guarded, because a row without a student_id would otherwise
           * open an empty profile.
           */
          if (row?.student_id) viewStudentProfile(row.student_id);
          break;

        default:
          // An unrecognised resource stays informational rather than
          // navigating somewhere that does not show the matched record.
          break;
      }
    },
    [setAdminSubTab, viewStudentProfile],
  );

  const { groups: adminGroups, loading: searching, error: searchError } = useServerSearch(
    searchQuery,
    { onSelect: openResult },
  );

  const role = user?.role === 'admin' ? 'Administrator' : 'Admin';
  const department = 'Institute Administration';

  return (
    <header className="aims-admin-header">
      {/* Left */}
      <div className="aims-admin-left">
        <button
          onClick={onToggleSidebar}
          className="aims-admin-iconbtn"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>

        <PortalSearch
          portal={PORTALS.ADMIN}
          recordGroups={adminGroups}
          onQueryChange={setSearchQuery}
          searching={searching}
          searchError={searchError}
          onNavigate={(m) => {
            // Admin screens are tabs inside one shell, so switch the tab and
            // keep the URL in step.
            if (m.tab) setAdminSubTab(m.tab);
            if (m.path) navigate(m.path);
          }}
          placeholder="Search students, faculty, fees, results, subjects..."
          className="aims-search-admin"
        />
      </div>

      {/* Right */}
      <div className="aims-admin-right">
        {/* Chatbot */}
        {/* Hidden for any role the assistant does not serve, so nobody is
            offered a button the backend would refuse. */}
        {assistantAvailable && (
          <button className="aims-chat-btn" onClick={openChat} aria-label="Open AI assistant" title="AI Assistant">
            <Bot size={19} />
            <Sparkles size={9} className="aims-chat-btn-spark" />
          </button>
        )}

        {/* Notifications */}
        <NotificationBell
          sections={[
            {
              id: 'alerts',
              label: 'Needs attention',
              items: alerts.items,
              // Live conditions, not events, so they are not bucketed by day —
              // "Today" over a figure recomputed sixty seconds ago would be
              // true and useless.
              grouped: false,
              count: alerts.unreadCount,
              countLabel: 'Conditions currently true of the institute',
              emptyText: 'Nothing is currently flagged across the institute.',
            },
            {
              id: 'feed',
              label: 'Notifications',
              items,
              emptyText: 'No notifications for your account.',
            },
          ]}
          unreadCount={unreadCount}
          onViewAll={handleViewAllNotifications}
          // Reading and acting in one gesture: the row marks itself read and
          // opens the screen it is about, when it carries one. An alert row
          // carries `to` rather than `link` — it is a filter on a screen, not
          // a stored destination — and is acknowledged locally.
          onItemClick={(n) => {
            if (String(n.id).startsWith('alert-')) {
              alerts.markRead(n.id);
              if (n.to) navigate(n.to);
              return;
            }
            markRead(n.id);
            if (n.link) navigate(n.link);
          }}
          // Clears the stored feed AND quietens the live alerts, which is what
          // "mark all read" plainly means when both are on screen.
          onMarkAllRead={() => {
            const a = alerts.markAllRead();
            const b = markAllRead();
            return a || b;
          }}
        />

        {/* Profile */}
        <ProfileDropdown
          userId={user?.userId}
          name={user?.name || 'Admin'}
          role={role}
          department={department}
          email={user?.email || 'admin@aims.edu'}
          avatarColor="#7c3aed"
          onMyProfile={handleMyProfile}
          onSettings={handleSettings}
          onLogout={handleSignOut}
        />
      </div>
    </header>
  );
}
