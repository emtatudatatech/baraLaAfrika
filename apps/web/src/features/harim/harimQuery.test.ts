import type { CountryRef, Mountain, MountainCountrySummary, RegionSlug } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import {
  filterPeaks,
  filterRanges,
  sortRanges,
  filterSummary,
  mountainsOf,
  nextCountrySort,
  parseView,
  sortPeaks,
  sortSummary,
  updateParams,
} from './harimQuery';

function ref(iso3: string, name: string, region: RegionSlug): CountryRef {
  return {
    iso3,
    iso2: iso3.slice(0, 2),
    name,
    region: { slug: region, name: region, colorHex: null },
    flag: { svgUrl: '', pngUrlTemplate: '', fallbackUrl: '' },
  };
}

const TZA = ref('TZA', 'Tanzania', 'east');
const UGA = ref('UGA', 'Uganda', 'east');
const DJI = ref('DJI', 'Djibouti', 'east');
const STP = ref('STP', 'São Tomé and Príncipe', 'central');
const COUNTRIES = new Map(
  [TZA, UGA, DJI, STP, ref('COD', 'DR Congo', 'central')].map((c) => [c.iso3, c]),
);

function peak(slug: string, elevationM: number, extra: Partial<Mountain> = {}): Mountain {
  return {
    slug,
    name: slug,
    altNames: [],
    elevationM,
    confidence: 'high',
    lat: 0,
    lon: 0,
    peakType: 'peak',
    volcanicStatus: null,
    isVolcanic: false,
    prominenceM: null,
    isolationKm: null,
    summitKind: 'standalone',
    parent: null,
    range: null,
    countries: ['TZA'],
    highPointOf: [],
    isShared: false,
    territory: null,
    needsReview: false,
    summits: [],
    ...extra,
  };
}

const KILIMANJARO = peak('kilimanjaro', 5895, {
  name: 'Mount Kilimanjaro',
  summitKind: 'massif',
  isVolcanic: true,
  volcanicStatus: 'dormant',
  prominenceM: 5885,
  summits: [{ slug: 'kibo', name: 'Kibo', elevationM: 5895, confidence: 'high' }],
});
const STANLEY = peak('stanley', 5109, {
  name: 'Mount Stanley',
  countries: ['COD', 'UGA'],
  isShared: true,
  range: { slug: 'rwenzori', name: 'Rwenzori' },
  prominenceM: 3951,
});
const MERU = peak('meru', 4562, { isVolcanic: true, volcanicStatus: 'active' });
const PICO = peak('pico', 2024, { name: 'Pico de São Tomé', countries: ['STP'], isVolcanic: true });
const MOUSSA = peak('moussa', 2028, { countries: ['DJI'] });
const CATALOGUE = [MOUSSA, PICO, MERU, STANLEY, KILIMANJARO];

const BASE = {
  region: null,
  q: '',
  country: null,
  range: null,
  minHeight: null,
  volcanic: null,
} as const;

describe('parseView', () => {
  it('defaults to the by-country view, highest first', () => {
    expect(parseView(new URLSearchParams())).toEqual({
      view: 'country',
      region: null,
      q: '',
      sort: 'height',
      minHeight: null,
      volcanic: null,
      range: null,
      country: null,
      peak: null,
    });
  });

  it('accepts the ranges view with its own sorts', () => {
    expect(parseView(new URLSearchParams('view=ranges&sort=peaks'))).toMatchObject({
      view: 'ranges',
      sort: 'peaks',
    });
    expect(parseView(new URLSearchParams('view=ranges&sort=prominence')).sort).toBe('height');
  });

  it('reads valid values and drops invalid ones', () => {
    const view = parseView(
      new URLSearchParams(
        'view=peaks&region=east&q=%20kibo%20&sort=prominence&minHeight=4000&volcanic=active&range=rwenzori&country=uga&peak=mount-kenya',
      ),
    );
    expect(view).toEqual({
      view: 'peaks',
      region: 'east',
      q: 'kibo',
      sort: 'prominence',
      minHeight: 4000,
      volcanic: 'active',
      range: 'rwenzori',
      country: 'UGA',
      peak: 'mount-kenya',
    });
    const bad = parseView(
      new URLSearchParams(
        'view=mountains&region=asia&sort=prominence&minHeight=9000&volcanic=maybe&range=Bad!&country=KE&peak=x y',
      ),
    );
    // An unknown view falls back to By country, where prominence is not a sort.
    expect(bad).toMatchObject({
      view: 'country',
      region: null,
      sort: 'height',
      minHeight: null,
      volcanic: null,
      range: null,
      country: null,
      peak: null,
    });
    expect(parseView(new URLSearchParams('minHeight=-5')).minHeight).toBeNull();
    expect(parseView(new URLSearchParams('minHeight=12.5')).minHeight).toBeNull();
  });
});

