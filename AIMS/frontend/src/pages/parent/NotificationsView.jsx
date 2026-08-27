import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useServerNotifications, { relativeTime } from '../../api/notificationsData';
import { parentLinkToPath } from './parentNav';
import { withChild } from './ParentPortalContext';
import { useServerQuery } from '../../hooks/useAdminPage';
import { announcements as announcementsApi } from '../../api/endpoints';
import UserAvatar from '../../components/common/UserAvatar';
import {
  Bell, BellRing, CheckCheck, AlertTriangle, CheckCircle2, Info,
  DollarSign, CalendarCheck, ChevronRight, Clock, Phone,
} from 'lucide-react';

const RED = '#991b1b';
const NAVY = '#0B132B';

const TYPE_META = {
  alert:   { icon: AlertTriangle, bg: '#FEF2F2', color: '#DC2626', label: 'Alert' },
  warning: { icon: AlertTriangle, bg: '#FEF3C7', color: '#D97706', label: 'Warning' },
  success: { icon: CheckCircle2,  bg: '#ECFDF5', color: '#059669', label: 'Good news' },
  info:    { icon: Info,          bg: '#EEF2FF', color: '#4F46E5', label: 'Update' },
};

const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'unread',     label: 'Unread' },
  { key: 'academic',   label: 'Academic' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'fees',       label: 'Fees' },
  { key: 'general',    label: 'Institute' },
];

const CATEGORY_LABELS = { academic: 'Academic', attendance: 'Attendance', fees: 'Fees', general: 'Institute' };
const GROUPS = ['Today', 'Yesterday', 'Earlier'];

/**
 * Which filter chip a row belongs under, from the real `notifications.type`
 * value stored against it.
 */
const CATEGORY_BY_TAG = {
  Fee: 'fees',
  Attendance: 'attendance',
  Result: 'academic',
  Academic: 'academic',
  Registration: 'academic',
  Document: 'general',
  Library: 'general',
  Scholarship: 'general',
  Meeting: 'general',
  Leave: 'general',
  HR: 'general',
  Payroll: 'general',
};

/** Today / Yesterday / Earlier, from the row's real created_at. */
const dateGroup = (value) => {
  if (!value) return 'Earlier';

  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'Earlier';

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (then >= startOfToday) return 'Today';

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);

  return then >= startOfYesterday ? 'Yesterday' : 'Earlier';
};

/**
 * The parent's notification centre.
 *
 * Everything shown here is now a real row. It previously ran a generator that
 * invented the entire feed: alerts were written from the child's figures but
 * stamped with made-up times ("Today · 8:10 AM"), and five institute notices
 * were pure fiction — a Parent–Teacher meeting "this Friday", an Independence
 * Day holiday, a "portal v2.0" release. None of them existed anywhere.
 *
 * Two real sources replace it:
 *   - GET /api/notifications  — this parent's own rows, scoped by their token.
 *   - GET /api/announcements  — notices addressed to Parents or to everyone,
 *                               filtered server-side by role.
 */
