import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardCheck,
  FileText,
  Megaphone,
  UserMinus,
  Clock,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  KeyRound,
  Wallet,
} from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import Modal from '../../components/faculty/Modal.jsx';
import Pagination from '../../components/faculty/Pagination.jsx';
import { useFacultyBadges } from '../../context/FacultyBadgeContext.jsx';
import './Notifications.css';

/*
 * Tag → icon / accent mapping. The keys are `notifications.type` values from
 * the database; anything not listed falls back to DEFAULT_TAG_META rather than
 * being hidden, so a category added later still renders.
 */
const DEFAULT_TAG_META = { icon: Megaphone, accent: '#2a63c9', accentBg: '#eaf1fd' };

const TAG_META = {
  Attendance: { icon: ClipboardCheck, accent: '#b6791b', accentBg: '#fdf2df' },
  Result: { icon: FileText, accent: '#d1373f', accentBg: '#fdeaea' },
  Exam: { icon: GraduationCap, accent: '#d1373f', accentBg: '#fdeaea' },
  Academic: { icon: Megaphone, accent: '#2a63c9', accentBg: '#eaf1fd' },
  Leave: { icon: UserMinus, accent: '#6b7078', accentBg: '#eef0f2' },
  HR: { icon: UserMinus, accent: '#6b7078', accentBg: '#eef0f2' },
  Payroll: { icon: Wallet, accent: '#1f7a5a', accentBg: '#e6f4ef' },
  Fee: { icon: Wallet, accent: '#1f7a5a', accentBg: '#e6f4ef' },
  Account: { icon: KeyRound, accent: '#6b7078', accentBg: '#eef0f2' },
  Meeting: { icon: Megaphone, accent: '#7c3aed', accentBg: '#f3ebfd' },
};

const ALL_TYPES = 'All Types';
const PAGE_SIZE = 5;

export default function Notifications() {
  // The portal's shared feed, so marking something read here also clears the
  // bell and the sidebar bubble. This page used to hold its own copy.
  const { notifications } = useFacultyBadges();
  const { items, unreadCount, loading, error, markRead, markAllRead } = notifications;
  const [tab, setTab] = useState('unread');
  const [tagFilter, setTagFilter] = useState(ALL_TYPES);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState(null);
  const [justMarked, setJustMarked] = useState(false);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const readCount = items.length - unreadCount;

  const source = useMemo(
    () => items.filter((n) => (tab === 'unread' ? !n.read : n.read)),
    [items, tab]
  );

  const filtered = useMemo(
    () => source.filter((n) => tagFilter === ALL_TYPES || n.tag === tagFilter),
    [source, tagFilter]
  );

  // The Type dropdown is built from the categories actually present in this
  // teacher's notifications rather than a fixed list, so it can never offer a
  // filter that matches nothing.
  const tagOptions = useMemo(
    () => [ALL_TYPES, ...[...new Set(items.map((n) => n.tag).filter(Boolean))].sort()],
    [items]
  );

  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const switchTab = (t) => {
    setTab(t);
    setPage(1);
  };

  const changeTagFilter = (e) => {
    setTagFilter(e.target.value);
    setPage(1);
  };

  const openNotification = (n) => {
    markRead(n.id);
    setSelected(n);
  };

  const handleMarkAllRead = () => {
    if (!markAllRead()) return;
    setJustMarked(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setJustMarked(false), 2600);
    setTab('read');
    setPage(1);
  };

  const selectedMeta = selected ? TAG_META[selected.tag] || DEFAULT_TAG_META : null;

  return (
    <Layout title="Notifications">
      <div className="notif-top-row">
        <div className="notif-tabs">
          <button
            className={`notif-tab${tab === 'unread' ? ' active' : ''}`}
            onClick={() => switchTab('unread')}
          >
            Unread ({unreadCount})
          </button>
          <button
            className={`notif-tab${tab === 'read' ? ' active' : ''}`}
            onClick={() => switchTab('read')}
          >
            Read ({readCount})
          </button>
        </div>
        <button className="mark-read-link" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
          Mark all as read
        </button>
      </div>

      {justMarked && (
        <div className="notif-success" role="status">
          <CheckCircle2 size={15} /> All notifications marked as read.
        </div>
      )}

      <div className="filters-row">
        <div className="filter-field">
          <label>Type</label>
          <select value={tagFilter} onChange={changeTagFilter}>
            {tagOptions.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="notif-empty">Loading your notifications…</div>
      ) : error ? (
        <div className="notif-empty">Could not load your notifications: {error}</div>
      ) : pageItems.length === 0 ? (
        <div className="notif-empty">
          {tab === 'unread' && unreadCount === 0 && tagFilter === ALL_TYPES
            ? "You're all caught up 🎉"
            : 'Nothing here yet.'}
        </div>
      ) : (
        <>
          {pageItems.map((n) => {
            const meta = TAG_META[n.tag] || DEFAULT_TAG_META;
            const Icon = meta.icon;
            return (
              <div
                role="button"
                tabIndex={0}
                className={`notif-card${n.read ? ' read' : ' unread'}`}
                key={n.id}
                style={{ '--accent': meta.accent, '--accent-bg': meta.accentBg }}
                onClick={() => openNotification(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openNotification(n);
                  }
                }}
              >
                <div className="notif-icon-box">
                  <Icon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="notif-card-title-row">
                    <h4>{n.title}</h4>
                    <span className="notif-card-time">
                      <Clock size={12} /> {n.time}
                    </span>
                  </div>
                  <div className="notif-card-body">{n.message}</div>
                  <div className="notif-card-foot">
                    <span className="badge badge-neutral">{n.tag}</span>
                    <span className={`notif-status-badge ${n.read ? 'read' : 'unread'}`}>
                      {n.read ? 'Read' : 'Unread'}
                    </span>
                    <span className="notif-open-label">
                      View details <ChevronRight size={13} />
                    </span>
                  </div>
                </div>
                {!n.read && <span className="notif-unread-dot" aria-label="Unread" />}
              </div>
            );
          })}
          <div className="card">
            <Pagination
              currentPage={page}
              totalItems={filtered.length}
              itemsPerPage={pageSize}
              onPageChange={setPage}
              pageSizes={[10, 25, 50, 100]}
              onPageSizeChange={setPageSize}
            />
          </div>
        </>
      )}

      {/* Notification detail */}
      {selected && selectedMeta && (
        <Modal
          title={selected.title}
          subtitle={selected.tag}
          onClose={() => setSelected(null)}
          width="540px"
          footer={
            <>
              <button className="notif-back-btn" onClick={() => setSelected(null)}>
                <ArrowLeft size={15} /> Back to notifications
              </button>
              {/* The screen that answers this notification. Rendered only when
                  the row carries one — historical rows have no link, and a
                  button that goes nowhere is worse than no button. */}
              {selected.link && (
                <button
                  className="notif-go-btn"
                  onClick={() => { setSelected(null); navigate(selected.link); }}
                >
                  Go to {selected.tag} <ArrowRight size={15} />
                </button>
              )}
            </>
          }
        >
          <div className="notif-detail">
            <div
              className="notif-detail-icon"
              style={{ background: selectedMeta.accentBg, color: selectedMeta.accent }}
            >
              <selectedMeta.icon size={22} />
            </div>
            <p className="notif-detail-message">{selected.message}</p>
            <span className="notif-detail-time">
              <Clock size={13} /> {selected.time}
            </span>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
