import { type CountrySummary, REGION_SLUGS, type RegionSlug, isRegionSlug } from '@bla/shared';

import { searchFold } from '../../lib/searchFold';

/*
 * The countries table's view state lives in the URL (?region=&q=&sort=&country=) so every view
 * is shareable. All 54 countries are loaded once (and shared with the map); filtering and
 * sorting happen here, instantly, without a request per keystroke.
 */

export const SORT_KEYS = ['name', 'region', 'etymology', 'symbol', 'animal'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export interface CountriesView {
  region: RegionSlug | null;
  q: string;
  sort: SortState;
  /** ISO3 of the country whose drawer is open. */
  country: string | null;
}

export const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' };
const MAX_QUERY_LENGTH = 80;

function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

/** `name` → ascending, `-name` → descending; anything else → the default sort. */
export function parseSort(value: string | null): SortState {
  if (!value) return DEFAULT_SORT;
  const descending = value.startsWith('-');
  const key = descending ? value.slice(1) : value;
  return isSortKey(key) ? { key, direction: descending ? 'desc' : 'asc' } : DEFAULT_SORT;
}

export function formatSort(sort: SortState): string {
  return sort.direction === 'desc' ? `-${sort.key}` : sort.key;
}

/** Reads the view from URL search params, ignoring invalid values. */
export function parseView(params: URLSearchParams): CountriesView {
  const region = params.get('region');
  const country = params.get('country')?.trim().toUpperCase() ?? '';
  return {
    region: isRegionSlug(region) ? region : null,
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    sort: parseSort(params.get('sort')),
    country: /^[A-Z]{3}$/.test(country) ? country : null,
  };
}

/**
 * Applies a partial view change to the current params, dropping defaults so URLs stay short.
 * Unrelated params are kept.
 */
export function updateParams(
  current: URLSearchParams,
  change: Partial<CountriesView>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | null) => {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  };
  if ('region' in change) set('region', change.region ?? null);
  if ('q' in change) set('q', (change.q ?? '').trim().slice(0, MAX_QUERY_LENGTH));
  if ('sort' in change) {
    const sort = change.sort ?? DEFAULT_SORT;
    set(
      'sort',
      sort.key === DEFAULT_SORT.key && sort.direction === DEFAULT_SORT.direction
        ? null
        : formatSort(sort),
    );
  }
  if ('country' in change) set('country', change.country ?? null);
  return next;
}

/** Clicking a column header: a new column sorts ascending, the current one flips direction. */
export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

/** The text a search matches: names, ISO codes and every visible column. */
function searchText(country: CountrySummary): string {
  return searchFold(
    [
      country.name,
      country.officialName ?? '',
      country.iso2,
      country.iso3,
      country.region.name,
      country.etymologySummary,
      country.nationalSymbolSummary,
      country.nationalAnimalName,
    ].join(' '),
  );
}

export function filterCountries(
  countries: readonly CountrySummary[],
  { region, q }: Pick<CountriesView, 'region' | 'q'>,
): CountrySummary[] {
  const needle = searchFold(q.trim());
  return countries.filter(
    (country) =>
      (region === null || country.region.slug === region) &&
      (needle === '' || searchText(country).includes(needle)),
  );
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function sortValue(country: CountrySummary, key: SortKey): string {
  switch (key) {
    case 'name':
      return country.name;
    case 'region':
      return country.region.name;
    case 'etymology':
      return country.etymologySummary;
    case 'symbol':
      return country.nationalSymbolSummary;
    case 'animal':
      return country.nationalAnimalName;
  }
}

/**
 * Sorts by the chosen column, ties broken by country name (always A–Z, so equal values keep a
 * stable, predictable order in both directions). Regions sort in their display order.
 */
export function sortCountries(
  countries: readonly CountrySummary[],
  sort: SortState,
): CountrySummary[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...countries].sort((a, b) => {
    const primary =
      sort.key === 'region'
        ? REGION_SLUGS.indexOf(a.region.slug) - REGION_SLUGS.indexOf(b.region.slug)
        : collator.compare(sortValue(a, sort.key), sortValue(b, sort.key));
    return primary !== 0 ? primary * sign : collator.compare(a.name, b.name);
  });
}
