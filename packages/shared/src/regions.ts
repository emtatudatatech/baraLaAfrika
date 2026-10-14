/**
 * Region slugs follow the research document's grouping (the project's source of truth),
 * not the UN geoscheme. The authoritative assignment of countries lives in the database;
 * this list only fixes the closed set of slugs and their display order.
 */
export const REGION_SLUGS = ['north', 'west', 'central', 'east', 'southern'] as const;

export type RegionSlug = (typeof REGION_SLUGS)[number];

export function isRegionSlug(value: unknown): value is RegionSlug {
  return typeof value === 'string' && (REGION_SLUGS as readonly string[]).includes(value);
}
