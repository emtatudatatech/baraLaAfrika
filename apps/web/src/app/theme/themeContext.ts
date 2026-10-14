import { createContext, useContext } from 'react';

import type { Theme } from '../../lib/theme';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
