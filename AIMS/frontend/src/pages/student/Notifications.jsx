import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, CheckCheck, CheckCircle2, AlertTriangle, Info,
  Clock, ChevronRight, ArrowLeft, X,
} from 'lucide-react';
import StudentTopBar from '../../components/student/StudentTopBar';
import useServerNotifications from '../../api/notificationsData';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconBell,
} from '../../components/student/icons';
import './StudentDashboard.css';
import './Notifications.css';
import { SkeletonRegion, SkeletonList } from '../../components/common/Skeleton';

const TYPE_META = {
  success: { icon: CheckCircle2, bg: '#ecfdf5', color: '#059669', label: 'Good news' },
  warning: { icon: AlertTriangle, bg: '#fef3c7', color: '#d97706', label: 'Attention' },
  danger: { icon: AlertTriangle, bg: '#fee2e2', color: '#dc2626', label: 'Alert' },
  info: { icon: Info, bg: '#eff6ff', color: '#2563eb', label: 'Update' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
];

export default function StudentNotifications() {
  const navigate = useNavigate();
  const { items, unreadCount, loading, error, markRead, markAllRead } = useServerNotifications();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [justMarked, setJustMarked] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/notifications', icon: <IconBell />, label: 'Notifications', active: true },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile' },
  ];

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? items
        : items.filter((n) => (filter === 'unread' ? !n.read : n.read)),
    [items, filter]
  );

  const counts = { all: items.length, unread: unreadCount, read: items.length - unreadCount };

  const handleMarkAll = () => {
    if (markAllRead()) {
      setJustMarked(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setJustMarked(false), 2600);
    }
  };

  const openNotification = (n) => {
    markRead(n.id);
    setSelected(n);
  };

  return (
    <div className="dashboard-layout notif-page-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* Sidebar */}
      <aside className={`sidebar ${isMenuOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand" onClick={() => window.history.back()}>
          <span className="brand-icon"><IconBell /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2026</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* Main wrapper */}
      <div className="main-wrapper">
        {/* Top header (shared: chatbot, notifications, profile) */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* Breadcrumb */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Notifications</span>
        </div>

        <div className="notifications-page">
          {/* Back navigation */}
          <button className="notif-back-btn" onClick={() => navigate('/student/dashboard')}>
            <ArrowLeft size={16} /> Back to Dashboard
          </button>

          {/* Hero */}
          <div className="notif-hero">
            <div className="notif-hero-title-wrap">
              <div className="notif-hero-icon"><BellRing size={22} /></div>
              <div>
                <h1 className="notif-hero-title">Notifications</h1>
                <p className="notif-hero-sub">Announcements, results and updates for you</p>
              </div>
            </div>
            <div className="notif-hero-actions">
              <span className={`notif-hero-count${unreadCount > 0 ? ' has-unread' : ''}`}>
                <Bell size={14} /> {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </span>
              <button
                className="notif-markall-btn"
                onClick={handleMarkAll}
                disabled={unreadCount === 0}
              >
                <CheckCheck size={15} /> Mark all as read
              </button>
            </div>
          </div>

          {/* Success message */}
          {justMarked && (
            <div className="notif-success" role="status">
              <CheckCircle2 size={16} /> All notifications marked as read.
            </div>
          )}

          {/* Filters */}
          <div className="notif-filters">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  className={`notif-filter-chip${active ? ' active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="notif-filter-count">{counts[f.key]}</span>
                </button>
              );
            })}
          </div>

          {/* Loading / failure / empty / list states */}
          {loading ? (
            <SkeletonRegion label="Loading your notifications">
              <SkeletonList rows={6} />
            </SkeletonRegion>
          ) : error ? (
            <div className="notif-empty">
              <AlertTriangle size={40} />
              <p>Could not load your notifications</p>
              <span>{error}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="notif-empty">
              <Bell size={40} />
              <p>No notifications yet</p>
              <span>You&apos;ll see announcements and updates here.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="notif-empty">
              <Bell size={40} />
              <p>No {filter === 'unread' ? 'unread' : 'read'} notifications</p>
              <span>You&apos;re all caught up in this view.</span>
              <button className="notif-empty-action" onClick={() => setFilter('all')}>
                Show all notifications
              </button>
            </div>
          ) : (
            <div className="notif-list">
              {filtered.map((n) => {
                const meta = TYPE_META[n.type] || TYPE_META.info;
                const Icon = meta.icon;
                return (
                  <button
                    type="button"
                    key={n.id}
                    className={`notif-row-card${n.read ? ' read' : ' unread'}`}
                    onClick={() => openNotification(n)}
                  >
                    <span className="notif-row-icon" style={{ background: meta.bg, color: meta.color }}>
                      <Icon size={18} />
                    </span>
                    <span className="notif-row-body">
                      <span className="notif-row-title-row">
                        <span className="notif-row-title">{n.title}</span>
                        {!n.read && <span className="notif-row-unread-dot" aria-label="Unread" />}
                      </span>
                      <span className="notif-row-msg">{n.message}</span>
                      <span className="notif-row-meta">
                        <span className="notif-row-tag" style={{ background: meta.bg, color: meta.color }}>
                          {/* The real notifications.type from the database. */}
                          {n.tag || meta.label}
                        </span>
                        <span className="notif-row-time"><Clock size={12} /> {n.time}</span>
                      </span>
                    </span>
                    <ChevronRight size={16} className="notif-row-chevron" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Notification detail modal */}
      {selected && (
        <div className="notif-modal-overlay" onClick={() => setSelected(null)}>
          <div className="notif-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="notif-modal-head">
              <h3>Notification Details</h3>
              <button className="notif-modal-close" onClick={() => setSelected(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="notif-modal-body">
              {(() => {
                const meta = TYPE_META[selected.type] || TYPE_META.info;
                const Icon = meta.icon;
                return (
                  <>
                    <div className="notif-modal-icon" style={{ background: meta.bg, color: meta.color }}>
                      <Icon size={22} />
                    </div>
                    <span className="notif-modal-tag" style={{ background: meta.bg, color: meta.color }}>
                      {selected.tag || meta.label}
                    </span>
                    <h4 className="notif-modal-title">{selected.title}</h4>
                    <p className="notif-modal-msg">{selected.message}</p>
                    <span className="notif-modal-time"><Clock size={13} /> {selected.time}</span>
                  </>
                );
              })()}
            </div>
            <div className="notif-modal-foot">
              <button className="notif-modal-back" onClick={() => setSelected(null)}>
                <ArrowLeft size={15} /> Back to notifications
              </button>
              {/* The screen this notification is about — the fee page for a
                  challan, the results page for a published result. Absent on
                  rows that carry no link rather than rendered inert. */}
              {selected.link && (
                <button
                  className="notif-modal-go"
                  onClick={() => { setSelected(null); navigate(selected.link); }}
                >
                  Open {selected.tag} <ChevronRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
