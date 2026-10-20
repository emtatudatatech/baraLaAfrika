import constants from '../../../config/constants.json' with { type: 'json' };

/** Troy ounces in one metric tonne of fine gold. Defined once in config/constants.json. */
export const TROY_OZ_PER_TONNE: number = constants.TROY_OZ_PER_TONNE;

/** Metres in one international foot (exact by definition). */
export const METRES_PER_FOOT: number = constants.METRES_PER_FOOT;

export function metresToFeet(metres: number): number {
  return metres / METRES_PER_FOOT;
}

export function tonnesToTroyOunces(tonnes: number): number {
  return tonnes * TROY_OZ_PER_TONNE;
}

export function troyOuncesToTonnes(troyOunces: number): number {
  return troyOunces / TROY_OZ_PER_TONNE;
}