describe('updateParams', () => {
  it('drops defaults, keeps unrelated params and resets the sort when the view changes', () => {
    const start = new URLSearchParams('sort=-height&from=2010&region=east');
    const next = updateParams(start, { view: 'peaks' });
    expect(next.toString()).toBe('from=2010&region=east&view=peaks');
    expect(updateParams(next, { view: 'country' }).toString()).toBe('from=2010&region=east');
    expect(updateParams(next, { sort: 'height', minHeight: 3000 }).get('minHeight')).toBe('3000');
    expect(updateParams(next, { region: null, q: '  ' }).toString()).toBe('from=2010&view=peaks');
    expect(
      updateParams(new URLSearchParams(), { view: 'peaks', sort: 'prominence' }).toString(),
    ).toBe('view=peaks&sort=prominence');
  });
});

describe('by country', () => {
  const row = (
    country: CountryRef,
    elevationM: number | null,
    extra: Partial<MountainCountrySummary> = {},
  ): MountainCountrySummary => ({
    country,
    highestPeak:
      elevationM === null
        ? null
        : {
            slug: `${country.iso3}-top`,
            name: `${country.name} top`,
            summitName: null,
            elevationM,
            confidence: 'high',
            sharedWith: [],
            needsReview: false,
          },
    peakCount: 1,
    meanPeakM: elevationM,
    ranges: [],
    lowestPoint: null,
    reliefM: null,
    ...extra,
  });
  const tza = row(TZA, 5895, { peakCount: 9, reliefM: 5895 });
  const uga = row(UGA, 5109, { ranges: ['Rwenzori'], peakCount: 4 });
  const dji = row(DJI, 2028, { reliefM: 2183 });
  const stp = row(STP, null);
  const rows = [stp, dji, uga, tza];

  it('filters by region and accent-insensitive search over names and ranges', () => {
    expect(filterSummary(rows, { region: 'east', q: '' })).toEqual([dji, uga, tza]);
    expect(filterSummary(rows, { region: null, q: 'sao tome' })).toEqual([stp]);
    expect(filterSummary(rows, { region: null, q: 'RWENZORI' })).toEqual([uga]);
    expect(filterSummary(rows, { region: null, q: 'uga' })).toEqual([uga]);
    expect(filterSummary(rows, { region: null, q: '', country: 'DJI' })).toEqual([dji]);
  });

  it('sorts by height (missing heights last), count, relief or name', () => {
    expect(sortSummary(rows, 'height').map((r) => r.country.iso3)).toEqual([
      'TZA',
      'UGA',
      'DJI',
      'STP',
    ]);
    expect(sortSummary(rows, '-height').map((r) => r.country.iso3)).toEqual([
      'STP',
      'DJI',
      'UGA',
      'TZA',
    ]);
    expect(sortSummary(rows, 'peaks')[0]).toBe(tza);
    expect(sortSummary(rows, 'relief').map((r) => r.country.iso3)).toEqual([
      'TZA',
      'DJI',
      'STP',
      'UGA',
    ]);
    expect(sortSummary(rows, 'name').map((r) => r.country.iso3)).toEqual([
      'DJI',
      'STP',
      'TZA',
      'UGA',
    ]);
  });

  it('flips only the height column on a second click', () => {
    expect(nextCountrySort('height', 'height')).toBe('-height');
    expect(nextCountrySort('-height', 'height')).toBe('height');
    expect(nextCountrySort('height', 'relief')).toBe('relief');
    expect(nextCountrySort('relief', 'relief')).toBe('relief');
  });

  it("lists a country's mountains, a shared peak under each of its countries", () => {
    expect(mountainsOf(CATALOGUE, 'TZA').map((m) => m.slug)).toEqual(['kilimanjaro', 'meru']);
    expect(mountainsOf(CATALOGUE, 'UGA').map((m) => m.slug)).toEqual(['stanley']);
    expect(mountainsOf(CATALOGUE, 'COD').map((m) => m.slug)).toEqual(['stanley']);
  });
});

