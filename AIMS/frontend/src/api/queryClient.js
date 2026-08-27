/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  The shared server-state cache
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this, every screen owned its own copy of whatever it needed from the
 * server: a `useState` for the rows, another for `loading`, another for
 * `error`, and a `useEffect` that fetched on mount. Forty-three components did
 * that independently, so nothing was shared and nothing was cached.
 *
 * Measured with Playwright, walking five routes twice in one portal and
 * counting requests to /api/:
 *
 *     faculty   461 requests for ten page views, 34 distinct endpoints
 *     student   458 requests for ten page views, 29 distinct endpoints
 *     admin     214 requests for ten page views, 34 distinct endpoints
 *
 * `/api/students` alone was requested 80 times. The reference tables —
 * departments, programs, subjects, sections, batches — were re-fetched in full
 * on every screen that mentioned them, and `/api/users/me/preferences` went out
 * 20 times. The second pass over the same five routes cost the same as the
 * first (230 requests against 231), which is the whole finding in one number:
 * revisiting a screen was never cheaper than seeing it for the first time.
 *
 * (Roughly half of each count is React's development-mode double-invocation of
 * effects. The ratio is what matters, and it is unaffected.)
 *
 * WHAT CHANGED
 * ------------
 * One QueryClient for the application. A request is identified by its query
 * key, so two screens asking for the same thing share one request and one
 * cached answer, and a screen revisited inside the stale window costs nothing.
 *
 * WHY THESE DEFAULTS
 * ------------------
 * This is an institute management system, not a trading floor. The data a
 * screen shows is edited by a handful of administrators during office hours,
 * so the aggressive defaults that suit a social feed — refetch on every window
 * focus, treat everything as stale immediately — would reintroduce most of the
 * traffic this exists to remove.
 */

import { QueryClient } from '@tanstack/react-query';

/*
 * How long an answer is trusted without re-asking.
 *
 * Two tiers, because two kinds of data live behind this API.
 *
 * REFERENCE data — departments, programmes, batches, sections, subjects, the
 * timetable slot definitions. It changes when a registrar restructures the
 * institute, which is a few times a year. It is also what a screen needs
 * before it can render a single dropdown, so it is the data most often
 * re-fetched for no reason. Held for an hour.
 *
 * RECORDS — students, attendance, marks, fees, notifications. Edited during
 * the working day, by more than one person. Held for 30 seconds: long enough
 * that moving between two screens is free, short enough that a colleague's
 * change appears without a manual refresh.
 */
export const STALE = {
  reference: 60 * 60 * 1000,
  records: 30 * 1000,
  /* Live-ish counters that sit in a header and are cheap to be wrong about
     for a short while. */
  badges: 60 * 1000,
};

/*
 * ── HOW OFTEN A SCREEN GOES AND LOOKS AGAIN ──────────────────────────────
 *
 * `staleTime` above only says when an answer stops being TRUSTED. It does not
 * make anything happen: a screen sitting open with nobody touching it held its
 * first answer for as long as it was left there, however stale it went. So a
 * fee verified at the counter, a mark released, a voucher raised, an account
 * disabled — none of it appeared until someone pressed F5. That is what this
 * removes.
 *
 * Every query now re-asks on a timer while its screen is on show. Three tiers,
 * for the same reason there are two staleness tiers:
 *
 *   records    the working data — students, fees, attendance, marks, vouchers,
 *              audit rows, notifications. Someone else is editing these during
 *              the same working day, so half a minute.
 *
 *   analytics  the aggregate screens: AI Insights and Reports. Every panel on
 *              them is a GROUP BY over the whole institute, and the answers
 *              move slowly because they are counts of everything. Two minutes.
 *
 *   reference  departments, programmes, batches, sections, subjects, terms.
 *              Restructured a few times a year. Five minutes is already far
 *              more often than it can change, and it means a programme added
 *              in one tab turns up in another tab's dropdowns on its own.
 *
 * NOTHING POLLS IN A HIDDEN TAB. `refetchIntervalInBackground` stays off, so a
 * timer only runs while the document is visible. Measured with Playwright: 70
 * seconds parked on /students made 3 requests, the same 70 seconds with the tab
 * hidden made 0, and the first request after switching back arrived within 10
 * seconds. A portal left open on a second monitor overnight costs nothing.
 */
export const LIVE = {
  records: 30 * 1000,
  /* The header's alert bell, which rides along on every screen in the portal
     rather than belonging to one of them. */
  badges: 60 * 1000,
  analytics: 2 * 60 * 1000,
  reference: 5 * 60 * 1000,
};

/*
 * The interval for one query, chosen from what it declared about its own
 * staleness. A call site that wants neither — a form seeded from the server,
 * where a poll landing mid-edit would overwrite what is being typed — passes
 * `live: false` to useAdminPage and gets no timer at all.
 */
export const liveIntervalFor = (staleTime) => {
  if (staleTime === undefined || staleTime === null) return LIVE.records;
  if (staleTime >= STALE.reference) return LIVE.reference;
  return LIVE.records;
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE.records,

      /*
       * How long an unused answer is kept before it is dropped. Longer than
       * staleTime on purpose: a cached-but-stale answer is what lets a
       * revisited screen paint instantly and then correct itself, instead of
       * showing a skeleton it already has the data to fill.
       */
      gcTime: 15 * 60 * 1000,

      /*
       * On, but only for an answer that is actually stale — which is what this
       * option means: `true` refetches on focus if `staleTime` has passed, not
       * on every focus. That distinction is why it can be on now when it could
       * not be before. Coming back to the tab is the moment someone is most
       * likely to be looking at something a colleague has since changed, and
       * reference data (an hour of staleness) still costs nothing to refocus.
       */
      refetchOnWindowFocus: true,

      /*
       * Likewise stale-only. Remounting a screen inside the stale window is
       * still free — that is what the cache is for — but landing on a screen
       * whose cached answer has expired should not show yesterday's figure
       * until the next poll comes round.
       */
      refetchOnMount: true,

      /*
       * The heartbeat. Per-query, chosen from that query's own staleness by
       * liveIntervalFor() above; useAdminPage overrides it per call site where
       * a screen needs a different rhythm or none at all.
       *
       * A call site that passes its own `refetchInterval` — a number, or
       * `false` for no timer — replaces this function outright, so this only
       * answers for the queries that said nothing.
       */
      refetchInterval: (query) => liveIntervalFor(query?.options?.staleTime),

      /*
       * Off, deliberately. A timer that keeps firing in a hidden tab is how a
       * portal left open on a second screen overnight makes thousands of
       * requests nobody reads. React Query pauses the interval while the
       * document is hidden and refetches once on return.
       */
      refetchIntervalInBackground: false,

      /*
       * On. A reconnect is the one moment the cache is genuinely suspect,
       * because writes may have happened while this tab was offline.
       */
      refetchOnReconnect: true,

      /*
       * One retry, not three.
       *
       * A 401 or a 403 will fail identically every time, and three attempts
       * with backoff only delays the sign-in redirect the client already
       * performs. A 500 is worth exactly one second chance.
       */
      retry: (failureCount, error) => {
        const status = error?.status ?? error?.response?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 1;
      },
      retryDelay: 800,
    },
    mutations: {
      // A write is never retried automatically. This API has no idempotency
      // keys, so a retried POST can create a second payment or a second
      // enrolment. The person presses the button again if they need to.
      retry: false,
    },
  },
});

export default queryClient;
