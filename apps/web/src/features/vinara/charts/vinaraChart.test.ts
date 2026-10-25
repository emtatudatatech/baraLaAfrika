import { describe, expect, it } from 'vitest';

import { niceTicks, ordinal, signedBarPath, tickLabel } from './vinaraChart';

describe('Vinara chart helpers', () => {
  it('covers the values and zero with round ticks, below zero when needed', () => {
    expect(niceTicks([3, 8])).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks([-16.67, 8.25])).toEqual([-20, -10, 0, 10]);
    expect(niceTicks([-5, -1])).toEqual([-6, -4, -2, 0]);
    expect(niceTicks([0])).toEqual([0, 0.25]);
  });

  it('rounds a bar only at its data end, on either side of zero', () => {
    expect(signedBarPath(100, 150, 10, 14)).toBe('M100,10h46a4,4 0 0 1 4,4v6a4,4 0 0 1 -4,4h-46Z');
    expect(signedBarPath(100, 50, 10, 14)).toBe('M100,10h-46a4,4 0 0 0 -4,4v6a4,4 0 0 0 4,4h46Z');
  });

  it('labels axis ticks compactly in the metric’s unit', () => {
    expect(tickLabel({ unit: 'people' }, 200_000_000)).toBe('200m');
    expect(tickLabel({ unit: 'current_usd' }, 400e9)).toBe('US$400 bn');
    expect(tickLabel({ unit: 'percent' }, -10)).toBe('-10%');
    expect(tickLabel({ unit: 'km2' }, 2_000_000)).toBe('2m');
    expect(tickLabel({ unit: 'index' }, 0.6)).toBe('0.6');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 54].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '54th',
    ]);
  });
});
