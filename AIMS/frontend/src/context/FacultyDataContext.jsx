import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadFacultyData } from '../api/facultyData';
import { faculty as facultyKeys } from '../api/queryKeys';
import { useAuth } from './AuthContext';

// ---------------------------------------------------------------------------
// Faculty portal data.
//
// This was a localStorage simulation with an artificial 650ms delay that served
// generated sample records. It now loads the signed-in teacher's real data from
// the backend: their timetable, the students in their sections, and those
// students' attendance.
//
// Two collections are still sample data because aims_db has no tables for them:
// assignments and submissions. See INTEGRATION.md.
// ---------------------------------------------------------------------------

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();

  const queryClient = useQueryClient();

  /*
   * The teacher's timetable, sections, students and their attendance — one
   * composite load, now held in the shared cache instead of in this provider.
   *
   * `enabled: !!user` replaces the guard that used to be the first branch of
   * the effect. That guard existed because leaving `loading` true with no
   * session stranded every faculty page on its spinner forever; the query is
   * simply not run without a user, and `loading` below is derived, so it
   * cannot get stuck in the first place.
   */
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
  const key = useMemo(() => facultyKeys.data(), []);

  const query = useQuery({
    queryKey: key,
    queryFn: () => loadFacultyData(user),
    enabled: !!user,
  });

  const data = user ? (query.data ?? null) : null;
  const loading = !!user && query.isPending;
  const error = query.error
    ? (query.error.message || 'Failed to load data. Please refresh the page.')
    : null;

  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient, key],
  );

  // Edits are held in memory. Screens that write through to the API call the
  // endpoints directly; this only keeps the local view in step.
  const persist = useCallback(() => {}, []);

  // updateCollection('students', (students) => [...]) or (list) => list
  const updateCollection = useCallback(
    (collection, updater) => {
      /*
       * Writes into the cached document rather than into local state.
       *
       * Same semantics as before — an in-memory edit that keeps the screen in
       * step with a write it has already sent — but every faculty screen
       * reading this key sees it, which local state could not do. The
       * parameter is renamed from `key` because `key` is now the query key in
       * this scope.
       */
      queryClient.setQueryData(key, (prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          [collection]: typeof updater === 'function' ? updater(prev[collection]) : updater,
        };
        persist(next);
        return next;
      });
    },
    [persist, queryClient, key]
  );

  // Previously this restored generated sample data. It now re-fetches from the
  // backend, which is the equivalent action against real data.
  const resetData = useCallback(() => { load(); }, [load]);

  const value = useMemo(
    () => ({ data, loading, error, updateCollection, resetData, reload: load }),
    [data, loading, error, updateCollection, resetData, load]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
