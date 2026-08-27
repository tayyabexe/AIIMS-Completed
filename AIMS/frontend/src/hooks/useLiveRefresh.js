import { useEffect, useRef } from 'react';

/*
 * A heartbeat for the few screens that do not go through the shared cache.
 *
 * Almost everything in the portal fetches through useAdminPage, so it inherits
 * the polling defaults in api/queryClient.js and keeps itself up to date with
 * no code of its own. Two places cannot: the announcements board, which holds
 * its rows in useState because it also owns paging, filters and the audience
 * options that come back with them; and the pinned insight cards, which run a
 * saved query through a queue rather than a plain GET.
 *
 * Rather than leave those two as the only screens in the portal that go stale
 * until someone presses F5, they call this.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   · Nothing fires while the tab is hidden. The timer is cleared on
 *     `visibilitychange` and restarted on return, so a portal left open on a
 *     second monitor overnight makes no requests — the same rule react-query
 *     is following for everything else.
 *   · One run on return to a hidden tab, immediately, rather than waiting out
 *     the rest of the interval.
 *   · The callback is held in a ref, so a screen can pass an inline closure
 *     without restarting the timer on every render.
 *
 * The callback is expected to refresh QUIETLY — no spinner, no skeleton. A
 * background refresh that blanks the list it is refreshing is worse than a
 * stale list.
 *
 * @param {() => void} fn        what to re-run
 * @param {number} intervalMs    how often, in ms; 0 or negative disables
 * @param {boolean} [enabled]    false parks the timer entirely
 */
export default function useLiveRefresh(fn, intervalMs, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || !intervalMs || intervalMs <= 0) return undefined;

    let timer = null;

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') fnRef.current?.();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Caught up on arrival, not at the end of the next full interval.
        fnRef.current?.();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