export default function NotificationsView({ wards, selectedChildId, onSelectChild, onViewChild }) {
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  // Shared with the header bell, so reading a notification in either place
  // updates the other immediately.
  const {
    items: serverItems,
    unreadCount: unread,
    loading,
    error,
    markRead,
    markAllRead,
  } = useServerNotifications();

  /*
   * Read it, then go and deal with it.
   *
   * `parentLinkToPath` translates the two shapes a stored link can have. Rows
   * written while the portal was a single route carry
   * `/parent-dashboard?tab=fees`; rows written since carry `/parent/fees`.
   * Nine of the former are in `aims_test` today and there is no reason to
   * migrate them — the translation is unambiguous and lives in one place, the
   * same map the sidebar and the router are built from.
   *
   * The child in view rides along, so opening a fee notice from Usman's
   * notifications lands on Usman's fees rather than on the first ward.
   *
   * Announcements carry no link and no read state; they are broadcasts, so
   * clicking one marks nothing and goes nowhere.
   */
  const openRow = (n) => {
    if (n.kind === 'notification') markRead(n.id);
    const path = parentLinkToPath(n.link);
    if (path) navigate(withChild(path, selectedChildId));
  };

  /*
   * Institute announcements, cached and shared.
   *
   * An announcements outage should not blank the whole page — the parent's own
   * notifications are the more important half — so the fetch still swallows
   * its error and the panel simply shows nothing.
   */
  const noticesQuery = useServerQuery(
    () => announcementsApi.list({ limit: 20 }).catch(() => null),
    {}, { key: 'announcements-20' },
  );

  const notices = useMemo(
    () => (Array.isArray(noticesQuery.data?.data) ? noticesQuery.data.data : []),
    [noticesQuery.data],
  );

  // Personal notifications and institute announcements, in one list ordered by
  // when they were actually created.
  const notifications = useMemo(() => {
    const personal = serverItems.map((n) => ({
      ...n,
      category: CATEGORY_BY_TAG[n.tag] || 'general',
      group: dateGroup(n.createdAt),
      kind: 'notification',
    }));

    const announced = notices.map((a) => ({
      id: `announcement-${a.announcement_id}`,
      type: 'info',
      tag: 'Announcement',
      title: a.title,
      message: a.content,
      time: relativeTime(a.created_at),
      createdAt: a.created_at,
      // An announcement is a broadcast, not a personal item, so there is no
      // per-parent read state for it and it never counts towards "unread".
      read: true,
      // Nor a destination: an announcement IS its own content, where a
      // notification points at a record elsewhere in the portal.
      link: null,
      category: 'general',
      group: dateGroup(a.created_at),
      kind: 'announcement',
    }));

    return [...personal, ...announced].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );
  }, [serverItems, notices]);

  const alerts = notifications.filter((n) => n.type === 'alert' || n.type === 'warning').length;

  const counts = useMemo(() => {
    const c = { all: notifications.length, unread, academic: 0, attendance: 0, fees: 0, general: 0 };
    notifications.forEach((n) => { if (n.category) c[n.category] += 1; });
    return c;
  }, [notifications, unread]);

  const filtered = notifications.filter((n) =>
    filter === 'all' ? true : filter === 'unread' ? !n.read : n.category === filter
  );

  const groups = GROUPS
    .map((label) => ({ label, items: filtered.filter((n) => n.group === label) }))
    .filter((g) => g.items.length > 0);

  /*
   * Per-child flags, read straight off each child's own record.
   *
   * `notifications` rows carry a user_id and no student_id, so a notification
   * cannot be attributed to one particular child — the old per-child unread and
   * alert counts were counting invented items that had a childId only because
   * the generator had put one there.
   */
  const wardSummary = wards.map((child) => ({
    child,
    lowAttendance: child.attendance != null && (parseFloat(child.attendance) || 0) < 75,
    feeIssue: child.feeStatus != null && child.feeStatus !== 'Paid',
    atRisk: child.cgpa != null && child.cgpa < 2.5,
  }));

  const cardStyle = {
    backgroundColor: '#FFFFFF', borderRadius: '20px', border: '1px solid #E2E8F0',
    boxShadow: '0 4px 20px rgba(0,0,0,0.03)', overflow: 'hidden',
  };

  return (
    <div>
      {/* NAVY summary strip */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B2A4A 100%)`,
        borderRadius: '20px', padding: '1.75rem 2rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-70%', right: '8%',
          width: '300px', height: '300px', backgroundColor: '#FFFFFF', opacity: 0.05,
          filter: 'blur(70px)', borderRadius: '50%',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', position: 'relative', zIndex: 2 }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '14px',
            backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BellRing size={22} color="#FCA5A5" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'white', fontFamily: "'Outfit', sans-serif", margin: 0 }}>
              Notification Centre
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '3px 0 0' }}>
              Alerts, results and updates across all your wards
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative', zIndex: 2 }}>
          <span style={{
            padding: '0.45rem 1rem', borderRadius: '30px', fontSize: '0.8rem', fontWeight: 700,
            backgroundColor: unread > 0 ? '#FEF2F2' : 'rgba(255,255,255,0.08)',
            color: unread > 0 ? RED : '#94A3B8', border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <Bell size={14} />
            {unread > 0 ? `${unread} unread` : 'All caught up'}
          </span>
          <button
            onClick={markAllRead}
            disabled={unread === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '0.45rem 1rem', borderRadius: '30px', border: 'none',
              backgroundColor: unread > 0 ? RED : '#334155', color: 'white',
              fontSize: '0.8rem', fontWeight: 700, cursor: unread > 0 ? 'pointer' : 'not-allowed',
              opacity: unread > 0 ? 1 : 0.6, transition: 'all 0.2s', fontFamily: "'Inter', sans-serif",
            }}
            onMouseEnter={(e) => { if (unread > 0) e.currentTarget.style.backgroundColor = '#7f1d1d'; }}
            onMouseLeave={(e) => { if (unread > 0) e.currentTarget.style.backgroundColor = RED; }}
          >
            <CheckCheck size={15} /> Mark all as read
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const total = counts[f.key] || 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '0.45rem 1rem', borderRadius: '30px', border: `1px solid ${active ? RED : '#E2E8F0'}`,
                backgroundColor: active ? RED : '#FFFFFF', color: active ? 'white' : '#475569',
                fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                display: 'flex', alignItems: 'center', gap: '6px',
                boxShadow: active ? '0 4px 14px rgba(153,27,27,0.25)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {f.label}
              <span style={{
                minWidth: '18px', padding: '1px 6px', borderRadius: '12px', fontSize: '0.68rem',
                backgroundColor: active ? 'rgba(255,255,255,0.2)' : '#F1F5F9',
                color: active ? 'white' : '#94A3B8', fontWeight: 800,
              }}>
                {total}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem', alignItems: 'start' }}>
        {/* ===== Notification feed ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {groups.length === 0 && (
            <div style={{ ...cardStyle, padding: '3rem 2rem', textAlign: 'center' }}>
              <Bell size={44} color="#CBD5E1" />
              <p style={{ fontSize: '1rem', color: '#94A3B8', margin: '0.75rem 0 0' }}>No notifications match this filter</p>
              <button
                onClick={() => setFilter('all')}
                style={{
                  marginTop: '1rem', padding: '0.5rem 1.25rem', borderRadius: '10px',
                  border: 'none', backgroundColor: RED, color: 'white', fontWeight: 700,
                  fontSize: '0.82rem', cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                }}
              >
                Show all notifications
              </button>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 0.75rem' }}>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                  {g.label}
                </h4>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#E2E8F0' }} />
                <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>{g.items.length}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {g.items.map((n) => {
                  const meta = TYPE_META[n.type] || TYPE_META.info;
                  const Icon = meta.icon;
                  // Announcements are broadcasts with no per-parent read state,
                  // so only personal notifications are acknowledgeable.
                  const child = null;
                  return (
                    <div
                      key={n.id}
                      onClick={() => openRow(n)}
                      style={{
                        display: 'flex', gap: '14px', padding: '1.05rem 1.25rem', cursor: 'pointer',
                        backgroundColor: n.read ? '#FFFFFF' : '#FFFBFB',
                        border: `1px solid ${n.read ? '#E2E8F0' : '#FECACA'}`,
                        borderRadius: '16px',
                        boxShadow: n.read ? '0 1px 3px rgba(0,0,0,0.04)' : '0 4px 16px rgba(153,27,27,0.06)',
                        transition: 'all 0.2s', alignItems: 'flex-start',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.08)';
                        e.currentTarget.style.borderColor = '#FCA5A5';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = n.read ? '0 1px 3px rgba(0,0,0,0.04)' : '0 4px 16px rgba(153,27,27,0.06)';
                        e.currentTarget.style.borderColor = n.read ? '#E2E8F0' : '#FECACA';
                      }}
                    >
                      {/* Type icon */}
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
                        backgroundColor: meta.bg, color: meta.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon size={19} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                          <h4 style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                            {n.title}
                          </h4>
                          {!n.read && (
                            <span style={{
                              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                              backgroundColor: RED, boxShadow: '0 0 0 3px rgba(153,27,27,0.15)',
                            }} />
                          )}
                        </div>
                        <p style={{ fontSize: '0.83rem', color: '#475569', lineHeight: 1.5, margin: '0 0 0.6rem' }}>
                          {n.message}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700, padding: '2px 9px', borderRadius: '20px',
                            backgroundColor: meta.bg, color: meta.color,
                          }}>
                            {meta.label}
                          </span>
                          {child && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onSelectChild(child.id); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: '0.72rem', fontWeight: 700, color: '#334155',
                                padding: '2px 8px', borderRadius: '20px', fontFamily: "'Inter', sans-serif",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F1F5F9'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <span style={{
                                width: '16px', height: '16px', borderRadius: '50%',
                                backgroundColor: child.avatarBg || RED, color: 'white',
                                fontSize: '0.55rem', fontWeight: 800,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                {(child.initials || child.name.slice(0, 2).toUpperCase()).slice(0, 2)}
                              </span>
                              {child.name}
                            </button>
                          )}
                          {n.category && (
                            <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>
                              {CATEGORY_LABELS[n.category]}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#94A3B8', marginLeft: 'auto' }}>
                            <Clock size={12} /> {n.time}
                          </span>
                        </div>
                      </div>

                      {/* Only drawn when the row actually goes somewhere. A
                          chevron on an unlinked row promises a destination that
                          does not exist — which is exactly how the completed
                          "Password changed" notice read as a way back into the
                          change-password form. */}
                      {n.link && (
                        <ChevronRight size={16} color="#CBD5E1" style={{ flexShrink: 0, marginTop: '12px' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ===== Right summary column ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Overview */}
          <div style={cardStyle}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #F1F5F9' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                Overview
              </h4>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '1.25rem 1.5rem', gap: '0.75rem' }}>
              {[
                { label: 'Total', value: notifications.length, color: '#0F172A' },
                { label: 'Unread', value: unread, color: unread > 0 ? RED : '#0F172A' },
                { label: 'Alerts', value: alerts, color: alerts > 0 ? '#D97706' : '#0F172A' },
              ].map((s) => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1.4rem', fontWeight: 900, color: s.color, margin: 0, fontFamily: "'Outfit', sans-serif" }}>{s.value}</p>
                  <p style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 600, margin: '2px 0 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Wards */}
          <div style={cardStyle}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                Your wards
              </h4>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>{wards.length} enrolled</span>
            </div>
            <div style={{ padding: '0.75rem 1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {wardSummary.map(({ child, unread: u, alerts: a, lowAttendance, feeIssue, atRisk }) => (
                <div
                  key={child.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '0.7rem 0.85rem', borderRadius: '12px',
                    backgroundColor: child.id === selectedChildId ? '#FEF2F2' : '#F8FAFC',
                    border: `1px solid ${child.id === selectedChildId ? '#FECACA' : 'transparent'}`,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onClick={() => onSelectChild(child.id)}
                  onMouseEnter={(e) => { if (child.id !== selectedChildId) e.currentTarget.style.backgroundColor = '#F1F5F9'; }}
                  onMouseLeave={(e) => { if (child.id !== selectedChildId) e.currentTarget.style.backgroundColor = '#F8FAFC'; }}
                >
                  <UserAvatar
                    userId={child.userId}
                    hasPhoto={child.hasPhoto}
                    version={child.avatarVersion}
                    name={child.name}
                    initials={child.initials}
                    bg={child.avatarBg || RED}
                    size={34}
                    shape="rounded"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.83rem', fontWeight: 700, color: '#0F172A', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {child.name}
                    </p>
                    <div style={{ display: 'flex', gap: '5px', marginTop: '3px', flexWrap: 'wrap' }}>
                      {lowAttendance && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#DC2626', backgroundColor: '#FEE2E2', padding: '1px 7px', borderRadius: '10px' }}>Low attendance</span>
                      )}
                      {feeIssue && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7', padding: '1px 7px', borderRadius: '10px' }}>{child.feeStatus}</span>
                      )}
                      {atRisk && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#991B1B', backgroundColor: '#FEE2E2', padding: '1px 7px', borderRadius: '10px' }}>At risk</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {u > 0 && (
                      <span style={{
                        minWidth: '20px', textAlign: 'center', padding: '2px 6px', borderRadius: '12px',
                        backgroundColor: RED, color: 'white', fontSize: '0.68rem', fontWeight: 800,
                      }}>
                        {u}
                      </span>
                    )}
                    {a > 0 && <AlertTriangle size={14} color="#D97706" />}
                  </div>
                </div>
              ))}

              <button
                onClick={() => wards[0] && onViewChild(wards[0].id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  marginTop: '0.5rem', padding: '0.6rem 1rem', borderRadius: '10px',
                  backgroundColor: NAVY, color: 'white', border: 'none',
                  fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.2s', fontFamily: "'Inter', sans-serif",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1B2A4A'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = NAVY; }}
              >
                Open ward dashboard <ChevronRight size={15} />
              </button>
            </div>
          </div>

          {/* Contact card */}
          <div style={cardStyle}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #F1F5F9' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                Institute contacts
              </h4>
            </div>
            <div style={{ padding: '1rem 1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem', color: '#475569' }}>
                <span style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Phone size={14} color="#4F46E5" />
                </span>
                <span>Academic Office · <strong>Mon–Fri, 9 AM – 5 PM</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem', color: '#475569' }}>
                <span style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DollarSign size={14} color="#D97706" />
                </span>
                <span>Fee Counter · <strong>Ext. 410 · fee@aiims.edu.pk</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem', color: '#475569' }}>
                <span style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CalendarCheck size={14} color="#059669" />
                </span>
                <span>Exam Cell · <strong>Ext. 322 · exams@aiims.edu.pk</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
