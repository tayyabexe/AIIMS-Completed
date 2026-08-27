// The real notification feed, shared by every portal's bell and
// "All notifications" page.
//
// Before this, all four portals read from hardcoded arrays in
// src/data/topNavMockData.js and tracked "read" in localStorage only. The
// backend has had a real feed the whole time — GET /api/notifications, scoped
// to the signed-in user by the token, with PUT .../read and .../read-all — so
// nothing here needed a new endpoint.
//
// The shape returned matches what NotificationBell and the Notifications pages
// already consume ({ id, type, title, message, time, read, tag }), so those
// screens keep their markup.

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications as notificationKeys } from './queryKeys';
import { notifications as notificationsApi } from './endpoints';
import { getStoredUser } from './session';
import { relativeTime } from '../utils/datetime';

/**
 * Tone fallback for rows written before `priority` existed.
 *
 * The server now decides the tone per event and sends it as `priority`, which
 * is the only way to tell a routine attendance row from one that crossed the
 * 75% threshold — both are type Attendance. This map is the fallback for the
 * historical rows that predate that column; anything unlisted falls through to
 * 'info' rather than being dropped, so a category added later still renders.
 */
const TONE_BY_TYPE = {
  Fee: 'warning',
  Attendance: 'warning',
  Leave: 'warning',
  Result: 'success',
  Scholarship: 'success',
  Payroll: 'success',
  Library: 'info',
  Registration: 'info',
  Document: 'info',
  Account: 'info',
  Exam: 'info',
  HR: 'info',
  Meeting: 'info',
  Academic: 'info',
};

/**
 * Heading fallback, for the same reason. `title` is now a real column composed
 * by whichever service emitted the row, so every portal shows identical wording
 * for the same event instead of each deriving its own from the category.
 */
const TITLE_BY_TYPE = {
  Fee: 'Fee notice',
  Attendance: 'Attendance update',
  Result: 'Result published',
  Exam: 'Examination',
  Scholarship: 'Scholarship update',
  Library: 'Library notice',
  Registration: 'Registration',
  Document: 'Document update',
  Account: 'Account',
  Leave: 'Leave request',
  Payroll: 'Payroll',
  HR: 'HR notice',
  Meeting: 'Meeting',
  Academic: 'Academic notice',
};

/**
 * `priority` -> the tone key the four portals already style for.
 *
 * `high` maps to 'warning' rather than 'danger' because three of the four
 * portals define no danger tone and would fall back to info — turning the most
 * urgent rows into the flattest-looking ones.
 */
const TONE_BY_PRIORITY = {
  high: 'warning',
  normal: null, // fall through to the per-type tone below
  low: 'info',
};

/*
 * "20 min ago" / "3 days ago" / "12 Mar 2024".
 *
 * The implementation moved to utils/datetime.js when the activity feed and the
 * audit trail needed the same formatting — two copies of a time format is two
 * chances for the same timestamp to be shown differently on two screens. It is
 * re-exported here because four screens already import it from this module.
 * Imported rather than only re-exported because toItem() below uses it too.
 */
export { relativeTime };

/*
 * /change-password is only a destination while there is a password change
 * outstanding.
 *
 * Every "account" notification used to be given that route by the server, the
 * "your password was changed" confirmation included. So on the notification
 * centre the row announcing a completed change was a live link back into the
 * form that made it — click it, change the password again, get another linked
 * row, for ever. That is what was reported on the parent portal.
 *
 * The server no longer attaches the link to a change that has already
 * happened, but rows written before that fix are still in the table and this
 * feed renders them. Dropping the link HERE covers those rows, in all four
 * portals at once, without a data migration.
 *
 * The flag is the test, not the wording: while `mustChangePassword` is set
 * there IS an open request — an administrator has issued a credential — and
 * "New password issued" must stay clickable so the user can act on it. The
 * route itself enforces the same rule (ForcedPasswordChangeRoute), so a typed
 * URL is turned away too; this only stops the portal from drawing a control
 * that would be bounced.
 */
const linkIsLive = (link) => {
  if (link !== '/change-password') return true;
  return !!getStoredUser()?.mustChangePassword;
};

const toItem = (row) => ({
  id: row.notification_id,
  // Server-decided tone first, per-category fallback for pre-`priority` rows.
  type: TONE_BY_PRIORITY[row.priority] || TONE_BY_TYPE[row.type] || 'info',
  // The Notifications pages group and filter by the raw category.
  tag: row.type,
  priority: row.priority || 'normal',
  // The emitter's own wording. The fallback covers the 2024 rows that were
  // written before the column existed.
  title: row.title || TITLE_BY_TYPE[row.type] || row.type || 'Notification',
  message: row.message,
  // The in-portal route that answers this notification, or null when there is
  // nothing to open — the pages render an unlinked row as plain text rather
  // than as a control that does nothing.
  link: row.link && linkIsLive(row.link) ? row.link : null,
  time: relativeTime(row.created_at),
  createdAt: row.created_at,
  read: Boolean(row.is_read),
});

/*
 * How many rows the feed fetches, for every caller.
 *
 * Fixed rather than per-caller: see the key comment below. 50 is what the
 * server defaults to and comfortably more than any surface displays.
 */
const FEED_PAGE = 50;

