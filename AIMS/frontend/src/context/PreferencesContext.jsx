import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { users as usersApi } from '../api/endpoints';
import { STALE } from '../api/queryClient';
import { account as accountKeys } from '../api/queryKeys';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';

/*
 * The signed-in user's settings, from GET /api/users/me/preferences.
 *
 * Every Settings screen used to keep its switches in React state alone: the
 * faculty page reset to the same five defaults on every load and its "Save
 * Changes" button only raised a toast. These are stored per user, so a choice
 * survives a reload and follows the account to another machine.
 *
 * Only preferences the app actually honours exist here — no email or push
 * toggles, because this project has neither a mail transport nor a push
 * service. See backend/src/services/userPreferenceService.js.
 */

const PreferencesContext = createContext(null);

export const DEFAULT_PREFERENCES = {
  notifications: {
    unreadBadge: true,
    assignmentBadge: true,
    mutedTypes: [],
  },
  appearance: {
    theme: 'light',
    density: 'comfortable',
    fontSize: 'medium',
  },
  seen: {
    assignments: 0,
  },
};

export function PreferencesProvider({ children }) {
  const { user } = useAuth();
  const { setTheme } = useTheme();

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
  const key = useMemo(() => accountKeys.preferences(), []);

  /*
   * One request for the account's preferences, for the whole application.
   *
   * This was a `useEffect` that fetched on mount and stored the answer in this
   * provider's own state. That was already the best-shaped version of the
   * pattern in the codebase — one provider, mounted once — and it still went
   * out 20 times in a ten-page walk, because the provider remounts on every
   * full page load and nothing outlived it.
   *
   * `STALE.reference`: a person changes their theme or density a few times
   * ever, and when they do, `save()` writes the new document straight into the
   * cache below, so a long stale window can never show a stale switch.
   */
  const prefQuery = useQuery({
    queryKey: key,
    queryFn: () => usersApi.preferences(),
    enabled: !!user,
    staleTime: STALE.reference,
  });

  const preferences = useMemo(
    () => prefQuery.data?.data || DEFAULT_PREFERENCES,
    [prefQuery.data],
  );

  const loading = !!user && prefQuery.isPending;
  const error = prefQuery.error ? prefQuery.error.message : null;

  /*
   * The stored theme is the authority once the account is known; before that
   * ThemeContext runs on whatever this browser last used.
   *
   * Applied in an effect rather than inside the fetch, because the answer can
   * now arrive from the cache without a fetch happening at all.
   */
  const storedTheme = preferences.appearance?.theme;
  useEffect(() => {
    if (user && storedTheme) setTheme(storedTheme);
  }, [user, storedTheme, setTheme]);

  /**
   * Saves a partial document. The server merges it onto what is stored, so a
   * card can save only its own keys.
   *
   * Applies the change locally first so the UI responds at once, and rolls
   * back if the request fails rather than leaving a switch showing a setting
   * the account does not have.
   */
  const save = useCallback(async (patch) => {
    /*
     * The optimistic update now writes into the shared cache rather than into
     * this provider's state. Same behaviour on screen — the switch moves at
     * once and rolls back if the request fails — but every reader of this key
     * sees it, and the rollback restores the exact document that was cached
     * rather than a copy captured in a closure.
     */
    const previous = queryClient.getQueryData(key);

    queryClient.setQueryData(key, (current) => {
      const base = current?.data || DEFAULT_PREFERENCES;
      return {
        ...current,
        data: {
          ...base,
          ...Object.fromEntries(
            Object.entries(patch).map(([section, values]) => [
              section,
              { ...base[section], ...values },
            ]),
          ),
        },
      };
    });

    try {
      const res = await usersApi.updatePreferences(patch);
      // The server merges the patch onto what it holds, so its answer is the
      // authority and replaces the optimistic guess.
      if (res?.data) queryClient.setQueryData(key, res);
      return true;
    } catch {
      queryClient.setQueryData(key, previous);
      return false;
    }
  }, [queryClient, key]);

  /*
   * Density and font size are applied as data-attributes on <html>, which is
   * what makes them real: the stylesheet keys its spacing and type scale off
   * these, so the setting takes effect on every screen at once rather than
   * needing each component to read a preference.
   *
   * Theme is deliberately NOT set here — ThemeContext owns that attribute and
   * also has to run before the account is known, to avoid a flash of the wrong
   * theme on load.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-density', preferences.appearance?.density || 'comfortable');
    root.setAttribute('data-font-size', preferences.appearance?.fontSize || 'medium');
  }, [preferences.appearance?.density, preferences.appearance?.fontSize]);

  const value = useMemo(
    () => ({ preferences, loading, error, save }),
    [preferences, loading, error, save],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext) || {
    preferences: DEFAULT_PREFERENCES,
    loading: false,
    error: null,
    save: async () => false,
  };
}
