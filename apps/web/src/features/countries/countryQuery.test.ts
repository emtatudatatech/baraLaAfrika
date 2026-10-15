import type { CountrySummary, RegionSlug } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SORT,
  filterCountries,
  parseSort,
  parseView,
  searchFold,
  sortCountries,
  toggleSort,
  updateParams,
} from './countryQuery';
import { parseReviewNotes } from './reviewNotes';

const REGION_NAMES: Record<RegionSlug, string> = {
  north: 'North Africa',
  west: 'West Africa',
  central: 'Central Africa',
  east: 'East Africa',
  southern: 'Southern Africa',
};

function country(
  iso3: string,
  name: string,
  region: RegionSlug,
  extra: Partial<CountrySummary> = {},
): CountrySummary {
  return {
    iso3,
    iso2: iso3.slice(0, 2),
    name,
    officialName: null,
    region: { slug: region, name: REGION_NAMES[region], colorHex: null },
    flag: {
      svgUrl: `https://flagcdn.com/${iso3.slice(0, 2).toLowerCase()}.svg`,
      pngUrlTemplate: 'https://flagcdn.com/w{width}/xx.png',
      fallbackUrl: '/flags/xx.svg',
    },
    centroid: null,
    isMicrostateMarker: false,
    etymologySummary: `${name} meaning`,
    etymologyCategory: null,
    flagDesignSummary: 'Stripes',
    flagDesignDetail: null,
    nationalSymbolSummary: 'Emblem',
    nationalAnimalName: 'Lion',
    animalStatus: 'official',
    needsReview: false,
    ...extra,
  };
}

const FIXTURE = [
  country('KEN', 'Kenya', 'east', { etymologySummary: 'Spotted Mountain' }),
  country('CIV', "Côte d'Ivoire", 'west', { officialName: "Republic of Côte d'Ivoire" }),
  country('STP', 'São Tomé and Príncipe', 'central', { nationalAnimalName: 'Falcon' }),
  country('EGY', 'Egypt', 'north', { nationalAnimalName: 'Steppe Eagle' }),
  country('ZAF', 'South Africa', 'southern', { nationalAnimalName: 'Springbok' }),
  country('ETH', 'Ethiopia', 'east', { nationalAnimalName: 'Lion' }),
];

const names = (list: readonly CountrySummary[]) => list.map((c) => c.name);

