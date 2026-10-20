import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { clearResourceCache } from '../lib/useResource';

// jsdom has no matchMedia; default to a light-scheme, wide, motion-OK environment.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

afterEach(() => {
  cleanup();
  clearResourceCache();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
});
