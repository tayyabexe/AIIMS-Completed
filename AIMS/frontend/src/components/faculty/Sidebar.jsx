import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  BookOpen,
  ClipboardCheck,
  FileText,
  ClipboardList,
  Users,
  CalendarDays,
  Megaphone,
  Bell,
  User,
  Settings,
  BarChart3,
  Sparkles,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/FacultyAuthContext.jsx';
import { useFacultyBadges } from '../../context/FacultyBadgeContext.jsx';
import { useToast } from './Toast.jsx';
import Avatar from './Avatar.jsx';
import './Sidebar.css';

export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const { user, can, logout } = useAuth();
  // Both bubbles used to be hardcoded here — `badge: 5` and `badge: 2` — so
  // every teacher saw the same two counts and nothing ever cleared them.
  const badges = useFacultyBadges();

  const notificationCount = badges?.notificationCount || 0;
  const assignmentCount = badges?.assignmentCount || 0;

  const NAV_ITEMS = [
    { to: '/faculty/dashboard', label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: '/faculty/my-classes', label: 'My Classes', icon: BookOpen },
    { to: '/faculty/attendance', label: 'Attendance', icon: ClipboardCheck },
    { to: '/faculty/marks', label: 'Marks', icon: FileText },
    {
      to: '/faculty/assignments',
      label: 'Assignments',
      icon: ClipboardList,
      // Assignments set on this teacher's subjects since they last opened the
      // screen. Opening it advances the watermark and the bubble goes.
      badge: assignmentCount,
      badgeLabel: `${assignmentCount} new assignment${assignmentCount === 1 ? '' : 's'}`,
    },
    { to: '/faculty/students', label: 'Students', icon: Users },
    { to: '/faculty/reports', label: 'Reports', icon: BarChart3 },
    /*
     * Directly under Reports, and that placement is the point.
     *
     * Reports are the fixed questions the institute asks every term; this is
     * the one nobody built a screen for. They read the same database and a
     * teacher choosing between them is choosing between recurring and
     * one-off, so they belong next to each other rather than at opposite
     * ends of the list.
     */
    { to: '/faculty/ai-analytics', label: 'Ask the Data', icon: Sparkles },
    { to: '/faculty/timetable', label: 'Timetable', icon: CalendarDays },
    { to: '/faculty/announcements', label: 'Announcements', icon: Megaphone },
    {
      to: '/faculty/notifications',
      label: 'Notifications',
      icon: Bell,
      badge: notificationCount,
      badgeLabel: `${notificationCount} unread notification${notificationCount === 1 ? '' : 's'}`,
    },
    { to: '/faculty/profile', label: 'Profile', icon: User },
    { to: '/faculty/settings', label: 'Settings', icon: Settings },
  ];

  const handleLogout = (e) => {
    e.preventDefault();
    // Navigating alone left the JWT in localStorage, so the next visit walked
    // straight back into the portal.
    logout();
    showToast('Logged out successfully');
    navigate('/choose-portal', { replace: true });
  };

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">A</div>
          <div className="sidebar-brand-text">
            <div className="name">AIMS</div>
            <div className="sub">Institute Portal</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end, badge, badgeLabel }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {badge > 0 ? (
                <span className="sidebar-link-badge" title={badgeLabel} aria-label={badgeLabel}>
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
            </NavLink>
          ))}

          {can('manage_users') && (
            <NavLink
              to="/faculty/users"
              onClick={onClose}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              <ShieldCheck size={18} />
              <span>Users & Roles</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          {user && (
            <div className="sidebar-user">
              <Avatar name={user.name} size={34} userId={user.id} />
              <div className="sidebar-user-text">
                <div className="name">{user.name}</div>
                <div className="sub">{user.designation}</div>
              </div>
            </div>
          )}
          <a href="#" className="sidebar-link" onClick={handleLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </a>
        </div>
      </aside>
    </>
  );
}
