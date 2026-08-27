import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, CheckCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { metaFor, groupByDay } from './notificationMeta';
import './TopNav.css';

/**
 * The notification bell and its dropdown. One component, all four portals.
 *
 * WHAT WAS WRONG WITH THE OLD ONE
 * -------------------------------
 *  - Every row was drawn with the SAME generic bell glyph in a coloured
 *    circle, so fourteen categories were fourteen identical shapes and the
 *    icon carried no information. Per-category icons now come from
 *    notificationMeta.js, which the Notifications pages read too, so a fee
 *    notice looks like a fee notice on every screen in the product.
 *  - The list was one flat run with no time structure: "20 min ago" sat
 *    directly above "12 Mar 2024" with nothing between them. Rows are grouped
 *    into day buckets now.
 *  - There was no way to see only what you had not read, which on an account
 *    with nineteen rows and seven unread is the only thing the bell is for.
 *  - `danger` was styled here but defined by only one of the four portals, so
 *    the most urgent rows fell back to the flattest-looking tone.
 *  - Nothing in TopNav.css had a dark-mode rule, so the whole dropdown stayed
 *    white on a dark portal. It is built on tokens now, defined once and
 *    overridden under body.dark-mode.
 *
 * ITEM SHAPE
 * ----------
 * { id, type: 'info'|'success'|'warning'|'danger', tag, title, message,
 *   time, createdAt, read, link }
 *
 * `tag` is the server's category and picks the icon; `type` is the tone.
 * Both are optional — an item with neither renders with the default bell in
 * the info tone rather than failing.
 *
 * PROPS
 *  - items: the feed. The single-section case, which is three of four portals.
 *  - sections: [{ id, label, items, count, countLabel, emptyText }] for a
 *    dropdown that shows more than one kind of thing. The admin portal uses
 *    it to put recomputed institute alerts above the stored feed. When given,
 *    `items` is ignored.
 *  - unreadCount: the badge figure. Passed rather than derived, because the
 *    server counts unread across the whole table while the bell holds one
 *    page of it — see api/notificationsData.js.
 *  - onMarkAllRead: returns true when something was actually marked, which is
 *    what decides whether the confirmation appears.
 *  - onItemClick: called with the item. Marks it read and opens its link.
 */
