/*
 * Harim constants with no zod dependency, so the web app can import them without pulling the
 * schema library into its bundles (harim.ts holds the zod contract).
 */

/** Prominence of at least this is "ultra-prominent" (an ultra). */
export const ULTRA_PROMINENCE_M = 1500;

/** The height bands used for colours, the stats band and the map (strict lower bounds). */
export const HEIGHT_BANDS = [
  { key: 'above5000', min: 5000 },
  { key: 'from4000to5000', min: 4000 },
  { key: 'from3000to4000', min: 3000 },
  { key: 'upTo3000', min: -Infinity },
] as const;
export type HeightBand = (typeof HEIGHT_BANDS)[number]['key'];

export function heightBand(metres: number): HeightBand {
  return (HEIGHT_BANDS.find((band) => metres > band.min) ?? HEIGHT_BANDS[3]).key;
}

export const MOUNTAIN_SORTS = ['height', '-height', 'prominence', 'name'] as const;
export type MountainSort = (typeof MOUNTAIN_SORTS)[number];

/** `volcanic=1` means any volcano; a status narrows it (`unknown` = volcanic, no stated status). */
export const VOLCANIC_FILTERS = ['1', 'active', 'dormant', 'extinct', 'unknown'] as const;
export type VolcanicFilter = (typeof VOLCANIC_FILTERS)[number];
