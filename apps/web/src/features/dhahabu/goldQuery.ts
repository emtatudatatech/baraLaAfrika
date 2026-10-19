import {
  GOLD_SORTS,
  type GoldCountry,
  type GoldSort,
  PRESENCE_TIERS,
  type PresenceTier,
  type RegionSlug,
  isRegionSlug,
  sortGoldCountries,
} from '@bla/shared';

import { searchFold } from '../../lib/searchFold';
import type { YearRange } from '../coverage/timeRange';

/*
 * The /dhahabu view lives in the URL (?region=&q=&presence=&sort=, plus the ribbon's ?from=&to=)
 * so every view can be shared. The 54 rows load once per reference year; filtering and sorting
 * happen here, with the same meaning as /api/gold/countries.
 */

export interface GoldView {
  region: RegionSlug | null;
  q: string;
  presence: PresenceTier | null;
  sort: GoldSort;
}

export const DEFAULT_SORT: GoldSort = 'production';

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseView(params: URLSearchParams): GoldView {
  const region = params.get('region');
  return {
    region: isRegionSlug(region) ? region : null,
    q: (params.get('q') ?? '').trim().slice(0, 80),
    presence: oneOf(PRESENCE_TIERS, params.get('presence')),
    sort: oneOf(GOLD_SORTS, params.get('sort')) ?? DEFAULT_SORT,
  };
}

/** Applies a change, dropping defaults so URLs stay short; other params (from, to) are kept. */
export function updateParams(current: URLSearchParams, change: Partial<GoldView>): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | null | undefined, fallback?: string) => {
    if (value === null || value === undefined || value === '' || value === fallback)
      next.delete(key);
    else next.set(key, value);
  };
  if ('region' in change) set('region', change.region);
  if ('q' in change) set('q', (change.q ?? '').trim().slice(0, 80));
  if ('presence' in change) set('presence', change.presence);
  if ('sort' in change) set('sort', change.sort, DEFAULT_SORT);
  return next;
}

export function filterRows(rows: readonly GoldCountry[], view: GoldView): GoldCountry[] {
  const needle = searchFold(view.q);
  return rows.filter((row) => {
    if (view.region !== null && row.country.region.slug !== view.region) return false;
    if (view.presence !== null && row.presence.tier !== view.presence) return false;
    if (needle === '') return true;
    return searchFold(`${row.country.name} ${row.country.iso3}`).includes(needle);
  });
}

export function visibleRows(rows: readonly GoldCountry[], view: GoldView): GoldCountry[] {
  return sortGoldCountries(filterRows(rows, view), view.sort);
}

/** A column header click: a new column sorts its natural way; the same column reverses. */
export function nextSort(current: GoldSort, column: Exclude<GoldSort, `-${string}`>): GoldSort {
  if (current === column) return `-${column}`;
  return column;
}

/**
 * The year the API should use: none (latest available) while the range ends at the data's
 * newest year, otherwise the range's end.
 */
export function apiYear(range: YearRange | null, bounds: YearRange | null): number | undefined {
  if (range === null || bounds === null || range.end >= bounds.end) return undefined;
  return range.end;
}