describe('all peaks', () => {
  const slugs = (list: Mountain[]) => list.map((m) => m.slug);

  it('filters by region, country, range and minimum height', () => {
    expect(slugs(filterPeaks(CATALOGUE, { ...BASE, region: 'central' }, COUNTRIES))).toEqual([
      'pico',
      'stanley',
    ]);
    expect(slugs(filterPeaks(CATALOGUE, { ...BASE, country: 'UGA' }, COUNTRIES))).toEqual([
      'stanley',
    ]);
    expect(slugs(filterPeaks(CATALOGUE, { ...BASE, range: 'rwenzori' }, COUNTRIES))).toEqual([
      'stanley',
    ]);
    expect(slugs(filterPeaks(CATALOGUE, { ...BASE, minHeight: 4562 }, COUNTRIES))).toEqual([
      'meru',
      'stanley',
      'kilimanjaro',
    ]);
  });

  it('filters volcanoes like the API: any, by status, or volcanic with no stated status', () => {
    const volcanic = (value: '1' | 'active' | 'dormant' | 'extinct' | 'unknown') =>
      slugs(filterPeaks(CATALOGUE, { ...BASE, volcanic: value }, COUNTRIES));
    expect(volcanic('1')).toEqual(['pico', 'meru', 'kilimanjaro']);
    expect(volcanic('active')).toEqual(['meru']);
    expect(volcanic('dormant')).toEqual(['kilimanjaro']);
    expect(volcanic('extinct')).toEqual([]);
    expect(volcanic('unknown')).toEqual(['pico']);
  });

  it('searches names, summits and country names without accents', () => {
    const search = (q: string) => slugs(filterPeaks(CATALOGUE, { ...BASE, q }, COUNTRIES));
    expect(search('sao')).toEqual(['pico']);
    expect(search('kibo')).toEqual(['kilimanjaro']);
    expect(search('congo')).toEqual(['stanley']);
    expect(search('rwenzori')).toEqual(['stanley']);
  });

  it('sorts by prominence with unknown values last, by height either way, or by name', () => {
    expect(slugs(sortPeaks(CATALOGUE, 'prominence'))).toEqual([
      'kilimanjaro',
      'stanley',
      'meru',
      'moussa',
      'pico',
    ]);
    expect(slugs(sortPeaks(CATALOGUE, 'height'))).toEqual([
      'kilimanjaro',
      'stanley',
      'meru',
      'moussa',
      'pico',
    ]);
    expect(slugs(sortPeaks(CATALOGUE, '-height'))[0]).toBe('pico');
    expect(slugs(sortPeaks(CATALOGUE, 'name'))).toEqual([
      'meru',
      'kilimanjaro',
      'stanley',
      'moussa',
      'pico',
    ]);
  });

  it('breaks height ties by slug so the order is stable', () => {
    const a = peak('b-peak', 3000);
    const b = peak('a-peak', 3000);
    expect(slugs(sortPeaks([a, b], 'height'))).toEqual(['a-peak', 'b-peak']);
  });
});

describe('ranges', () => {
  const range = (slug: string, top: number, peakCount: number, regions: RegionSlug[]) => ({
    slug,
    name: slug,
    rangeType: null,
    lengthKm: null,
    peakCount,
    tallest: { slug: `${slug}-top`, name: `${slug} top`, elevationM: top },
    heights: [top],
    countries: [],
    regions,
    tintRegion: regions[0] ?? null,
    needsReview: false,
    hasDescription: false,
  });
  const ranges = [
    range('small', 2000, 9, ['west']),
    range('tall', 5109, 6, ['east', 'central']),
    range('mid', 4000, 3, ['east']),
  ];

  it('filters by region and by range or mountain name', () => {
    expect(filterRanges(ranges, { region: 'central', q: '' }, []).map((r) => r.slug)).toEqual([
      'tall',
    ]);
    const mountains = [
      peak('kibo-like', 4000, { name: 'Margherita', range: { slug: 'tall', name: 'tall' } }),
    ];
    expect(
      filterRanges(ranges, { region: null, q: 'margherita' }, mountains).map((r) => r.slug),
    ).toEqual(['tall']);
  });

  it('sorts by tallest peak, mountain count or name', () => {
    expect(sortRanges(ranges, 'height').map((r) => r.slug)).toEqual(['tall', 'mid', 'small']);
    expect(sortRanges(ranges, 'peaks').map((r) => r.slug)).toEqual(['small', 'tall', 'mid']);
    expect(sortRanges(ranges, 'name').map((r) => r.slug)).toEqual(['mid', 'small', 'tall']);
  });
});
