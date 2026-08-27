import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bot, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../../context/FacultyAuthContext.jsx';
import { useData } from '../../context/FacultyDataContext.jsx';
import PortalSearch from '../common/PortalSearch';
import { PORTALS } from '../../api/roles';
import { useToast } from './Toast.jsx';
import { useChatbot } from '../../context/ChatbotContext';
import NotificationBell from '../common/NotificationBell';
import ProfileDropdown from '../common/ProfileDropdown';
import { useFacultyBadges } from '../../context/FacultyBadgeContext.jsx';
import '../common/TopNav.css';
import './Header.css';

export default function Header({ title, onMenuClick }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const { user, can, logout } = useAuth();
  const { open: openChat, configure, isAvailable: assistantAvailable } = useChatbot();
  const facultyData = useData();
  // The portal's single notification feed — /api/notifications, scoped to this
  // teacher by the token. Shared with the sidebar bubble and the Notifications
  // page, so reading something on any of them clears it on all three; the
  // header used to hold a second, independent copy that went stale.
  const { notifications, notificationCount } = useFacultyBadges();
  const { items, markRead, markAllRead } = notifications;

  /*
   * The teacher's name from the account, offered to the assistant.
   *
   * The 'Teacher' fallback that used to sit here has gone: it overrode a
   * genuinely-absent name with a placeholder, and the assistant then greeted
   * a person by their job title. An undefined name now clears the override and
   * the widget says "there" instead, which is at least true.
   *
   * The portal is derived from the token in ChatbotContext, not announced here.
   */
  useEffect(() => {
    configure({ userName: user?.name });
  }, [configure, user?.name]);

  /**
   * A teacher's own records: the students in their sections and the classes
   * they teach. Searchable by roll number, name, section, phone, status,
   * subject code, subject title or room — the attributes that actually
   * identify these rows in the faculty portal.
   *
   * facultyData only ever contains the signed-in teacher's sections, so this
   * cannot reach students the teacher does not teach.
   */
  const buildFacultyResults = useCallback(
    (q) => {
      const data = facultyData?.data;
      if (!data) return [];

      const needle = q.toLowerCase();
      const hit = (...fields) =>
        fields.some((f) => f != null && String(f).toLowerCase().includes(needle));

      const groups = [];
      const cap = 5;

      const students = (data.students || [])
        .filter((s) => hit(s.roll, s.name, s.section, s.phone, s.status, s.semester))
        .slice(0, cap)
        .map((s) => ({
          id: `student-${s.id}`,
          title: s.name || '—',
          subtitle: `${s.roll || '—'} · Section ${s.section}`,
          meta: s.attendancePercent != null ? `${s.attendancePercent}%` : null,
          onSelect: () => navigate(`/faculty/students?q=${encodeURIComponent(s.roll || s.name)}`),
        }));
      if (students.length) groups.push({ id: 'students', label: 'Students', items: students });

      const classes = (data.subjects || [])
        .filter((c) => hit(c.code, c.title, c.section, c.room, c.time, c.department))
        .slice(0, cap)
        .map((c) => ({
          id: `class-${c.subjectId}-${c.sectionId}`,
          title: `${c.code} · ${c.title}`,
          subtitle: `Section ${c.section} · ${c.room}`,
          meta: c.credits ? `${c.credits} CH` : null,
          onSelect: () => navigate(`/faculty/my-classes/${c.subjectId}/${c.sectionId}`),
        }));
      if (classes.length) groups.push({ id: 'classes', label: 'My Classes', items: classes });

      return groups;
    },
    [facultyData, navigate],
  );

  const handleLogout = () => {
    // Same fix as the student portal: navigating alone left the JWT behind.
    logout();
    showToast('Logged out successfully');
    navigate('/choose-portal', { replace: true });
  };

  return (
    <header className="topbar">
      <button className="topbar-menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <Menu size={20} />
      </button>

      <h1 className="topbar-title">{title}</h1>

      <PortalSearch
        portal={PORTALS.FACULTY}
        recordGroups={buildFacultyResults}
        onNavigate={(m) => navigate(m.path)}
        placeholder="Search students, classes or jump to a module..."
        className="aims-search-faculty"
      />

      <div className="topbar-right">
        {/* Chatbot */}
        {assistantAvailable && (
          <button className="aims-chat-btn" onClick={openChat} aria-label="Open AI assistant" title="AI Assistant">
            <Bot size={19} />
            <Sparkles size={9} className="aims-chat-btn-spark" />
          </button>
        )}

        {/* Notifications */}
        <NotificationBell
          items={items}
          unreadCount={notificationCount}
          onMarkAllRead={markAllRead}
          onItemClick={(n) => { markRead(n.id); if (n.link) navigate(n.link); }}
          onViewAll={() => navigate('/faculty/notifications')}
        />

        {/* Profile */}
        <ProfileDropdown
          /* FacultyAuthContext renames the account's users-row id to `id`
             when it reshapes it — see context/FacultyAuthContext.jsx. */
          userId={user?.id}
          name={user?.name || 'Faculty'}
          role={user?.designation || 'Teacher'}
          department={user?.department}
          email={user?.email}
          avatarColor="#7c3aed"
          // These three are faculty screens and live under /faculty/*. Without
          // the prefix, "My Profile" opened the *student* profile route and the
          // other two fell through to the catch-all and bounced to the landing
          // page.
          onMyProfile={() => navigate('/faculty/profile')}
          onSettings={() => navigate('/faculty/settings')}
          onLogout={handleLogout}
          extraItems={
            can('manage_users')
              ? [{ label: 'User Management', icon: <Users size={16} />, onClick: () => navigate('/faculty/users') }]
              : []
          }
        />
      </div>
    </header>
  );
}
