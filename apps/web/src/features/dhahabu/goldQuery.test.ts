import type { GoldCountry } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import { apiYear, filterRows, nextSort, parseView, updateParams, visibleRows } from './goldQuery';

const row = (iso3: string, name: string, region: string, tier: string, tonnes: number | null) =>
  ({
    country: { iso3, name, region: { slug: region } },
    presence: { tier },
    production:
      tonnes === null
        ? null
        : { year: 2021, tonnes, basis: 'reported', valueUsd: null, priceUsdPerOz: null },
    exports: { reported: null, mirror: null },
    holdings: null,
    exportShare: null,
  }) as unknown as GoldCountry;

const ROWS = [
  row('GHA', 'Ghana', 'west', 'major_producer', 150),
  row('CIV', 'Côte d’Ivoire', 'west', 'major_producer', 21),
  row('KEN', 'Kenya', 'east', 'producer', 0.4),
  row('CPV', 'Cabo Verde', 'west', 'none_identified', null),
];

describe('the URL view', () => {
  it('reads valid values and ignores the rest', () => {
    expect(
      parseView(
        new URLSearchParams(
          'region=west&q=+gha+&presence=producer&sort=-name&metric=holdings&country=GHA',
        ),
      ),
    ).toEqual({
      region: 'west',
      q: 'gha',
      presence: 'producer',
      sort: '-name',
      metric: 'holdings',
      country: 'GHA',
    });
    expect(
      parseView(new URLSearchParams('region=mars&presence=x&sort=up&metric=price&country=gh')),
    ).toEqual({
      region: null,
      q: '',
      presence: null,
      sort: 'production',
      metric: 'production',
      country: null,
    });
  });

  it('drops defaults and keeps the ribbon’s years', () => {
    const current = new URLSearchParams('from=2010&to=2020&metric=share&country=GHA');
    expect(
      updateParams(current, { metric: 'production', sort: 'production', country: null }).toString(),
    ).toBe('from=2010&to=2020');
    expect(updateParams(current, { metric: 'presence', q: ' ken ' }).toString()).toBe(
      'from=2010&to=2020&metric=presence&country=GHA&q=ken',
    );
  });
});

describe('filtering and sorting', () => {
  it('filters by region, presence and an accent-insensitive search', () => {
    const view = parseView(new URLSearchParams('region=west'));
    expect(filterRows(ROWS, view).map((r) => r.country.iso3)).toEqual(['GHA', 'CIV', 'CPV']);
    expect(
      filterRows(ROWS, { ...view, region: null, q: 'cote' }).map((r) => r.country.iso3),
    ).toEqual(['CIV']);
    expect(
      filterRows(ROWS, { ...view, presence: 'major_producer' }).map((r) => r.country.iso3),
    ).toEqual(['GHA', 'CIV']);
  });

  it('sorts production largest first with no data last', () => {
    const view = parseView(new URLSearchParams(''));
    expect(visibleRows(ROWS, view).map((r) => r.country.iso3)).toEqual([
      'GHA',
      'CIV',
      'KEN',
      'CPV',
    ]);
  });

  it('reverses the same column and starts a new one its natural way', () => {
    expect(nextSort('production', 'production')).toBe('-production');
    expect(nextSort('-production', 'name')).toBe('name');
  });
});

describe('apiYear', () => {
  it('asks for the latest data while the range ends at the newest year', () => {
    const bounds = { start: 1960, end: 2026 };
    expect(apiYear({ start: 2000, end: 2026 }, bounds)).toBeUndefined();
    expect(apiYear({ start: 2000, end: 2015 }, bounds)).toBe(2015);
    expect(apiYear(null, bounds)).toBeUndefined();
  });
});
