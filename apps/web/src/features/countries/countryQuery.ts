import { type CountrySummary, REGION_SLUGS, type RegionSlug, isRegionSlug } from '@bla/shared';

import { searchFold } from '../../lib/searchFold';

/*
 * The countries table's view state lives in the URL (?view=&region=&q=&sort=&country=) so every
 * view is shareable. All 54 countries are loaded once (and shared with the map); filtering and
 * sorting happen here, instantly, without a request per keystroke.
 */

export const SORT_KEYS = [
  'name',
  'region',
  'etymology',
  'symbol',
  'animal',
  'population',
  'area',
  'leader',
  'election',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Two sets of columns: the symbols from the research document, and the country's facts. */
export const TABLE_VIEWS = ['symbols', 'facts'] as const;
export type TableView = (typeof TABLE_VIEWS)[number];

/** The sort keys each view's columns offer (name and region belong to both). */
export const VIEW_SORT_KEYS: Record<TableView, readonly SortKey[]> = {
  symbols: ['name', 'region', 'etymology', 'symbol', 'animal'],
  facts: ['name', 'region', 'population', 'area', 'leader', 'election'],
};

/** Figures sort largest first on the first click; text A to Z; elections soonest first. */
const FIRST_DIRECTION: Partial<Record<SortKey, 'asc' | 'desc'>> = {
  population: 'desc',
  area: 'desc',
};

export interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export interface CountriesView {
  view: TableView;
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
  const view = params.get('view');
  return {
    view: view === 'facts' ? 'facts' : 'symbols',
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
  if ('view' in change) set('view', change.view === 'facts' ? 'facts' : null);
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

/**
 * Clicking a column header: a new column starts in its natural order (figures largest first,
 * text A to Z, elections soonest first); the current one flips direction.
 */
export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, direction: FIRST_DIRECTION[key] ?? 'asc' };
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
      ...country.facts.leaders.map((leader) => leader.name),
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

/** Numeric sort value, or null (no data, which always sorts last). */
function numericValue(country: CountrySummary, key: SortKey): number | null {
  switch (key) {
    case 'population':
      return country.facts.population?.value ?? null;
    case 'area':
      return country.facts.landAreaKm2?.value ?? null;
    case 'election': {
      const election = country.facts.election;
      return election?.status === 'no_date_set' || !election?.date
        ? null
        : Date.parse(election.date);
    }
    default:
      return null;
  }
}

const NUMERIC_KEYS: ReadonlySet<SortKey> = new Set(['population', 'area', 'election']);

function sortValue(country: CountrySummary, key: SortKey): string {
  switch (key) {
    case 'leader':
      return country.facts.leaders[0]?.name ?? '';
    case 'population':
    case 'area':
    case 'election':
      return '';
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
    if (NUMERIC_KEYS.has(sort.key)) {
      const x = numericValue(a, sort.key);
      const y = numericValue(b, sort.key);
      // No data sorts last in both directions.
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
        return collator.compare(a.name, b.name);
      }
      return x !== y ? (x - y) * sign : collator.compare(a.name, b.name);
    }
    if (sort.key === 'leader' && !a.facts.leaders[0] !== !b.facts.leaders[0]) {
      return a.facts.leaders[0] ? -1 : 1;
    }
    const primary =
      sort.key === 'region'
        ? REGION_SLUGS.indexOf(a.region.slug) - REGION_SLUGS.indexOf(b.region.slug)
        : collator.compare(sortValue(a, sort.key), sortValue(b, sort.key));
    return primary !== 0 ? primary * sign : collator.compare(a.name, b.name);
  });
}
