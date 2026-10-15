import { type ReactNode, useMemo, useState } from 'react';

import { type TimeRange, TimeRangeContext } from './timeRangeContext';
import { useRouteData } from './routeData';

const LATEST: TimeRange = { start: null, end: null };

export function TimeRangeProvider({ children }: { children: ReactNode }) {
  const { timeDependent } = useRouteData();
  const [range, setRange] = useState<TimeRange>(LATEST);
  const value = useMemo(
    () => ({ range: timeDependent ? range : LATEST, setRange, interactive: timeDependent }),
    [range, timeDependent],
  );
  return <TimeRangeContext value={value}>{children}</TimeRangeContext>;
}
