import { useEffect } from 'react';

/**
 * Marks <html data-app="ready"> once the app has committed its first render (or hydrated the
 * prerendered page), i.e. once the page responds to input. End-to-end tests wait for it.
 */
export function AppReady() {
  useEffect(() => {
    document.documentElement.dataset.app = 'ready';
  }, []);
  return null;
}
