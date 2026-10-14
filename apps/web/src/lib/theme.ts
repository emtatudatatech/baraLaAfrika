import { readStorage, writeStorage } from './storage';

export type Theme = 'light' | 'dark';

/** Must match the key read by the bootstrap script in index.html. */
export const THEME_STORAGE_KEY = 'bla-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The user's explicit choice, or null when following the system setting. */
export function storedTheme(): Theme | null {
  const value = readStorage(THEME_STORAGE_KEY);
  return isTheme(value) ? value : null;
}

export function persistTheme(theme: Theme): void {
  writeStorage(THEME_STORAGE_KEY, theme);
}

export function applyTheme(theme: Theme, { animate }: { animate: boolean }): void {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => {
      root.classList.remove('theme-transition');
    }, 320);
  }
  root.dataset.theme = theme;
}
