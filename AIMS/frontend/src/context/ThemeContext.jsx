import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'aiims-theme';
const THEMES = ['light', 'dark', 'system'];

const prefersDark = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * The stored value used to be 'dark' or nothing at all. 'system' was added for
 * the Settings screen's Appearance card, so an old value has to keep working.
 */
const readStoredTheme = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(stored) ? stored : 'light';
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);

  // What is actually painted. 'system' resolves against the OS setting and
  // follows it live, which is the whole point of offering the option.
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const isDarkMode = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [isDarkMode, theme]);

  const setTheme = useCallback((next) => {
    if (THEMES.includes(next)) setThemeState(next);
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme,
    isDarkMode,
    // Kept for the existing callers (the portal header toggles). Flipping the
    // switch is an explicit choice, so it leaves 'system' behind.
    toggleDarkMode: () => setThemeState(isDarkMode ? 'light' : 'dark'),
    enableDarkMode: () => setThemeState('dark'),
    disableDarkMode: () => setThemeState('light'),
  }), [theme, setTheme, isDarkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
