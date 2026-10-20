import type { GoldCountry } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import { largestHolders, producersYear, spreadLabels } from './chartData';

const total = (year: number, complete: boolean) => ({
  year,
  complete,
  tonnes: 1,
  countries: 1,
  missingTonnes: 0,
  missingCountries: 0,
});

const holder = (iso3: string, name: string, tonnes: number | null) =>
  ({
    country: { iso3, name },
    holdings: tonnes === null ? null : { tonnes },
  }) as unknown as GoldCountry;

describe('chart data', () => {
  it('shows producers for the latest complete year, else the latest year', () => {
    expect(producersYear([total(2020, true), total(2021, true), total(2022, false)])).toBe(2021);
    expect(producersYear([total(2023, false), total(2024, false)])).toBe(2024);
    expect(producersYear([])).toBeNull();
    expect(producersYear(null)).toBeNull();
  });

  it('picks the largest holders, ties by name, leaving no data and zero out', () => {
    const rows = [
      holder('EGY', 'Egypt', 129.7),
      holder('DZA', 'Algeria', 173.6),
      holder('LBY', 'Libya', 146.7),
      holder('KEN', 'Kenya', 0),
      holder('MLI', 'Mali', null),
      holder('ZAF', 'South Africa', 129.7),
    ];
    expect(largestHolders(rows, 4).map((r) => r.country.iso3)).toEqual([
      'DZA',
      'LBY',
      'EGY',
      'ZAF',
    ]);
  });

  it('pushes direct labels apart without reordering them', () => {
    expect(spreadLabels([100, 105, 40])).toEqual([100, 114, 40]);
    expect(spreadLabels([10, 10, 10])).toEqual([10, 24, 38]);
  });
});
