/*
 * Dhahabu constants with no zod dependency, so the web app can import them without pulling the
 * schema library into its bundles (gold.ts holds the zod contract).
 */

/** Presence tiers, strongest evidence first (the order of the band's segmented bar). */
export const PRESENCE_TIERS = [
  'major_producer',
  'producer',
  'occurrences_known',
  'none_identified',
  'unknown',
] as const;
export type PresenceTier = (typeof PRESENCE_TIERS)[number];

/** Sort keys for the country table and /api/gold/countries; `-key` reverses. */
export const GOLD_SORT_KEYS = ['name', 'production', 'exports', 'holdings', 'share'] as const;
export type GoldSortKey = (typeof GOLD_SORT_KEYS)[number];
export const GOLD_SORTS = [
  'name',
  'production',
  'exports',
  'holdings',
  'share',
  '-name',
  '-production',
  '-exports',
  '-holdings',
  '-share',
] as const satisfies readonly (GoldSortKey | `-${GoldSortKey}`)[];
export type GoldSort = (typeof GOLD_SORTS)[number];

/** The cards of the statistics band, in order (hero cards first). */
export const GOLD_STAT_KEYS = [
  'gold_producing_countries',
  'africa_production',
  'production_value',
  'largest_producer',
  'central_bank_gold',
  'largest_holder',
  'gold_price',
  'most_gold_dependent',
  'biggest_reporting_gap',
  'largest_net_buyer',
] as const;
export type GoldStatKey = (typeof GOLD_STAT_KEYS)[number];

/** Mass units the page can show; tonnes are stored, the others are display conversions. */
export const GOLD_UNITS = ['t', 'kg', 'oz'] as const;
export type GoldUnit = (typeof GOLD_UNITS)[number];

export const GOLD_EXPORT_FORMATS = ['csv'] as const;

export const PRICE_GRANULARITIES = ['month', 'year'] as const;
export type PriceGranularity = (typeof PRICE_GRANULARITIES)[number];
