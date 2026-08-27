/*
 * The data hook every admin screen uses.
 *
 * WHAT IT WAS
 * -----------
 * A hand-rolled fetch-on-mount: `useState` for the rows, `useState` for
 * loading, `useState` for the error, a `useEffect` that fetched, an
 * AbortController to drop a superseded response, and a `reloadToken` counter
 * so `refresh()` could force a re-run.
 *
 * It did that correctly. What it could not do was share. The hook is handed an
 * inline closure — `() => adminApi.students(p)` — and a closure has no
 * identity, so two screens asking for exactly the same rows looked like two
 * unrelated requests. `/api/students` went out 80 times in a ten-page walk of
 * the faculty portal for that reason, and revisiting a screen never cost less
 * than seeing it for the first time.
 *
 * WHAT IT IS NOW
 * --------------
 * The same signature and the same return shape, backed by the shared
 * QueryClient. Every call site keeps working; the ones that pass a `key` join
 * the cache.
 *
 * THE KEY IS THE WHOLE POINT
 * --------------------------
 * `key` names the RESOURCE, and `params` narrows it. Two screens that pass the
 * same key and the same params share one request and one cached answer. Keys
 * come from api/queryKeys.js rather than being written inline, because a key
 * is a contract between screens that never import each other and a typo in one
 * of them silently costs the cache.
 *
 * A call site with no key still works, and still gets caching within its own
 * mount, but is given a key private to that instance so it can never collide
 * with another screen. That fallback is a migration aid, not a destination.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { LIVE } from '../api/queryClient';

let anonymousSeq = 0;

/**
 * @param fetcher  (params, { signal }) => Promise<response>
 * @param params   the filter/paging object; a change re-runs the fetch
 * @param options  { key, debounceMs, enabled, staleTime, live }
 *
 * `live` controls the screen's own heartbeat — see api/queryClient.js:
 *   undefined  the tier for this query's staleness (the default; 30s for
 *              records, 5 min for reference data)
 *   false      no timer. For a form seeded from the server, where an answer
 *              arriving mid-edit would overwrite what is being typed.
 *   a number   that many milliseconds, for a screen with its own rhythm.
 */
