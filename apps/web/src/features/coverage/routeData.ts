import type { DatasetKey } from '@bla/shared';
import { useMatches } from 'react-router';

/**
 * Each route declares, in its `handle`, which datasets it depends on and whether its data is a
 * time series. The data ribbon reads the deepest declaration for the current location. Future
 * modules register their coverage the same way: add the dataset key to DATASET_KEYS and list it
 * in the route's handle.
 */
export interface RouteDataHandle {
  datasets: readonly DatasetKey[];
  timeDependent: boolean;
  /**
   * The page has its own default years (Vinara: each metric's last ten complete years). With
   * no range chosen, the range is the last ten years of the coverage and the ribbon names the
   * page's default instead of the years.
   */
  ownDefault?: boolean;
}

export function isRouteDataHandle(value: unknown): value is RouteDataHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Partial<RouteDataHandle>).datasets) &&
    typeof (value as Partial<RouteDataHandle>).timeDependent === 'boolean'
  );
}

const NO_DATA: RouteDataHandle = { datasets: [], timeDependent: false };

export function useRouteData(): RouteDataHandle {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle;
    if (isRouteDataHandle(handle)) return handle;
  }
  return NO_DATA;
}
