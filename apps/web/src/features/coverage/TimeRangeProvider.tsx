import { type ReactNode, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { applyRange, boundsOf, resolveRange, type YearRange } from './timeRange';
import { type TimeRangeContextValue, TimeRangeContext } from './timeRangeContext';
import { useRouteCoverage } from './useRouteCoverage';

/**
 * Provides the URL-synced year range (?from=&to=) for time-series routes, bounded by the
 * coverage of the route's datasets. On other routes the range is null and the params are ignored.
 */
export function TimeRangeProvider({ children }: { children: ReactNode }) {
  const { timeDependent, coverage } = useRouteCoverage();
  const [params, setParams] = useSearchParams();

  const data = coverage?.status === 'success' ? coverage.data : undefined;
  const bounds = useMemo(
    () => (timeDependent && data ? boundsOf(data.datasets) : null),
    [timeDependent, data],
  );
  const range = useMemo(() => resolveRange(params, bounds), [params, bounds]);

  const setRange = useCallback(
    (next: YearRange) => {
      if (bounds === null) return;
      setParams((current) => applyRange(current, next, bounds), {
        replace: true,
        preventScrollReset: true,
      });
    },
    [bounds, setParams],
  );

  const value = useMemo<TimeRangeContextValue>(
    () => ({
      interactive: timeDependent,
      bounds,
      range,
      referenceYear: range?.end ?? null,
      setRange,
    }),
    [timeDependent, bounds, range, setRange],
  );
  return <TimeRangeContext value={value}>{children}</TimeRangeContext>;
}
