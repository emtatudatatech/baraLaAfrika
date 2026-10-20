import type { GoldCountry } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import {
  classBreaks,
  classLabels,
  classOf,
  metricMark,
  rampStep,
  roundBreak,
} from './goldMapModel';

const empty = {
  production: null,
  exports: { reported: null, mirror: null },
  imports: { reported: null, mirror: null },
  holdings: null,
  reporting: null,
  exportShare: null,
} as unknown as GoldCountry;

const production = (tonnes: number | null) =>
  ({
    ...empty,
    production: {
      year: 2021,
      tonnes,
      basis: tonnes === null ? 'included_in_other' : 'reported',
      valueUsd: null,
      priceUsdPerOz: null,
      source: 's',
      notes: null,
    },
  }) as GoldCountry;

describe('metricMark', () => {
  it('keeps no data, a reported zero and "included in other" apart', () => {
    expect(metricMark(empty, 'production')).toEqual({ kind: 'none' });
    expect(metricMark(production(0), 'production')).toEqual({
      kind: 'value',
      value: 0,
      period: '2021',
    });
    expect(metricMark(production(null), 'production')).toEqual({
      kind: 'included',
      period: '2021',
    });
  });

  it('dates holdings by month and leaves an inconsistent share undrawn', () => {
    const holding = {
      ...empty,
      holdings: { asOf: '2026-07-31', tonnes: 173.6 },
    } as unknown as GoldCountry;
    expect(metricMark(holding, 'holdings')).toEqual({
      kind: 'value',
      value: 173.6,
      period: 'Jul 2026',
    });
    const inconsistent = {
      ...empty,
      exportShare: { year: 2020, pct: null, exceedsTotal: true },
    } as unknown as GoldCountry;
    expect(metricMark(inconsistent, 'share')).toEqual({ kind: 'none' });
  });
});

describe('class breaks', () => {
  it('rounds breaks to two significant figures', () => {
    expect(roundBreak(1234)).toBe(1200);
    expect(roundBreak(0.0456)).toBeCloseTo(0.046, 10);
    expect(roundBreak(0)).toBe(0);
  });

  it('splits values into five classes of about equal counts', () => {
    const values = Array.from({ length: 50 }, (_, i) => i + 1);
    const breaks = classBreaks(values);
    expect(breaks).toEqual([11, 21, 31, 41]);
    const counts = [0, 0, 0, 0, 0];
    for (const v of values) counts[classOf(v, breaks)] = (counts[classOf(v, breaks)] ?? 0) + 1;
    expect(counts).toEqual([10, 10, 10, 10, 10]);
  });

  it('drops duplicate breaks for small or repetitive sets', () => {
    expect(classBreaks([0, 0, 0, 5])).toEqual([5]);
    expect(classBreaks([3])).toEqual([]);
  });

  it('spreads fewer classes over the whole ramp', () => {
    expect([0, 1, 2, 3, 4].map((i) => rampStep(i, 5))).toEqual([1, 2, 3, 4, 5]);
    expect([0, 1].map((i) => rampStep(i, 2))).toEqual([1, 5]);
  });

  it('labels the classes in the unit', () => {
    const words = {
      under: (v: string) => `Under ${v}`,
      between: (a: string, b: string) => `${a}–${b}`,
      over: (v: string) => `${v} or more`,
    };
    expect(classLabels('share', [10, 50], 't', words)).toEqual([
      'Under 10.0%',
      '10.0%–50.0%',
      '50.0% or more',
    ]);
  });
});
