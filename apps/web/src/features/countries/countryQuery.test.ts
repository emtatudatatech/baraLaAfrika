import type { CountrySummary, RegionSlug } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SORT,
  filterCountries,
  parseSort,
  parseView,
  sortCountries,
  toggleSort,
  updateParams,
} from './countryQuery';
import { parseReviewNotes } from '../../lib/reviewNotes';
import { searchFold } from '../../lib/searchFold';

const REGION_NAMES: Record<RegionSlug, string> = {
  north: 'Northern Africa',
  west: 'Western Africa',
  central: 'Central Africa',
  east: 'Eastern Africa',
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
    facts: { population: null, landAreaKm2: null, leaders: [], election: null, note: null },
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
      parseView(new URLSearchParams('view=facts&region=east&q= kenya &sort=-animal&country=ken')),
    ).toEqual({
      view: 'facts',
      region: 'east',
      q: 'kenya',
      sort: { key: 'animal', direction: 'desc' },
      country: 'KEN',
    });
    expect(parseView(new URLSearchParams('view=x&region=asia&sort=flag&country=KENYA'))).toEqual({
      view: 'symbols',
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

function withFacts(
  iso3: string,
  name: string,
  population: number | null,
  election: {
    date: string | null;
    status: 'within_12_months' | 'beyond_12_months' | 'no_date_set';
  },
  leader?: string,
): CountrySummary {
  return country(iso3, name, 'east', {
    facts: {
      population: population === null ? null : { value: population, year: 2025, estimate: false },
      landAreaKm2: null,
      leaders:
        leader === undefined
          ? []
          : [
              {
                role: 'head_of_state_and_government',
                title: 'President',
                name: leader,
                executive: true,
                transitional: false,
                deFacto: false,
              },
            ],
      election: {
        decides: 'presidential',
        kind: 'general',
        date: election.date,
        precision: election.date === null ? null : 'day',
        status: election.status,
      },
      note: null,
    },
  });
}

describe('facts view', () => {
  const FACTS = [
    withFacts(
      'KEN',
      'Kenya',
      56e6,
      { date: '2027-08-10', status: 'within_12_months' },
      'William Ruto',
    ),
    withFacts('ERI', 'Eritrea', null, { date: null, status: 'no_date_set' }, 'Isaias Afwerki'),
    withFacts('NGA', 'Nigeria', 232e6, { date: '2027-01-16', status: 'within_12_months' }),
    withFacts('GHA', 'Ghana', 35e6, { date: '2029-01-07', status: 'beyond_12_months' }),
  ];
  const names = (rows: CountrySummary[]) => rows.map((c) => c.name);

  it('keeps the view in the URL only when it is not the default', () => {
    expect(updateParams(new URLSearchParams('view=facts'), { view: 'symbols' }).toString()).toBe(
      '',
    );
    expect(updateParams(new URLSearchParams(), { view: 'facts' }).toString()).toBe('view=facts');
  });

  it('sorts figures largest first on the first click, with no data last both ways', () => {
    const first = toggleSort(DEFAULT_SORT, 'population');
    expect(first).toEqual({ key: 'population', direction: 'desc' });
    expect(names(sortCountries(FACTS, first))).toEqual(['Nigeria', 'Kenya', 'Ghana', 'Eritrea']);
    expect(names(sortCountries(FACTS, toggleSort(first, 'population')))).toEqual([
      'Ghana',
      'Kenya',
      'Nigeria',
      'Eritrea',
    ]);
  });

  it('sorts elections soonest first, countries without a date last', () => {
    const sort = toggleSort(DEFAULT_SORT, 'election');
    expect(sort.direction).toBe('asc');
    expect(names(sortCountries(FACTS, sort))).toEqual(['Nigeria', 'Kenya', 'Ghana', 'Eritrea']);
  });

  it('sorts by leader with unknown leaders last, and searches leaders', () => {
    const sort = toggleSort(DEFAULT_SORT, 'leader');
    expect(names(sortCountries(FACTS, sort))).toEqual(['Eritrea', 'Kenya', 'Ghana', 'Nigeria']);
    expect(names(filterCountries(FACTS, { region: null, q: 'ruto' }))).toEqual(['Kenya']);
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
