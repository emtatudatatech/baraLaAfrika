import { useSyncExternalStore } from 'react';

const noSubscription = () => () => undefined;

/**
 * False on the server (the build's prerender) and while hydrating a prerendered page, true
 * otherwise: for output that only the browser can render (e.g. portals into <body>), so the
 * hydrated tree matches the prerendered markup and the browser-only part follows right after.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
