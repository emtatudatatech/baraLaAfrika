import { describe, expect, it } from 'vitest';

import { linePath, linear, niceStep, niceTicks, periodToYear, yearTicks } from './chartMath';

describe('chart scales', () => {
  it('picks round steps', () => {
    expect(niceStep(637)).toBe(200);
    expect(niceStep(4319)).toBe(2000);
    expect(niceStep(0.9)).toBe(0.25);
    expect(niceStep(0)).toBe(1);
  });

  it('covers the maximum with round ticks from zero', () => {
    expect(niceTicks(637)).toEqual([0, 200, 400, 600, 800]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0.9)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('maps linearly, including reversed ranges', () => {
    const y = linear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
  });

  it('breaks lines at missing values instead of bridging them', () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 1, y: 20 },
        { x: 2, y: null },
        { x: 3, y: 5 },
      ]),
    ).toBe('M0.0,10.0L1.0,20.0M3.0,5.0');
  });

  it('spaces year ticks', () => {
    expect(yearTicks(2016, 2026)).toEqual([2016, 2018, 2020, 2022, 2024, 2026]);
    expect(yearTicks(1960, 2026)).toEqual([1960, 1970, 1980, 1990, 2000, 2010, 2020]);
    expect(yearTicks(2024, 2024)).toEqual([2024]);
  });

  it('places a period at its middle', () => {
    expect(periodToYear('2021')).toBe(2021.5);
    expect(periodToYear('2021-01')).toBeCloseTo(2021 + 0.5 / 12, 10);
  });
});