export default function NotificationBell({
  items = [],
  sections = null,
  onViewAll,
  onMarkAllRead,
  onItemClick,
  unreadCount,
  title = 'Notifications',
  viewAllLabel = 'View all notifications',
  successMessage = 'All notifications marked as read.',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [justMarkedAll, setJustMarkedAll] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  const timerRef = useRef(null);

  /*
   * The sections to draw, normalised.
   *
   * A caller passing plain `items` becomes one unlabelled section, so the
   * rendering below has exactly one shape to handle rather than two.
   */
  const allSections = useMemo(() => (
    Array.isArray(sections) && sections.length
      ? sections.filter((s) => s && (s.items?.length || s.emptyText))
      : [{ id: 'default', label: null, items }]
  ), [sections, items]);

  const everyItem = useMemo(
    () => allSections.flatMap((s) => s.items || []),
    [allSections],
  );

  /*
   * TWO UNREAD FIGURES, AND THEY ARE NOT THE SAME NUMBER.
   *
   * `unread` is the BADGE: what the caller says is outstanding. For the stored
   * feed that is the server's count across the whole table, which is larger
   * than the page the bell is holding whenever an account has more than 50
   * rows. It is passed in rather than derived for exactly that reason.
   *
   * `unreadHere` is what the FILTER will actually reveal — unread rows present
   * in this dropdown. On the admin bell the two genuinely differ: the badge
   * counts only the ten stored notifications (the clearable ones) while the
   * panel also holds four live institute alerts. Labelling the chip "Unread
   * 10" and then showing fourteen rows would be the control lying about
   * itself.
   */
  const unread = typeof unreadCount === 'number'
    ? unreadCount
    : everyItem.filter((n) => !n.read).length;

  const unreadHere = everyItem.filter((n) => !n.read).length;

  /*
   * "Unread only" is offered but never left as the reason the panel is empty.
   *
   * If the filter is on and everything has since been read, the toggle would
   * show an empty list under a bell that is not empty. It falls back to the
   * full list instead.
   */
  const filtering = unreadOnly && unreadHere > 0;

  const visibleSections = useMemo(() => allSections.map((s) => ({
    ...s,
    // Day grouping applies to the stored feed, not to a section of
    // recomputed conditions — those have no meaningful "when".
    groups: s.grouped === false
      ? [{ id: 'flat', label: null, items: s.items || [] }]
      : groupByDay((s.items || []).filter((n) => (filtering ? !n.read : true))),
    shown: (s.items || []).filter((n) => (filtering ? !n.read : true)).length,
  })), [allSections, filtering]);

  const nothingToShow = visibleSections.every((s) => s.shown === 0 && !s.emptyText);

  useEffect(() => {
    if (!open) return undefined;
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

  // Closing the panel forgets the filter. Re-opening the bell should show
  // what is there, not a view left behind from a previous visit.
  useEffect(() => {
    if (!open) setUnreadOnly(false);
  }, [open]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleMarkAllRead = () => {
    const applied = typeof onMarkAllRead === 'function' ? onMarkAllRead() : false;
    if (!applied) return;
    setUnreadOnly(false);
    setJustMarkedAll(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setJustMarkedAll(false), 2600);
  };

  const renderItem = (n) => {
    const { icon: Icon, tone } = metaFor(n);
    const body = (
      <>
        <span className={`aims-bell-icon tone-${tone}`} aria-hidden="true">
          <Icon size={15} />
        </span>
        <span className="aims-bell-item-body">
          <span className="aims-bell-item-head">
            <span className="aims-bell-item-title">{n.title}</span>
            <span className="aims-bell-item-time">{n.time}</span>
          </span>
          <span className="aims-bell-item-msg">{n.message}</span>
          {n.tag && <span className={`aims-bell-tag tone-${tone}`}>{n.tag}</span>}
        </span>
        {/* The unread marker is decorative — "Unread" is already in the row's
            accessible name below, so announcing it twice is noise. */}
        {!n.read && <span className="aims-bell-item-dot" aria-hidden="true" />}
      </>
    );

    const classes = `aims-bell-item${n.read ? ' read' : ' unread'}`;

    // Clickable only when the caller provides a handler, so a read-only
    // dropdown does not render controls that do nothing.
    return onItemClick ? (
      <button
        type="button"
        key={n.id}
        className={classes}
        // Closed here rather than in each of the four callers. Items carry a
        // link, so a click can navigate — and a dropdown still hanging over
        // the screen it just moved to has to be dismissed.
        onClick={() => { setOpen(false); onItemClick(n); }}
        aria-label={`${n.read ? '' : 'Unread. '}${n.title}. ${n.message}`}
        role="menuitem"
      >
        {body}
      </button>
    ) : (
      <div key={n.id} className={classes}>{body}</div>
    );
  };

  return (
    <div className={`aims-bell ${className}`} ref={ref}>
      <button
        type="button"
        className={`aims-bell-btn${open ? ' open' : ''}${unread > 0 ? ' has-unread' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="aims-bell-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="aims-menu aims-menu-bell" role="menu" ref={panelRef}>
          <div className="aims-bell-head">
            <span className="aims-bell-title">{title}</span>
            {unread > 0 && (
              <span className="aims-bell-unread">{unread} unread</span>
            )}
            {onMarkAllRead && unread > 0 && (
              <button type="button" className="aims-bell-markall" onClick={handleMarkAllRead}>
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          {/* Offered only when it would change what is on screen. A filter
              that can only ever be a no-op is a control that teaches the
              reader it does nothing. */}
          {unreadHere > 0 && everyItem.length > unreadHere && (
            <div className="aims-bell-filters" role="group" aria-label="Filter notifications">
              <button
                type="button"
                className={`aims-bell-chip${!unreadOnly ? ' on' : ''}`}
                onClick={() => setUnreadOnly(false)}
                aria-pressed={!unreadOnly}
              >
                All {everyItem.length}
              </button>
              <button
                type="button"
                className={`aims-bell-chip${unreadOnly ? ' on' : ''}`}
                onClick={() => setUnreadOnly(true)}
                aria-pressed={unreadOnly}
              >
                Unread {unreadHere}
              </button>
            </div>
          )}

          {justMarkedAll && (
            <div className="aims-bell-toast" role="status">
              <CheckCircle2 size={14} /> {successMessage}
            </div>
          )}

          <div className="aims-bell-list">
            {nothingToShow ? (
              <div className="aims-bell-empty">
                <BellOff size={26} aria-hidden="true" />
                <p className="aims-bell-empty-title">You are all caught up</p>
                <p className="aims-bell-empty-note">
                  Anything that needs your attention will appear here.
                </p>
              </div>
            ) : (
              visibleSections.map((s) => (
                (s.shown === 0 && !s.emptyText) ? null : (
                  <div className="aims-bell-section" key={s.id}>
                    {s.label && (
                      <div className="aims-bell-section-head">
                        <span className="aims-bell-section-label">{s.label}</span>
                        {typeof s.count === 'number' && s.count > 0 && (
                          <span
                            className="aims-bell-section-count"
                            title={s.countLabel || undefined}
                          >
                            {s.count}
                          </span>
                        )}
                      </div>
                    )}
                    {s.shown === 0 ? (
                      <p className="aims-bell-section-empty">{s.emptyText}</p>
                    ) : (
                      s.groups.map((g) => (
                        <div key={g.id}>
                          {g.label && <div className="aims-bell-day">{g.label}</div>}
                          {g.items.map(renderItem)}
                        </div>
                      ))
                    )}
                  </div>
                )
              ))
            )}
          </div>

          {onViewAll && (
            <button
              type="button"
              className="aims-bell-footer"
              onClick={() => { setOpen(false); onViewAll(); }}
            >
              {viewAllLabel} <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
