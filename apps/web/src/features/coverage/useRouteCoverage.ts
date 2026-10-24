import type { CoverageResponse, DatasetKey } from '@bla/shared';

import { api } from '../../lib/api';
import { type Resource, useResource } from '../../lib/useResource';
import { useRouteData } from './routeData';

export interface RouteCoverage {
  datasets: readonly DatasetKey[];
  timeDependent: boolean;
  /** The page has its own default years (see RouteDataHandle). */
  ownDefault: boolean;
  /** Coverage of the route's datasets; null while the route declares none. */
  coverage: Resource<CoverageResponse> | null;
}

/**
 * The coverage ("as of", ranges, refresh times) of the datasets the current route declares.
 * One cached request per set of datasets, shared by the ribbon and the time-range provider.
 */
export function useRouteCoverage(): RouteCoverage {
  const { datasets, timeDependent, ownDefault = false } = useRouteData();
  const keys = [...datasets].sort();
  const coverage = useResource<CoverageResponse>(
    keys.length === 0 ? null : `coverage:${keys.join(',')}`,
    () => api.coverage(keys),
  );
  return { datasets, timeDependent, ownDefault, coverage: keys.length === 0 ? null : coverage };
}
