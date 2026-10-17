import {
  type RangeSummary,
  type CountryRef,
  type Mountain,
  type MountainCountrySummary,
  type RegionSlug,
  VOLCANIC_FILTERS,
  type VolcanicFilter,
  isRegionSlug,
} from '@bla/shared';

import { searchFold } from '../../lib/searchFold';

/*
 * The /harim view lives in the URL (?view=&region=&q=&sort=&minHeight=&volcanic=&range=&country=
 * &peak=) so every view can be shared. The 54 summary rows and the catalogue are loaded once;
 * filtering and sorting happen here, with the same meaning as the API's parameters (search also
 * matches a massif's summit names, so "Kibo" finds Kilimanjaro).
 */

export const VIEWS = ['country', 'peaks', 'ranges'] as const;
export type View = (typeof VIEWS)[number];

export const COUNTRY_SORTS = ['height', '-height', 'name', 'peaks', 'relief'] as const;
export type CountrySort = (typeof COUNTRY_SORTS)[number];
export const PEAK_SORTS = ['height', '-height', 'prominence', 'name'] as const;
export type PeakSort = (typeof PEAK_SORTS)[number];
export const RANGE_SORTS = ['height', 'peaks', 'name'] as const;
export type RangeSort = (typeof RANGE_SORTS)[number];

export interface HarimView {
  view: View;
  region: RegionSlug | null;
  q: string;
  /** Validated for the active view; `height` (highest first) by default. */
  sort: CountrySort | PeakSort | RangeSort;
  minHeight: number | null;
  volcanic: VolcanicFilter | null;
  range: string | null;
  country: string | null;
  /** The peak whose drawer is open. */
  peak: string | null;
}

export const MAX_HEIGHT_M = 6000;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseView(params: URLSearchParams): HarimView {
  const view = oneOf(VIEWS, params.get('view')) ?? 'country';
  const sorts: readonly string[] =
    view === 'country' ? COUNTRY_SORTS : view === 'peaks' ? PEAK_SORTS : RANGE_SORTS;
  const sort = params.get('sort');
  const minHeight = Number(params.get('minHeight'));
  const region = params.get('region');
  const range = params.get('range');
  const peak = params.get('peak');
  const country = params.get('country')?.trim().toUpperCase() ?? '';
  return {
    view,
    region: isRegionSlug(region) ? region : null,
    q: (params.get('q') ?? '').trim().slice(0, 80),
    sort: (sort !== null && sorts.includes(sort) ? sort : 'height') as HarimView['sort'],
    minHeight:
      params.has('minHeight') &&
      Number.isInteger(minHeight) &&
      minHeight > 0 &&
      minHeight <= MAX_HEIGHT_M
        ? minHeight
        : null,
    volcanic: oneOf(VOLCANIC_FILTERS, params.get('volcanic')),
    range: range !== null && SLUG.test(range) ? range : null,
    country: /^[A-Z]{3}$/.test(country) ? country : null,
    peak: peak !== null && SLUG.test(peak) ? peak : null,
  };
}

/** Applies a change, dropping defaults so URLs stay short; unrelated params are kept. */
export function updateParams(
  current: URLSearchParams,
  change: Partial<HarimView>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | number | null | undefined, fallback?: string) => {
    if (value === null || value === undefined || value === '' || value === fallback)
      next.delete(key);
    else next.set(key, String(value));
  };
  if ('view' in change) {
    set('view', change.view, 'country');
    // A sort for one view means nothing in the other.
    if (!('sort' in change)) next.delete('sort');
  }
  if ('region' in change) set('region', change.region);
  if ('q' in change) set('q', (change.q ?? '').trim().slice(0, 80));
  if ('sort' in change) set('sort', change.sort, 'height');
  if ('minHeight' in change) set('minHeight', change.minHeight);
  if ('volcanic' in change) set('volcanic', change.volcanic);
  if ('range' in change) set('range', change.range);
  if ('country' in change) set('country', change.country);
  if ('peak' in change) set('peak', change.peak);
  return next;
}

// ── By country ───────────────────────────────────────────────────────────────

export function filterSummary(
  rows: readonly MountainCountrySummary[],
  { region, q, country = null }: Pick<HarimView, 'region' | 'q'> & { country?: string | null },
): MountainCountrySummary[] {
  const needle = searchFold(q.trim());
  return rows.filter((row) => {
    if (region !== null && row.country.region.slug !== region) return false;
    if (country !== null && row.country.iso3 !== country) return false;
    if (needle === '') return true;
    const text = searchFold(
      [
        row.country.name,
        row.country.iso2,
        row.country.iso3,
        row.highestPeak?.name ?? '',
        row.highestPeak?.summitName ?? '',
        ...row.ranges,
      ].join(' '),
    );
    return text.includes(needle);
  });
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function sortSummary(
  rows: readonly MountainCountrySummary[],
  sort: CountrySort,
): MountainCountrySummary[] {
  const byName = (a: MountainCountrySummary, b: MountainCountrySummary) =>
    collator.compare(a.country.name, b.country.name);
  const value = (row: MountainCountrySummary): number => {
    switch (sort) {
      case 'height':
      case '-height':
        return row.highestPeak?.elevationM ?? -Infinity;
      case 'peaks':
        return row.peakCount;
      case 'relief':
        return row.reliefM ?? -Infinity;
      case 'name':
        return 0;
    }
  };
  return [...rows].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    const difference = sort === '-height' ? value(a) - value(b) : value(b) - value(a);
    return difference !== 0 ? difference : byName(a, b);
  });
}

