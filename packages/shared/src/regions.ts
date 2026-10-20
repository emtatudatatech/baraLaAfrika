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

/**
 * The regions' names as the database holds them (from the research document; a test keeps them
 * equal to db/seeds/countries.json). For views that must name the regions before the API has
 * answered, such as a page's prerendered first view; the API's names are used once loaded.
 */
export const REGION_NAMES: Readonly<Record<RegionSlug, string>> = {
  north: 'North Africa',
  west: 'West Africa',
  central: 'Central Africa',
  east: 'East Africa',
  southern: 'Southern Africa',
};
