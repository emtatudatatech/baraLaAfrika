import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import {
  type Theme,
  applyTheme,
  isTheme,
  persistTheme,
  storedTheme,
  systemTheme,
} from '../../lib/theme';
import { ThemeContext } from './themeContext';

function initialTheme(): Theme {
  // index.html has already set data-theme before first paint; start from it.
  const fromDom = document.documentElement.dataset.theme;
  return isTheme(fromDom) ? fromDom : (storedTheme() ?? systemTheme());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Follow the system setting until the user makes an explicit choice.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (storedTheme() !== null) return;
      const next = systemTheme();
      applyTheme(next, { animate: true });
      setTheme(next);
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
    setTheme(next);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}
