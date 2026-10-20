import { type ReactNode, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  type Theme,
  applyTheme,
  isTheme,
  persistTheme,
  storedTheme,
  systemTheme,
} from '../../lib/theme';
import { ThemeContext } from './themeContext';

/** The theme on the page: index.html's bootstrap sets data-theme before the first paint. */
function currentTheme(): Theme {
  const fromDom = document.documentElement.dataset.theme;
  return isTheme(fromDom) ? fromDom : (storedTheme() ?? systemTheme());
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    observer.disconnect();
  };
}

/**
 * The theme follows <html data-theme>. Prerendered pages are built in light and hydrate as
 * light (the server snapshot); the page's CSS already follows data-theme, so only the toggle's
 * label catches up, right after hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as const);

  // Follow the system setting until the user makes an explicit choice.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (storedTheme() !== null) return;
      applyTheme(systemTheme(), { animate: true });
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    persistTheme(next);
    applyTheme(next, { animate: true });
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}