// ── All peaks ────────────────────────────────────────────────────────────────

export function filterPeaks(
  mountains: readonly Mountain[],
  view: Pick<HarimView, 'region' | 'q' | 'country' | 'range' | 'minHeight' | 'volcanic'>,
  countries: ReadonlyMap<string, CountryRef>,
): Mountain[] {
  const needle = searchFold(view.q.trim());
  return mountains.filter((m) => {
    if (
      view.region !== null &&
      !m.countries.some((iso3) => countries.get(iso3)?.region.slug === view.region)
    ) {
      return false;
    }
    if (view.country !== null && !m.countries.includes(view.country)) return false;
    if (view.range !== null && m.range?.slug !== view.range) return false;
    if (view.minHeight !== null && m.elevationM < view.minHeight) return false;
    switch (view.volcanic) {
      case null:
        break;
      case '1':
        if (!m.isVolcanic) return false;
        break;
      case 'unknown':
        if (!m.isVolcanic || m.volcanicStatus !== null) return false;
        break;
      default:
        if (m.volcanicStatus !== view.volcanic) return false;
    }
    if (needle === '') return true;
    const text = searchFold(
      [
        m.name,
        ...m.altNames,
        m.range?.name ?? '',
        m.parent?.name ?? '',
        m.territory ?? '',
        ...m.countries.map((iso3) => countries.get(iso3)?.name ?? ''),
        ...m.summits.map((summit) => summit.name),
      ].join(' '),
    );
    return text.includes(needle);
  });
}

/** Height (highest first by default), prominence (unknown last), or name; ties by slug. */
export function sortPeaks(mountains: readonly Mountain[], sort: PeakSort): Mountain[] {
  return [...mountains].sort((a, b) => {
    switch (sort) {
      case 'height':
        return b.elevationM - a.elevationM || a.slug.localeCompare(b.slug);
      case '-height':
        return a.elevationM - b.elevationM || a.slug.localeCompare(b.slug);
      case 'prominence': {
        if (a.prominenceM === null && b.prominenceM === null) {
          return b.elevationM - a.elevationM || a.slug.localeCompare(b.slug);
        }
        if (a.prominenceM === null) return 1;
        if (b.prominenceM === null) return -1;
        return (
          b.prominenceM - a.prominenceM ||
          b.elevationM - a.elevationM ||
          a.slug.localeCompare(b.slug)
        );
      }
      case 'name':
        return collator.compare(a.name, b.name) || a.slug.localeCompare(b.slug);
    }
  });
}

/** The mountains in one country, highest first (massifs once; their summits are nested). */
export function mountainsOf(mountains: readonly Mountain[], iso3: string): Mountain[] {
  return sortPeaks(
    mountains.filter((m) => m.countries.includes(iso3)),
    'height',
  );
}

/** Header clicks: a new column starts in its natural direction; height flips on a second click. */
export function nextCountrySort(
  current: CountrySort,
  column: 'height' | 'name' | 'peaks' | 'relief',
): CountrySort {
  if (column === 'height') return current === 'height' ? '-height' : 'height';
  return column;
}

// ── Ranges ───────────────────────────────────────────────────────────────────

/** Ranges in the region (any of their countries) whose name or mountains match the search. */
export function filterRanges(
  ranges: readonly RangeSummary[],
  { region, q }: Pick<HarimView, 'region' | 'q'>,
  mountains: readonly Mountain[],
): RangeSummary[] {
  const needle = searchFold(q.trim());
  const names = new Map<string, string>();
  for (const m of mountains) {
    if (m.range) names.set(m.range.slug, `${names.get(m.range.slug) ?? ''} ${m.name}`);
  }
  return ranges.filter((range) => {
    if (region !== null && !range.regions.includes(region)) return false;
    if (needle === '') return true;
    return searchFold(`${range.name} ${names.get(range.slug) ?? ''}`).includes(needle);
  });
}

/** Tallest peak first (default), most mountains first, or by name. */
export function sortRanges(ranges: readonly RangeSummary[], sort: RangeSort): RangeSummary[] {
  return [...ranges].sort((a, b) => {
    const byName = collator.compare(a.name, b.name);
    if (sort === 'name') return byName;
    if (sort === 'peaks') return b.peakCount - a.peakCount || byName;
    return (b.tallest?.elevationM ?? 0) - (a.tallest?.elevationM ?? 0) || byName;
  });
}
