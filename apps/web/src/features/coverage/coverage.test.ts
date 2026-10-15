import type { CoverageDataset } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import {
  formatCoverage,
  formatDate,
  formatPeriod,
  formatRelative,
  granularityOf,
  summarize,
} from './coverageFormat';
import {
  applyRange,
  boundsOf,
  formatRange,
  matchesPreset,
  presetRange,
  resolveRange,
} from './timeRange';

function dataset(partial: Partial<CoverageDataset>): CoverageDataset {
  return {
    key: 'gold-price',
    name: 'Gold price',
    provider: 'Provider',
    license: 'Licence',
    attribution: 'Attribution',
    coverageStart: null,
    coverageEnd: null,
    asOf: '2026-10-01',
    lastRefreshedAt: null,
    refreshCadence: 'monthly',
    ...partial,
  };
}

describe('coverage formatting', () => {
  it('formats calendar dates in UTC, never shifted by the time zone', () => {
    expect(formatDate('2026-10-14')).toBe('14 Oct 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate('2026-09-05')).toBe('5 Sep 2026');
    expect(formatDate('2026-10-15T23:30:00-05:00')).toBe('16 Oct 2026');
  });

  it('formats coverage bounds at the cadence’s granularity', () => {
    expect(granularityOf('monthly')).toBe('month');
    expect(granularityOf('quarterly')).toBe('quarter');
    expect(granularityOf('annual')).toBe('year');
    expect(granularityOf('static')).toBe('day');
    expect(formatPeriod('2026-09-30', 'quarter')).toBe('Q3 2026');
    expect(formatPeriod('2026-12-31', 'quarter')).toBe('Q4 2026');
    expect(formatPeriod('2026-01-01', 'month')).toBe('Jan 2026');
    expect(
      formatCoverage(
        dataset({ coverageStart: '2000-01-01', coverageEnd: '2026-09-30', refreshCadence: 'monthly' }),
      ),
    ).toBe('Jan 2000–Sep 2026');
    expect(
      formatCoverage(
        dataset({ coverageStart: '1990-01-01', coverageEnd: '2024-12-31', refreshCadence: 'annual' }),
      ),
    ).toBe('1990–2024');
    expect(formatCoverage(dataset({ coverageEnd: '2026-06-30', refreshCadence: 'quarterly' }))).toBe(
      'to Q2 2026',
    );
    expect(formatCoverage(dataset({ coverageStart: '2001-01-01', refreshCadence: 'annual' }))).toBe(
      '2001 onwards',
    );
    expect(formatCoverage(dataset({}))).toBeNull();
  });

  it('describes refresh times relative to now', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(formatRelative('2026-10-17T08:00:00Z', now)).toBe('today');
    expect(formatRelative('2026-10-16T08:00:00Z', now)).toBe('yesterday');
    expect(formatRelative('2026-10-15T08:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-10-01T08:00:00Z', now)).toBe('2 weeks ago');
    expect(formatRelative('2026-06-01T08:00:00Z', now)).toBe('4 months ago');
    expect(formatRelative('2025-09-01T08:00:00Z', now)).toBe('last year');
    // A clock slightly behind the server never reads as "in the future".
    expect(formatRelative('2026-10-17T12:05:00Z', now)).toBe('today');
  });

  it('summarises the newest as-of and refresh times', () => {
    expect(
      summarize([
        dataset({ asOf: '2018-05-23', lastRefreshedAt: '2026-10-15T08:00:00Z' }),
        dataset({ asOf: '2026-10-14', lastRefreshedAt: null }),
        dataset({ asOf: '2026-10-01', lastRefreshedAt: '2026-10-16T01:00:00+03:00' }),
      ]),
    ).toEqual({ asOf: '2026-10-14', lastRefreshedAt: '2026-10-16T01:00:00+03:00' });
    expect(summarize([])).toEqual({ asOf: null, lastRefreshedAt: null });
  });
});

describe('time range', () => {
  const bounds = { start: 1990, end: 2025 };

  it('takes its bounds from the datasets that are series', () => {
    expect(
      boundsOf([
        dataset({ coverageStart: '2000-01-01', coverageEnd: '2026-09-30' }),
        dataset({ coverageStart: '1990-01-01', coverageEnd: '2024-12-31' }),
        dataset({}),
      ]),
    ).toEqual({ start: 1990, end: 2026 });
    expect(boundsOf([dataset({})])).toBeNull();
    expect(boundsOf([])).toBeNull();
  });

  it('reads the URL against the bounds: defaults, clamping and order', () => {
    const read = (query: string) => resolveRange(new URLSearchParams(query), bounds);
    expect(read('')).toEqual(bounds);
    expect(read('from=2010')).toEqual({ start: 2010, end: 2025 });
    expect(read('from=1900&to=2100')).toEqual(bounds);
    expect(read('from=2020&to=2010')).toEqual({ start: 2010, end: 2020 });
    expect(read('from=abc&to=20')).toEqual(bounds);
    expect(resolveRange(new URLSearchParams('from=2010'), null)).toBeNull();
  });

  it('writes only what differs from the full coverage', () => {
    const current = new URLSearchParams('region=west&from=2000');
    expect(applyRange(current, { start: 2016, end: 2025 }, bounds).toString()).toBe(
      'region=west&from=2016',
    );
    expect(applyRange(current, bounds, bounds).toString()).toBe('region=west');
    expect(applyRange(current, { start: 2020, end: 2010 }, bounds).toString()).toBe(
      'region=west&from=2010&to=2020',
    );
  });

  it('computes presets inside the coverage', () => {
    expect(presetRange('last5', bounds)).toEqual({ start: 2021, end: 2025 });
    expect(presetRange('last10', bounds)).toEqual({ start: 2016, end: 2025 });
    expect(presetRange('since2000', bounds)).toEqual({ start: 2000, end: 2025 });
    expect(presetRange('all', bounds)).toEqual(bounds);
    const short = { start: 2020, end: 2025 };
    expect(presetRange('last10', short)).toEqual(short);
    expect(presetRange('since2000', short)).toEqual(short);
    // With short coverage several presets describe the same range, and all show as active.
    expect(matchesPreset('last10', short, short)).toBe(true);
    expect(matchesPreset('all', short, short)).toBe(true);
    expect(matchesPreset('last5', short, short)).toBe(false);
  });

  it('formats a range', () => {
    expect(formatRange({ start: 2016, end: 2025 })).toBe('2016–2025');
    expect(formatRange({ start: 2025, end: 2025 })).toBe('2025');
  });
});
