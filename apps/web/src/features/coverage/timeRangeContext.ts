import { createContext, useContext } from 'react';

/** An inclusive range of ISO years or dates; null bounds mean "earliest / latest available". */
export interface TimeRange {
  start: string | null;
  end: string | null;
}

export interface TimeRangeContextValue {
  range: TimeRange;
  setRange: (range: TimeRange) => void;
  /** True only on routes whose data is a time series (the control is read-only elsewhere). */
  interactive: boolean;
}

export const TimeRangeContext = createContext<TimeRangeContextValue | null>(null);

/** Read the active time range from any view that renders time-dependent data. */
export function useTimeRange(): TimeRangeContextValue {
  const value = useContext(TimeRangeContext);
  if (value === null) throw new Error('useTimeRange must be used inside <TimeRangeProvider>');
  return value;
}
