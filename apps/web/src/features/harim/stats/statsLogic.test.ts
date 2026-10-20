import type { HarimStat } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import { heightCaveat, shares, statAction, visibleStats } from './statsLogic';

const base = { label: 'L', value: 1, unit: 'm', definition: 'D', scope: null, asOf: '2026-10-15' };

function stat(partial: Partial<HarimStat> & Pick<HarimStat, 'key'>): HarimStat {
  return { ...base, detail: {}, entities: [], ...partial } as HarimStat;
}

const mountain = {
  kind: 'mountain' as const,
  slug: 'kili',
  name: 'Kili',
  elevationM: 5895,
  summitName: 'Kibo',
  countries: ['TZA'],
  confidence: 'high' as const,
  needsReview: false,
  alternatives: [],
};

describe('visibleStats', () => {
  it('orders hero cards first and hides the most prominent peak unless available', () => {
    const all = [
      stat({ key: 'greatest_relief' }),
      stat({ key: 'mountains_catalogued', detail: { countries: 1, territoryPeaks: 0 } }),
      stat({ key: 'most_prominent_peak', detail: { available: false, coverage: 0.3 } }),
      stat({ key: 'tallest_mountain' }),
    ];
    expect(visibleStats(all).map((s) => s.key)).toEqual([
      'mountains_catalogued',
      'tallest_mountain',
      'greatest_relief',
    ]);
    const available = stat({
      key: 'most_prominent_peak',
      detail: { available: true, coverage: 0.9 },
    });
    expect(visibleStats([available]).map((s) => s.key)).toEqual(['most_prominent_peak']);
  });
});

describe('statAction', () => {
  it('opens the peak for mountain cards, the high point for the lowest high point', () => {
    expect(statAction(stat({ key: 'tallest_mountain', entities: [mountain] }))).toEqual({
      kind: 'peak',
      slug: 'kili',
    });
    const lowest = stat({
      key: 'lowest_national_high_point',
      entities: [
        {
          kind: 'country',
          iso3: 'GMB',
          name: 'The Gambia',
          mountain: 'sare-firasu-hill',
          mountainName: 'Sare Firasu Hill',
          elevationM: 51,
          confidence: 'medium',
          needsReview: false,
          alternatives: [],
        },
      ],
    });
    expect(statAction(lowest)).toEqual({ kind: 'peak', slug: 'sare-firasu-hill' });
    // No entity (an empty region): no action.
    expect(statAction(stat({ key: 'tallest_mountain', value: null }))).toBeNull();
  });

  it('filters All peaks with only the card’s own filters', () => {
    expect(statAction(stat({ key: 'volcanic_mountains' }))).toMatchObject({
      target: 'peaks',
      change: { view: 'peaks', volcanic: '1', minHeight: null, country: null, range: null },
    });
    // Strict bands: a peak of exactly 4,000 m is not "above 4,000 m".
    expect(statAction(stat({ key: 'peaks_above_4000' }))).toMatchObject({
      change: { minHeight: 4001, volcanic: null },
    });
    const country = stat({
      key: 'most_mountainous_country',
      entities: [
        { kind: 'country', iso3: 'ETH', name: 'Ethiopia', count: 9 },
        { kind: 'country', iso3: 'UGA', name: 'Uganda', count: 9 },
      ],
    });
    expect(statAction(country, 1)).toMatchObject({
      change: { view: 'peaks', country: 'UGA', minHeight: 3000 },
    });
    const range = stat({
      key: 'busiest_range',
      entities: [
        {
          kind: 'range',
          slug: 'drakensberg',
          name: 'Drakensberg',
          count: 10,
          tallest: { slug: 'mafadi', name: 'Mafadi', elevationM: 3450 },
        },
      ],
    });
    expect(statAction(range)).toMatchObject({
      change: { range: 'drakensberg', minHeight: 3000 },
    });
  });

  it('shows the country row for the lowest point and the greatest relief', () => {
    const low = stat({
      key: 'lowest_point',
      entities: [
        {
          kind: 'country',
          iso3: 'DJI',
          name: 'Djibouti',
          pointName: 'Lake Assal',
          elevationM: -155,
          feature: 'lake',
          needsReview: false,
        },
      ],
    });
    expect(statAction(low)).toEqual({
      kind: 'view',
      target: 'country',
      change: { view: 'country', country: 'DJI', minHeight: null, volcanic: null, range: null },
    });
  });
});

describe('heightCaveat', () => {
  it('flags low confidence or a source more than 10 m away, listing only those', () => {
    expect(heightCaveat(mountain)).toBeNull();
    expect(
      heightCaveat({ ...mountain, alternatives: [{ elevationM: 5890, source: 'GeoNames' }] }),
    ).toBeNull();
    expect(
      heightCaveat({
        ...mountain,
        alternatives: [
          { elevationM: 5890, source: 'GeoNames' },
          { elevationM: 5850, source: 'Prototype' },
        ],
      }),
    ).toEqual({
      lowConfidence: false,
      alternatives: [{ elevationM: 5850, source: 'Prototype' }],
    });
    expect(heightCaveat({ ...mountain, confidence: 'low' })).toEqual({
      lowConfidence: true,
      alternatives: [],
    });
  });
});

describe('shares', () => {
  it('splits counts into shares, and handles an empty total', () => {
    expect(shares({ a: 1, b: 3 }, ['a', 'b'])).toEqual([
      { key: 'a', count: 1, share: 0.25 },
      { key: 'b', count: 3, share: 0.75 },
    ]);
    expect(shares({ a: 0, b: 0 }, ['a', 'b']).map((s) => s.share)).toEqual([0, 0]);
  });
});
