import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STALE } from '../api/queryClient';
import { faculty as facultyKeys } from '../api/queryKeys';
import { faculty as facultyApi } from '../api/endpoints';
import useServerNotifications from '../api/notificationsData';
import { usePreferences } from './PreferencesContext';

/*
 * The sidebar bubbles, and the one notification feed behind them.
 *
 * Both counts used to be literals in Sidebar.jsx — `badge: 5` on Assignments
 * and `badge: 2` on Notifications — identical for every teacher, and nothing
 * the teacher did ever removed them.
 *
 * There is one feed instance for the whole portal so the bell, the sidebar and
 * the Notifications page cannot disagree: marking something read on any of
 * them clears the bubble on all three. Previously the header and the page each
 * created their own, and reading on one left the other's badge stale.
 *
 * Assignments is "what has appeared since you last opened that screen". The
 * server counts assignments above a watermark held in the user's preferences;
 * the Assignments page calls acknowledgeAssignments() when it mounts, which
 * advances the watermark and clears the bubble.
 */

const FacultyBadgeContext = createContext(null);

/* The zero state, used for the initial value and for a failed count. */
const EMPTY_BADGES = { assignments: 0, notifications: 0, latest_assignment_id: 0 };

export function FacultyBadgeProvider({ children }) {
  const notifications = useServerNotifications({ limit: 50 });
  const { preferences, save } = usePreferences();

  const queryClient = useQueryClient();
  /*
   * Memoised.
   *
   * The key factories build a fresh array on every call, and react-query is
   * happy with that — it hashes the key rather than comparing identity. But
   * anything that puts the key in a DEPENDENCY ARRAY sees a new value on every
   * render, so the callback is rebuilt, the effect that depends on it re-runs,
   * and an effect that invalidates the key becomes a refetch loop.
   *
   * Measured before this was fixed: /api/faculty/badges and /api/notifications
   * each went out 10 times in a five-route walk — once per render pass — while
   * every other endpoint had settled to 1.
   */
  const badgeKey = useMemo(() => facultyKeys.badges(), []);

  /*
   * The sidebar bubble counts.
   *
   * This was a fetch-on-mount into provider state, re-run whenever a
   * preference that gates a bubble changed. It went out 30 times in a ten-page
   * walk of this portal, because the provider is remounted by every navigation
   * that reloads the page and its state died with it.
   *
   * The `mounted` ref that guarded every `setBadges` is gone with it. It
   * existed because StrictMode's double-invoke could otherwise leave the flag
   * false for good and the bubbles would never load; the cache has no such
   * flag to strand, and an unmounted observer is simply dropped.
   *
   * A failed count is still not worth an error screen — the nav works, it just
   * shows no bubble — so the query resolves to zeroes rather than rejecting.
   */
  const badgeQuery = useQuery({
    queryKey: badgeKey,
    queryFn: () => facultyApi.badges()
      .then((res) => res?.data || EMPTY_BADGES)
      .catch(() => EMPTY_BADGES),
    staleTime: STALE.badges,
  });

  const badges = badgeQuery.data || EMPTY_BADGES;

  const loadBadges = useCallback(
    () => queryClient.invalidateQueries({ queryKey: badgeKey }),
    [queryClient, badgeKey],
  );

  /*
   * Re-read whenever the preferences that gate the bubbles change, so
   * switching a badge off in Settings takes effect without a reload. Same
   * intent as before; it now invalidates the shared key instead of re-running
   * a private fetch.
   */
  useEffect(() => {
    loadBadges();
  }, [
    loadBadges,
    preferences.notifications.assignmentBadge,
    preferences.notifications.unreadBadge,
    preferences.seen.assignments,
  ]);

  // Muted categories are filtered out by the server, so changing the set in
  // Settings has to re-fetch the feed for the bell and the list to agree with
  // the new choice. Keyed on the joined value rather than the array so a
  // re-render with an equal list does not refetch.
  const mutedKey = preferences.notifications.mutedTypes.join('|');
  const reloadFeed = notifications.reload;

  useEffect(() => {
    reloadFeed();
  }, [mutedKey, reloadFeed]);

  /**
   * Marks every assignment currently on the teacher's subjects as seen.
   *
   * The watermark only moves forward (enforced server-side too), so this is
   * safe to call on every visit to the page.
   */
  const acknowledgeAssignments = useCallback(async () => {
    const latest = badges.latest_assignment_id;
    if (!latest || preferences.seen.assignments >= latest) return;

    // Clear the bubble straight away; the effect above reconciles with the
    // server once the preference has been saved. Written into the cache so
    // every screen showing this count clears together.
    queryClient.setQueryData(badgeKey, (prev) => ({ ...(prev || EMPTY_BADGES), assignments: 0 }));
    await save({ seen: { assignments: latest } });
  }, [badges.latest_assignment_id, preferences.seen.assignments, save, queryClient, badgeKey]);

  const value = useMemo(() => ({
    notifications,
    // The unread figure comes from the live feed rather than the badges call,
    // so opening a notification clears the bubble immediately instead of on
    // the next poll. The preference decides whether it is shown at all.
    notificationCount: preferences.notifications.unreadBadge
      ? notifications.unreadCount
      : 0,
    assignmentCount: preferences.notifications.assignmentBadge
      ? badges.assignments
      : 0,
    acknowledgeAssignments,
    refreshBadges: loadBadges,
  }), [
    notifications,
    preferences.notifications.unreadBadge,
    preferences.notifications.assignmentBadge,
    badges.assignments,
    acknowledgeAssignments,
    loadBadges,
  ]);

  return <FacultyBadgeContext.Provider value={value}>{children}</FacultyBadgeContext.Provider>;
}

export function useFacultyBadges() {
  return useContext(FacultyBadgeContext);
}
