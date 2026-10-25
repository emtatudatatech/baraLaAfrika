import type { YearRange } from '../coverage/timeRange';

/*
 * The years Vinara asks the API for. With no range chosen, none: each measure then uses its own
 * last ten complete years. Otherwise the range's start, and its end only when one was chosen (a
 * range left open at the end runs to each measure's latest complete year, never into a year
 * too few states have reported).
 */
export function apiWindow(
  range: YearRange | null,
  isDefault: boolean,
  params: URLSearchParams,
): { from?: number; to?: number } {
  if (range === null || isDefault) return {};
  return params.has('to') ? { from: range.start, to: range.end } : { from: range.start };
}
