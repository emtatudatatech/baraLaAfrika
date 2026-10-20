import { describe, expect, it } from 'vitest';

import {
  METRES_PER_FOOT,
  TROY_OZ_PER_TONNE,
  metresToFeet,
  tonnesToTroyOunces,
  troyOuncesToTonnes,
} from './constants';

describe('unit constants', () => {
  it('defines one tonne as 32,150.7466 troy ounces', () => {
    expect(TROY_OZ_PER_TONNE).toBe(32150.7466);
    expect(tonnesToTroyOunces(1)).toBe(32150.7466);
    expect(troyOuncesToTonnes(32150.7466)).toBe(1);
  });

  it('converts metres to feet with the exact international foot', () => {
    expect(METRES_PER_FOOT).toBe(0.3048);
    expect(Math.round(metresToFeet(5895))).toBe(19341);
  });
});