describe('URL state', () => {
  it('parses a full view and ignores invalid values', () => {
    expect(
      parseView(new URLSearchParams('region=east&q= kenya &sort=-animal&country=ken')),
    ).toEqual({
      region: 'east',
      q: 'kenya',
      sort: { key: 'animal', direction: 'desc' },
      country: 'KEN',
    });
    expect(parseView(new URLSearchParams('region=asia&sort=flag&country=KENYA'))).toEqual({
      region: null,
      q: '',
      sort: DEFAULT_SORT,
      country: null,
    });
  });

  it('caps the search length like the API does', () => {
    expect(parseView(new URLSearchParams(`q=${'a'.repeat(200)}`)).q).toHaveLength(80);
  });

  it('parses sort direction from a leading minus', () => {
    expect(parseSort('region')).toEqual({ key: 'region', direction: 'asc' });
    expect(parseSort('-name')).toEqual({ key: 'name', direction: 'desc' });
    expect(parseSort('--name')).toEqual(DEFAULT_SORT);
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
  });

  it('writes only non-default values and keeps unrelated params', () => {
    const start = new URLSearchParams('utm=x&region=west&sort=-name');
    const next = updateParams(start, { region: null, sort: DEFAULT_SORT, q: '  sao ' });
    expect(next.toString()).toBe('utm=x&q=sao');
    expect(updateParams(next, { country: 'KEN' }).get('country')).toBe('KEN');
    expect(updateParams(next, { sort: { key: 'animal', direction: 'asc' } }).get('sort')).toBe(
      'animal',
    );
  });

  it('toggles sort direction on the same column and resets on a new one', () => {
    expect(toggleSort(DEFAULT_SORT, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(toggleSort({ key: 'name', direction: 'desc' }, 'name')).toEqual(DEFAULT_SORT);
    expect(toggleSort({ key: 'name', direction: 'desc' }, 'animal')).toEqual({
      key: 'animal',
      direction: 'asc',
    });
  });
});

describe('filtering', () => {
  it('filters by region', () => {
    expect(names(filterCountries(FIXTURE, { region: 'east', q: '' }))).toEqual([
      'Kenya',
      'Ethiopia',
    ]);
  });

  it('matches without accents, case or curly apostrophes', () => {
    expect(searchFold('São Tomé')).toBe('sao tome');
    expect(names(filterCountries(FIXTURE, { region: null, q: 'COTE D’IV' }))).toEqual([
      "Côte d'Ivoire",
    ]);
    expect(names(filterCountries(FIXTURE, { region: null, q: 'principe' }))).toEqual([
      'São Tomé and Príncipe',
    ]);
  });

  it('searches official names, ISO codes and the visible columns', () => {
    expect(names(filterCountries(FIXTURE, { region: null, q: 'republic of' }))).toEqual([
      "Côte d'Ivoire",
    ]);
    expect(names(filterCountries(FIXTURE, { region: null, q: 'zaf' }))).toEqual(['South Africa']);
    expect(names(filterCountries(FIXTURE, { region: null, q: 'spotted' }))).toEqual(['Kenya']);
    expect(names(filterCountries(FIXTURE, { region: null, q: 'eagle' }))).toEqual(['Egypt']);
  });

  it('combines region and search, and can match nothing', () => {
    expect(names(filterCountries(FIXTURE, { region: 'east', q: 'lion' }))).toEqual([
      'Kenya',
      'Ethiopia',
    ]);
    expect(filterCountries(FIXTURE, { region: 'north', q: 'lion' })).toEqual([]);
  });
});

describe('sorting', () => {
  it('sorts names with accents in their natural place', () => {
    expect(names(sortCountries(FIXTURE, DEFAULT_SORT))).toEqual([
      "Côte d'Ivoire",
      'Egypt',
      'Ethiopia',
      'Kenya',
      'São Tomé and Príncipe',
      'South Africa',
    ]);
  });

  it('sorts regions in display order, ties by name in both directions', () => {
    const asc = names(sortCountries(FIXTURE, { key: 'region', direction: 'asc' }));
    expect(asc).toEqual([
      'Egypt',
      "Côte d'Ivoire",
      'São Tomé and Príncipe',
      'Ethiopia',
      'Kenya',
      'South Africa',
    ]);
    const desc = names(sortCountries(FIXTURE, { key: 'region', direction: 'desc' }));
    expect(desc).toEqual([
      'South Africa',
      'Ethiopia',
      'Kenya',
      'São Tomé and Príncipe',
      "Côte d'Ivoire",
      'Egypt',
    ]);
  });

  it('sorts by a text column and does not mutate its input', () => {
    const before = names(FIXTURE);
    // Steppe Eagle > Springbok > Lion ×3 (ties A–Z) > Falcon.
    expect(names(sortCountries(FIXTURE, { key: 'animal', direction: 'desc' }))).toEqual([
      'Egypt',
      'South Africa',
      "Côte d'Ivoire",
      'Ethiopia',
      'Kenya',
      'São Tomé and Príncipe',
    ]);
    expect(names(FIXTURE)).toEqual(before);
  });
});

describe('review notes', () => {
  it('splits lines and recognises tags', () => {
    expect(
      parseReviewNotes(
        'The etymology relies mainly on low-reliability sources.\n' +
          '[corrected] national animal detail: Adds the emblem basis.\n' +
          '[status] national animal: Two lions support the arms.\n' +
          '[medium] national animal: No prose sentence.\n' +
          '[unknown] kept as is\n\n',
      ),
    ).toEqual([
      { kind: 'note', text: 'The etymology relies mainly on low-reliability sources.' },
      { kind: 'correction', text: 'National animal detail: Adds the emblem basis.' },
      { kind: 'status', text: 'National animal: Two lions support the arms.' },
      { kind: 'issue', text: 'National animal: No prose sentence.' },
      { kind: 'note', text: '[unknown] kept as is' },
    ]);
    expect(parseReviewNotes(null)).toEqual([]);
  });
});