/**
 * Loads the signed-in user's notifications and keeps read-state in step with
 * the server.
 *
 * `markRead` / `markAllRead` update local state first and then persist, so the
 * badge responds immediately; if the request fails the change is rolled back
 * rather than left showing a state the database does not have.
 *
 * markAllRead returns true when something was actually marked, which is the
 * contract NotificationBell uses to decide whether to show its confirmation.
 */
export default function useServerNotifications({ limit = FEED_PAGE } = {}) {
  const queryClient = useQueryClient();

  /*
   * ONE key for the whole feed, and it is not keyed on `limit`.
   *
   * THE BUG THIS FIXES
   * ------------------
   * The key used to be `notifications.list({ limit })`. The student's top bar
   * asked for 20 and the student's Notifications page asked for the default
   * 50, so the two surfaces resolved to DIFFERENT react-query keys and held
   * two independent copies of the same feed. Marking a row read on the page
   * patched one cache; the bell's bubble went on showing it as unread until a
   * reload. The parent portal had exactly the same split, for the same reason.
   *
   * That is the fault behind "reading a notification does not clear the unread
   * bubble", and it is not fixable by making the two callers agree on a
   * number — the next caller to pass a different one brings it straight back.
   * So the cache key no longer has a page size in it. Every caller shares one
   * entry, one fetch and one read state.
   *
   * `limit` is still honoured; it now trims what this CALLER renders rather
   * than what is fetched. A bell showing the newest 20 of a 50-row feed is a
   * display decision, and it costs nothing — the rows are already in hand.
   */
  const key = useMemo(() => notificationKeys.list(), []);

  const query = useQuery({
    queryKey: key,
    queryFn: () => notificationsApi.list({ limit: FEED_PAGE }),
  });

  const rows = useMemo(
    () => (Array.isArray(query.data?.data) ? query.data.data : []),
    [query.data],
  );

  /*
   * Every category this user has ever received, muted ones included. The list
   * response omits muted rows, so the Settings screen cannot build its
   * category switches from `rows` — a muted category would vanish from the
   * options and could never be switched back on.
   */
  const availableTypes = Array.isArray(query.data?.availableTypes)
    ? query.data.availableTypes
    : [];

  const loading = query.isPending;
  const error = query.error ? query.error.message : null;

  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient, key],
  );

  /*
   * Rewrites the cached feed in place, for the optimistic read-marking below.
   *
   * `unreadCount` is patched alongside the rows, and that is the second fix.
   * The count used to be recomputed as `items.filter(n => !n.read).length` —
   * over the fetched PAGE. The server's own `unreadCount` counts the whole
   * table, so an account with 60 unread rows and a 50-row page was shown "50".
   * The badge now reports the server's figure and this keeps it honest as rows
   * are marked, instead of throwing it away.
   */
  const patch = useCallback((fn) => {
    queryClient.setQueryData(key, (current) => {
      if (!current) return current;
      const data = fn(Array.isArray(current.data) ? current.data : []);
      const readInPage = (current.data || []).filter((r) => !r.is_read).length
        - data.filter((r) => !r.is_read).length;
      return {
        ...current,
        data,
        unreadCount: Math.max(0, Number(current.unreadCount || 0) - readInPage),
      };
    });
  }, [queryClient, key]);

  const items = useMemo(
    () => rows.slice(0, limit).map(toItem),
    [rows, limit],
  );

  /*
   * The badge figure. The server's count, which spans the whole table rather
   * than the page in hand, kept in step optimistically by `patch` above.
   *
   * It falls back to counting the page only when the server has not sent a
   * count — an older backend, or a failed request resolving from a partial
   * cache — because a badge that reads 0 while unread rows are on screen is
   * worse than one that undercounts.
   */
  const unreadCount = useMemo(() => {
    const fromServer = query.data?.unreadCount;
    if (typeof fromServer === 'number') return fromServer;
    return rows.filter((r) => !r.is_read).length;
  }, [query.data, rows]);

  const markRead = useCallback(async (id) => {
    const target = rows.find((r) => r.notification_id === id);
    if (!target || target.is_read) return;

    // Optimistic, and now visible on every surface at once: marking a row read
    // in the list clears the bell in the same tick, which two independent
    // copies of this state could not do.
    patch((list) => list.map((r) => (
      r.notification_id === id ? { ...r, is_read: true } : r
    )));

    try {
      await notificationsApi.markRead(id);
    } catch {
      // Put it back rather than leave a state the database does not have.
      queryClient.setQueryData(key, (current) => (current ? {
        ...current,
        data: (current.data || []).map((r) => (
          r.notification_id === id ? { ...r, is_read: false } : r
        )),
        unreadCount: Number(current.unreadCount || 0) + 1,
      } : current));
    }
  }, [rows, patch, queryClient, key]);

  const markAllRead = useCallback(() => {
    if (unreadCount === 0) return false;

    const previous = queryClient.getQueryData(key);

    queryClient.setQueryData(key, (current) => (current ? {
      ...current,
      data: (current.data || []).map((r) => ({ ...r, is_read: true })),
      // Every unread row, not merely the ones on this page, so a feed longer
      // than the page does not leave a residual badge the user cannot clear.
      unreadCount: 0,
    } : current));

    notificationsApi.markAllRead().catch(() => {
      queryClient.setQueryData(key, previous);
    });

    return true;
  }, [unreadCount, queryClient, key]);

  return {
    items,
    availableTypes,
    unreadCount,
    loading,
    error,
    markRead,
    markAllRead,
    reload: load,
  };
}
