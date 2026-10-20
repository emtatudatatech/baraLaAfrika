import { type RouteObject, matchRoutes } from 'react-router';

/**
 * Loads the code-split modules of the routes matching `location` and puts them on the route
 * objects, so the router's first render shows the page itself, as the prerendered markup does,
 * rather than the loading fallback (which would not match it). Call before creating the router.
 */
export async function loadMatchedRoutes(
  routes: RouteObject[],
  location: { pathname: string },
): Promise<void> {
  const matches = matchRoutes(routes, location) ?? [];
  await Promise.all(
    matches.map(async ({ route }) => {
      const lazy = route.lazy;
      if (lazy === undefined) return;
      const target = route as Record<string, unknown>;
      if (typeof lazy === 'function') {
        Object.assign(target, await lazy());
      } else {
        await Promise.all(
          Object.entries(lazy).map(async ([key, load]) => {
            if (typeof load === 'function') target[key] = await (load as () => Promise<unknown>)();
          }),
        );
      }
      delete target.lazy;
    }),
  );
}
