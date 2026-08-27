import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, AlertTriangle, CheckCircle2, Info, ChevronRight } from 'lucide-react';
import useServerNotifications from '../../api/notificationsData';
import RouteLoader from '../common/RouteLoader';

/**
 * The admin portal's Notifications screen.
 *
 * This tab used to render the Meeting Requests component, which was itself
 * driven by a hardcoded list of twelve invented requests. It now shows the
 * signed-in admin's real rows from GET /api/notifications, scoped to their own
 * account by the token.
 */

const TONE = {
  success: { icon: CheckCircle2, bg: '#ECFDF5', color: '#059669' },
  warning: { icon: AlertTriangle, bg: '#FEF3C7', color: '#D97706' },
  danger: { icon: AlertTriangle, bg: '#FEE2E2', color: '#DC2626' },
  info: { icon: Info, bg: '#EFF6FF', color: '#2563EB' },
};

const ALL = 'All types';

export default function NotificationsView() {
  const { items, unreadCount, loading, error, markRead, markAllRead } = useServerNotifications();
  const [tagFilter, setTagFilter] = useState(ALL);
  const navigate = useNavigate();

  /*
   * Reading and acting are one gesture here. Every row the backend emits to an
   * administrator is something to go and do — a payment waiting to be verified,
   * a document waiting to be checked — so the row opens the screen that answers
   * it and marks itself read on the way. Rows with no `link` (the historical
   * 2024 ones) still mark read, they just don't navigate.
   */
  const open = (n) => {
    markRead(n.id);
    if (n.link) navigate(n.link);
  };

  // Built from the categories actually present, so the filter can never offer
  // a value that matches nothing.
  const tagOptions = useMemo(
    () => [ALL, ...[...new Set(items.map((n) => n.tag).filter(Boolean))].sort()],
    [items],
  );

  const filtered = useMemo(
    () => (tagFilter === ALL ? items : items.filter((n) => n.tag === tagFilter)),
    [items, tagFilter],
  );

  const card = {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
  };

  const message = (text, tone = '#94A3B8') => (
    <div style={{ ...card, padding: '3rem', textAlign: 'center', color: tone, fontWeight: 600 }}>
      {text}
    </div>
  );

  return (
    <div className="tab-transition" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Notifications
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
            {loading
              ? 'Loading…'
              : `${items.length} notification${items.length === 1 ? '' : 's'} · ${unreadCount} unread`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            style={{
              padding: '0.5rem 0.85rem', borderRadius: '10px', border: '1px solid #CBD5E1',
              fontSize: '0.8rem', fontWeight: 700, color: '#0F172A',
              backgroundColor: '#FFFFFF', outline: 'none', cursor: 'pointer',
            }}
          >
            {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '0.5rem 0.9rem', borderRadius: '10px',
              border: '1px solid #CBD5E1',
              backgroundColor: unreadCount === 0 ? '#F8FAFC' : '#FFFFFF',
              color: unreadCount === 0 ? '#CBD5E1' : '#334155',
              fontSize: '0.8rem', fontWeight: 700,
              cursor: unreadCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <CheckCheck size={15} /> Mark all read
          </button>
        </div>
      </div>

      {loading && <RouteLoader label="Loading notifications…" />}
      {!loading && error && message(`Could not load notifications: ${error}`, '#DC2626')}
      {!loading && !error && items.length === 0 && message('You have no notifications.')}
      {!loading && !error && items.length > 0 && filtered.length === 0
        && message(`No notifications of type "${tagFilter}".`)}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ ...card, padding: '0.5rem 0' }}>
          {filtered.map((n, i) => {
            const tone = TONE[n.type] || TONE.info;
            const Icon = tone.icon;
            return (
              <button
                type="button"
                key={n.id}
                onClick={() => open(n)}
                style={{
                  width: '100%', textAlign: 'left', border: 'none', background: 'none',
                  display: 'flex', alignItems: 'flex-start', gap: '0.9rem',
                  padding: '1rem 1.5rem', cursor: 'pointer',
                  borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
                  backgroundColor: n.read ? 'transparent' : 'rgba(239, 246, 255, 0.5)',
                }}
              >
                <span style={{
                  width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: tone.bg, color: tone.color,
                }}>
                  <Icon size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '0.9rem', color: '#0F172A' }}>{n.title}</strong>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                      borderRadius: '9999px', backgroundColor: tone.bg, color: tone.color,
                    }}>
                      {n.tag}
                    </span>
                    {!n.read && (
                      <span style={{
                        width: '7px', height: '7px', borderRadius: '50%',
                        backgroundColor: '#2563EB',
                      }} aria-label="Unread" />
                    )}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.85rem', color: '#475569', marginTop: '3px' }}>
                    {n.message}
                  </span>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px',
                  }}>
                    {n.time}
                    {/* Only shown when there is somewhere to go, so the
                        affordance never promises a jump that won't happen. */}
                    {n.link && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', color: tone.color, fontWeight: 600 }}>
                        · Open <ChevronRight size={12} />
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', color: '#CBD5E1' }}>
          <Bell size={32} />
        </div>
      )}
    </div>
  );
}
