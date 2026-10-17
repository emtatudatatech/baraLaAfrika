import { describe, expect, it } from 'vitest';

import { distanceKm, nearbyPeaks } from './peakFormat';

const peak = (
  slug: string,
  lat: number,
  lon: number,
  countries: string[],
  range: string | null = null,
) => ({
  slug,
  lat,
  lon,
  countries,
  range: range ? { slug: range } : null,
});

describe('distanceKm', () => {
  it('measures great-circle distance', () => {
    // Kilimanjaro to Mount Kenya: about 323 km.
    expect(distanceKm({ lat: -3.0674, lon: 37.3556 }, { lat: -0.1521, lon: 37.3084 })).toBeCloseTo(
      324,
      -1,
    );
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
  });
});

describe('nearbyPeaks', () => {
  it('lists same-range or same-country peaks, nearest first, without itself or its summits', () => {
    const kili = {
      ...peak('kili', -3.07, 37.36, ['TZA']),
      parent: null,
      summits: [{ slug: 'kibo' }],
    };
    const all = [
      kili,
      peak('kibo', -3.07, 37.35, ['TZA']),
      peak('meru', -3.25, 36.76, ['TZA']),
      peak('hanang', -4.43, 35.4, ['TZA']),
      peak('kenya', -0.15, 37.31, ['KEN']),
      peak('elsewhere', 10, 10, ['NGA'], 'far'),
    ];
    expect(nearbyPeaks(kili, all).map((p) => p.slug)).toEqual(['meru', 'hanang']);
    const inRange = { ...peak('a', 0, 0, ['NGA'], 'far'), parent: null, summits: [] };
    expect(nearbyPeaks(inRange, all).map((p) => p.slug)).toEqual(['elsewhere']);
  });
});
