import { type ReactNode, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { applyRange, boundsOf, presetRange, resolveRange, type YearRange } from './timeRange';
import { type TimeRangeContextValue, TimeRangeContext } from './timeRangeContext';
import { useRouteCoverage } from './useRouteCoverage';
import { latestParams } from '../../lib/latestParams';

/**
 * Provides the URL-synced year range (?from=&to=) for time-series routes, bounded by the
 * coverage of the route's datasets. On other routes the range is null and the params are ignored.
 */
export function TimeRangeProvider({ children }: { children: ReactNode }) {
  const { timeDependent, ownDefault, coverage } = useRouteCoverage();
  const [params, setParams] = useSearchParams();

  const data = coverage?.status === 'success' ? coverage.data : undefined;
  const bounds = useMemo(
    () => (timeDependent && data ? boundsOf(data.datasets) : null),
    [timeDependent, data],
  );
  const fallback = useMemo(
    () => (bounds !== null && ownDefault ? presetRange('last10', bounds) : bounds),
    [bounds, ownDefault],
  );
  const range = useMemo(() => resolveRange(params, bounds, fallback), [params, bounds, fallback]);
  const isDefault =
    range !== null &&
    fallback !== null &&
    range.start === fallback.start &&
    range.end === fallback.end;

  const setRange = useCallback(
    (next: YearRange) => {
      if (bounds === null) return;
      setParams(() => applyRange(latestParams(), next, bounds, fallback ?? bounds), {
        replace: true,
        preventScrollReset: true,
      });
    },
    [bounds, fallback, setParams],
  );

  const value = useMemo<TimeRangeContextValue>(
    () => ({
      interactive: timeDependent,
      bounds,
      range,
      ownDefault,
      isDefault,
      referenceYear: range?.end ?? null,
      setRange,
    }),
    [timeDependent, bounds, range, ownDefault, isDefault, setRange],
  );
  return <TimeRangeContext value={value}>{children}</TimeRangeContext>;
}
