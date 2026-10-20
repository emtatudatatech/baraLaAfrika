import { createContext, useContext } from 'react';

import type { YearRange } from './timeRange';

/**
 * The shared time range. Time-series views read it with `useTimeRange()`: `range` drives their
 * charts and `referenceYear` (its end) their tables, maps and cards. Routes register the data
 * behind them (and so the range's bounds) in their `handle` (see routeData.ts).
 */
export interface TimeRangeContextValue {
  /** True on routes whose data is a time series; the ribbon's control is read-only elsewhere. */
  interactive: boolean;
  /** The years the route's series cover; null when not time-dependent or no data is loaded. */
  bounds: YearRange | null;
  /** The selected years (?from=&to=), always inside the bounds; null whenever bounds is. */
  range: YearRange | null;
  /** The end of the range: the year tables, maps and cards show (latest available by default). */
  referenceYear: number | null;
  /** Updates the URL (replacing the history entry); the full coverage leaves no params. */
  setRange: (range: YearRange) => void;
}

export const TimeRangeContext = createContext<TimeRangeContextValue | null>(null);

/** Read the active time range from any view that renders time-dependent data. */
export function useTimeRange(): TimeRangeContextValue {
  const value = useContext(TimeRangeContext);
  if (value === null) throw new Error('useTimeRange must be used inside <TimeRangeProvider>');
  return value;
}
