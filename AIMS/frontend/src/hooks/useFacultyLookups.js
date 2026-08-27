/*
 * The two lookups every faculty screen opens with.
 *
 * WHY THIS EXISTS
 * ---------------
 * `GET /api/faculty/classes` answers "which sections does this teacher take",
 * and four screens need it before they can draw anything: My Classes, Reports,
 * Attendance and Marks all put it in a dropdown. Each one fetched it
 * separately into its own `useState`, with its own loading and error flags —
 * four copies of the same list, four requests, and four slightly different
 * spellings of the same three-state dance.
 *
 * `GET /api/faculty/exams` is the same story for the Marks screen.
 *
 * These are the smallest useful unit to share: one hook, one key, one request.
 * A screen that opens second inside the stale window draws its dropdown from
 * the cache with no request at all.
 *
 * The return shape is deliberately the same `{ data, loading, error, refresh }`
 * the rest of the product uses, so a call site reads the same as it did before.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { faculty as facultyApi } from '../api/endpoints';
import { faculty as facultyKeys } from '../api/queryKeys';

function useFacultyList(keyFactory, fetcher, fallbackMessage) {
  const queryClient = useQueryClient();

  /*
   * The key is memoised here, not built at the call site.
   *
   * The factories return a fresh array each call, which react-query does not
   * mind — it hashes keys rather than comparing identity — but `refresh` below
   * closes over it, so an unmemoised key rebuilds that callback on every
   * render. Anything a caller does with `refresh` in a dependency array then
   * re-runs continuously. That is not hypothetical: the same mistake in the
   * badge and notification providers cost ten requests per five-route walk
   * before it was caught.
   */
  const key = useMemo(() => keyFactory(), [keyFactory]);

  const query = useQuery({
    queryKey: key,
    queryFn: fetcher,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient, key],
  );

  return {
    // Always an array. Every call site indexes straight into it, so a null on
    // the first render would be a crash rather than an empty dropdown.
    data: Array.isArray(query.data?.data) ? query.data.data : [],
    loading: query.isPending,
    error: query.error ? (query.error.message || fallbackMessage) : null,
    refresh,
  };
}

/** The sections this teacher takes. */
export function useFacultyClasses() {
  return useFacultyList(
    facultyKeys.classes,
    () => facultyApi.classes(),
    'Could not load your classes.',
  );
}

/** The exams this teacher owns. */
export function useFacultyExams() {
  return useFacultyList(
    facultyKeys.exams,
    () => facultyApi.exams(),
    'Could not load your exams.',
  );
}

export default useFacultyClasses;
