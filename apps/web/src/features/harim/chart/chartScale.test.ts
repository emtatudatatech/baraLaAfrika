import { describe, expect, it } from 'vitest';

import { barPath, heightTicks, truncate } from './chartScale';

describe('chart scale', () => {
  it('ticks every 1,000 m or 5,000 ft up past the tallest value', () => {
    expect(heightTicks(5895, 'm')).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000]);
    expect(heightTicks(5895, 'ft')).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(heightTicks(0, 'm')).toEqual([0, 1000]);
  });

  it('draws a bar with a rounded end and a square base', () => {
    expect(barPath(10, 0, 100, 12)).toBe('M10,0 h96 a4,4 0 0 1 4,4 v4 a4,4 0 0 1 -4,4 h-96 Z');
    // Too short for the full radius: still a valid shape.
    expect(barPath(0, 0, 2, 12)).toContain('a2,2');
  });

  it('truncates long labels with an ellipsis', () => {
    expect(truncate('Kenya', 100)).toBe('Kenya');
    expect(truncate('Democratic Republic of the Congo', 110)).toBe('Democratic Repub…');
  });
});
