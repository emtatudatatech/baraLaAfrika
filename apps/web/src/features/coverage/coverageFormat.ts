import type { CoverageDataset, RefreshCadence } from '@bla/shared';

/*
 * Formatting for the data ribbon. Dates from the API are ISO dates (`2026-10-14`) or ISO
 * datetimes; date-only values are calendar dates, so they are formatted in UTC (never shifted
 * a day by the viewer's time zone).
 */

export type Granularity = 'day' | 'month' | 'quarter' | 'year';

const DAY_MS = 86_400_000;

function utcDate(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
}

// Fixed three-letter months: ICU versions differ (en-GB gives "Sept" in some, "Sep" in others).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear())}`;
}

/** `2026-10-14` → `14 Oct 2026`. */
export function formatDate(iso: string): string {
  const date = utcDate(iso);
  return `${String(date.getUTCDate())} ${monthYear(date)}`;
}

/** How finely a dataset's coverage is expressed, from how often its source publishes. */
export function granularityOf(cadence: RefreshCadence): Granularity {
  switch (cadence) {
    case 'monthly':
      return 'month';
    case 'quarterly':
      return 'quarter';
    case 'annual':
      return 'year';
    default:
      return 'day';
  }
}

/** A coverage bound at the dataset's granularity: `Sep 2026`, `Q3 2026`, `2024` or a date. */
export function formatPeriod(iso: string, granularity: Granularity): string {
  const date = utcDate(iso);
  const year = date.getUTCFullYear();
  switch (granularity) {
    case 'year':
      return String(year);
    case 'quarter':
      return `Q${String(Math.floor(date.getUTCMonth() / 3) + 1)} ${String(year)}`;
    case 'month':
      return monthYear(date);
    case 'day':
      return formatDate(iso);
  }
}

/** `Jan 2000–Sep 2026`; null when the dataset is not a series (no coverage bounds). */
export function formatCoverage(
  dataset: Pick<CoverageDataset, 'coverageStart' | 'coverageEnd' | 'refreshCadence'>,
): string | null {
  const granularity = granularityOf(dataset.refreshCadence);
  const { coverageStart: start, coverageEnd: end } = dataset;
  if (start !== null && end !== null) {
    return `${formatPeriod(start, granularity)}–${formatPeriod(end, granularity)}`;
  }
  if (end !== null) return `to ${formatPeriod(end, granularity)}`;
  if (start !== null) return `${formatPeriod(start, granularity)} onwards`;
  return null;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** `today`, `yesterday`, `3 days ago`, `2 weeks ago`, `5 months ago`, `last year`… */
export function formatRelative(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - utcDate(iso).getTime()) / DAY_MS);
  if (days < 1) return relative.format(0, 'day');
  if (days < 7) return relative.format(-days, 'day');
  if (days < 30) return relative.format(-Math.floor(days / 7), 'week');
  if (days < 365) return relative.format(-Math.floor(days / 30), 'month');
  return relative.format(-Math.floor(days / 365), 'year');
}

export interface CoverageSummary {
  /** The newest "as of" date among the view's datasets. */
  asOf: string | null;
  /** When a pipeline last refreshed any of them. */
  lastRefreshedAt: string | null;
}

export function summarize(datasets: readonly CoverageDataset[]): CoverageSummary {
  let asOf: string | null = null;
  let lastRefreshedAt: string | null = null;
  for (const dataset of datasets) {
    if (asOf === null || dataset.asOf > asOf) asOf = dataset.asOf;
    const refreshed = dataset.lastRefreshedAt;
    if (
      refreshed !== null &&
      (lastRefreshedAt === null || utcDate(refreshed) > utcDate(lastRefreshedAt))
    ) {
      lastRefreshedAt = refreshed;
    }
  }
  return { asOf, lastRefreshedAt };
}