export function useAdminPage(fetcher, params, options = {}) {
  const {
    key,
    debounceMs = 0,
    enabled = true,
    staleTime,
    live,
  } = options;

  const queryClient = useQueryClient();

  /*
   * A stable identity for a call site that has not been given a key yet.
   * Generated once per mount, so it behaves exactly like the old hook did:
   * private to this component, no sharing, no collisions.
   */
  const fallbackKey = useRef(null);
  if (fallbackKey.current === null) {
    anonymousSeq += 1;
    fallbackKey.current = `unkeyed-${anonymousSeq}`;
  }

  /*
   * Serialised so a caller can pass a fresh object literal on every render
   * without churning the key. This is the same reason the previous version
   * serialised `params`, and the same reason it must stay.
   */
  const paramsKey = JSON.stringify(params ?? {});

  /*
   * Debounce.
   *
   * Several screens drive this straight from a search box, so without it every
   * keystroke is a request. react-query has no debounce of its own, so the
   * DEBOUNCED PARAMS are what the query is keyed on: the key only changes once
   * typing has settled, and until then the query simply is not re-run.
   *
   * With `debounceMs` of 0 — every screen that is not driven by typing — the
   * settled value is assigned synchronously on first render, so there is no
   * extra render and no flash of an unkeyed state.
   */
  const [settledParamsKey, setSettledParamsKey] = useState(paramsKey);

  useEffect(() => {
    if (!debounceMs) {
      setSettledParamsKey(paramsKey);
      return undefined;
    }
    const timer = setTimeout(() => setSettledParamsKey(paramsKey), debounceMs);
    return () => clearTimeout(timer);
  }, [paramsKey, debounceMs]);

  const settledKey = useMemo(
    () => (key ? ['admin-page', key, JSON.parse(settledParamsKey)]
      : ['admin-page', fallbackKey.current, JSON.parse(settledParamsKey)]),
    [key, settledParamsKey],
  );

  // Screens define their fetcher inline, so it is a new function every render.
  // Kept in a ref so it never participates in the query key.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const query = useQuery({
    queryKey: settledKey,
    queryFn: ({ signal }) => fetcherRef.current(JSON.parse(settledParamsKey), { signal }),
    enabled,

    /*
     * Spread, not `staleTime` outright.
     *
     * Most call sites do not pass one, and writing `staleTime: undefined` is
     * not the same as leaving the option out — an explicit undefined can
     * shadow the client-wide default instead of deferring to it, which leaves
     * the query permanently stale and refetching on every observer change.
     * Omitting the key entirely is what actually inherits the default.
     */
    ...(staleTime === undefined ? {} : { staleTime }),

    /*
     * The heartbeat, for the same reason and with the same care: omitting the
     * key inherits the client-wide interval, and writing an explicit
     * `undefined` would shadow it. `live: false` is a real value and must
     * reach the query — it is how a form opts out of being overwritten.
     */
    ...(live === undefined ? {} : { refetchInterval: live === true ? LIVE.records : live }),

    /*
     * Paging and filtering keep the previous page on screen while the next one
     * loads, instead of collapsing the table to a skeleton and back. The old
     * hook could not do this — it cleared to `loading` on every param change.
     */
    placeholderData: keepPreviousData,
  });

  /*
   * refresh() now means "this answer is wrong, go and get it again", which is
   * what every call site already used it for after a write. Invalidating
   * rather than refetching means any OTHER screen holding the same key is
   * corrected too — the reason a saved edit used to show stale rows one screen
   * over.
   */
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: settledKey }),
    [queryClient, settledKey],
  );

  /*
   * `loading` keeps its old meaning: "there is nothing to show yet". A
   * background refetch of data already on screen is deliberately not loading,
   * or every cached revisit would flash its skeleton for no reason.
   */
  return {
    data: query.data ?? null,
    loading: query.isPending && !query.isPlaceholderData,
    error: query.error ? (query.error.message || 'Could not load this page.') : null,
    refresh,
    // Extras, for screens that want to show a quiet "updating" hint.
    isFetching: query.isFetching,
    isStale: query.isStale,
    queryKey: settledKey,
  };
}

/**
 * Paging and filter state for a list screen, kept together because changing a
 * filter must always reset the page — landing on "page 7 of 2" after narrowing
 * a search shows an empty table and looks like the filter matched nothing.
 *
 * Unchanged by the move to a shared cache: this is client state, not server
 * state, and it belongs to the one screen that owns the table.
 */
export function useListParams(initial = {}) {
  const [filters, setFiltersState] = useState(initial);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initial.limit || 25);

  const setFilters = useCallback((update) => {
    setFiltersState((current) => {
      const next = typeof update === 'function' ? update(current) : { ...current, ...update };
      return next;
    });
    setPage(1);
  }, []);

  const setFilter = useCallback((name, value) => {
    setFilters({ [name]: value });
  }, [setFilters]);

  const reset = useCallback(() => {
    setFiltersState(initial);
    setPage(1);
    // `initial` is a literal at every call site, so it is intentionally not a
    // dependency — including it would rebuild reset() on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Empty values are dropped by the api client's query() helper, so filters
  // can be passed straight through without pruning here.
  const params = useMemo(
    () => ({ ...filters, page, limit }),
    [filters, page, limit],
  );

  return { params, filters, setFilter, setFilters, page, setPage, limit, setLimit, reset };
}

/*
 * The same hook under a portal-neutral name.
 *
 * `useAdminPage` was written for, and named after, the admin portal. The
 * behaviour it now provides — a keyed, shared, cached request with
 * loading/error/refresh — is what every screen in the product needs, and the
 * faculty, student and parent portals were each hand-rolling it. Converting
 * them to a hook called `useAdminPage` would read as a mistake at every call
 * site, so they use this alias instead.
 *
 * One implementation, two names, no second cache.
 */
export const useServerQuery = useAdminPage;

export default useAdminPage;
