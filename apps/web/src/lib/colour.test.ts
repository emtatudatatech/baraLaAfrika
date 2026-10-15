import { describe, expect, it } from 'vitest';

import {
  DARK_MAP_BACKGROUND,
  MIN_REGION_DELTA_E,
  ciede2000,
  contrastRatio,
  darkThemePalette,
  deltaE,
  hexToOklch,
  oklchToHex,
} from './colour';

const APPROVED = {
  north: '#c1272d',
  west: '#009e49',
  central: '#fcd116',
  east: '#418fde',
  southern: '#001489',
};

describe('colour helpers', () => {
  it('round-trips OKLCH', () => {
    for (const hex of Object.values(APPROVED)) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });

  it('matches published CIEDE2000 test data (Sharma et al. 2005)', () => {
    expect(ciede2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(ciede2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(ciede2000([50, 2.5, 0], [56, -27, -3])).toBeCloseTo(31.903, 3);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

describe('darkThemePalette', () => {
  const dark = darkThemePalette(APPROVED);
  const darkOf = (key: string) => dark[key] ?? '';

  it('keeps every hue', () => {
    for (const [key, hex] of Object.entries(APPROVED)) {
      expect(Math.abs(hexToOklch(darkOf(key)).h - hexToOklch(hex).h)).toBeLessThan(1);
    }
  });

  it('reaches 3:1 against the dark map and keeps regions at least ΔE 30 apart', () => {
    const keys = Object.keys(dark);
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      expect(contrastRatio(darkOf(key), DARK_MAP_BACKGROUND)).toBeGreaterThanOrEqual(2.995);
    }
    for (const [i, a] of keys.entries()) {
      for (const b of keys.slice(i + 1)) {
        expect(deltaE(darkOf(a), darkOf(b))).toBeGreaterThanOrEqual(MIN_REGION_DELTA_E);
      }
    }
  });

  it('leaves colours that already pass unchanged', () => {
    expect(dark.central).toBe('#fcd116');
    expect(dark.west).toBe('#009e49');
  });
});
