import { z } from 'zod';

import { EXPORT_FORMATS, MOUNTAIN_SORTS, VOLCANIC_FILTERS } from './harimConstants.ts';
import { REGION_SLUGS } from './regions.ts';
import { FlagSchema, ReliabilityTierSchema, RegionSlugSchema } from './schemas.ts';

/* The Harim (mountains) API contract. Metres throughout; feet are a display conversion. */

export const PeakTypeSchema = z.enum([
  'stratovolcano',
  'shield_volcano',
  'volcano',
  'massif',
  'peak',
  'other',
]);
export const VolcanicStatusSchema = z.enum(['active', 'dormant', 'extinct']);
export const SummitKindSchema = z.enum(['standalone', 'massif', 'summit']);
export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const LowPointFeatureSchema = z.enum([
  'depression',
  'lake',
  'river',
  'salt_flat',
  'coast',
  'other',
]);
export const MountainFieldSchema = z.enum([
  'identity',
  'elevation',
  'coordinates',
  'prominence',
  'range',
  'hierarchy',
  'volcanic_status',
  'local_names',
  'name_origin',
]);

export type PeakType = z.infer<typeof PeakTypeSchema>;
export type VolcanicStatus = z.infer<typeof VolcanicStatusSchema>;
export type SummitKind = z.infer<typeof SummitKindSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type LowPointFeature = z.infer<typeof LowPointFeatureSchema>;

// ── Requests ─────────────────────────────────────────────────────────────────

const searchText = z
  .string()
  .trim()
  .max(80)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const MountainSummaryQuerySchema = z.object({
  region: RegionSlugSchema.optional(),
  q: searchText,
});
export type MountainSummaryQuery = z.infer<typeof MountainSummaryQuerySchema>;

export const MountainsQuerySchema = z.object({
  region: RegionSlugSchema.optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Expected a three-letter ISO 3166-1 alpha-3 code')
    .transform((value) => value.toUpperCase())
    .optional(),
  range: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Expected a range slug')
    .max(80)
    .optional(),
  q: searchText,
  minHeight: z.coerce.number().int().min(0).max(6000).optional(),
  volcanic: z.enum(VOLCANIC_FILTERS).optional(),
  sort: z.enum(MOUNTAIN_SORTS).default('height'),
  /** `territories=1`: only peaks in territories outside the 54 countries. */
  territories: z.enum(['1']).optional(),
  /** `summits=1`: include massifs' summits as rows (they are never counted). */
  summits: z.enum(['1']).optional(),
});
export type MountainsQuery = z.infer<typeof MountainsQuerySchema>;

export const MountainSlugParamSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(120);

export const MountainStatsQuerySchema = z.object({ region: RegionSlugSchema.optional() });

// ── Responses ────────────────────────────────────────────────────────────────

export const CountryRefSchema = z.object({
  iso3: z.string().length(3),
  iso2: z.string().length(2),
  name: z.string(),
  region: z.object({ slug: RegionSlugSchema, name: z.string(), colorHex: z.string().nullable() }),
  flag: FlagSchema,
});
export type CountryRef = z.infer<typeof CountryRefSchema>;

export const MountainCountrySummarySchema = z.object({
  country: CountryRefSchema,
  highestPeak: z
    .object({
      slug: z.string(),
      name: z.string(),
      /** For a massif, its highest summit (e.g. Kibo for Kilimanjaro). */
      summitName: z.string().nullable(),
      elevationM: z.number().int(),
      confidence: ConfidenceSchema,
      sharedWith: z.array(z.string().length(3)),
      needsReview: z.boolean(),
    })
    .nullable(),
  peakCount: z.number().int().nonnegative(),
  meanPeakM: z.number().int().nullable(),
  ranges: z.array(z.string()),
  lowestPoint: z
    .object({
      name: z.string(),
      elevationM: z.number().int(),
      feature: LowPointFeatureSchema,
      needsReview: z.boolean(),
    })
    .nullable(),
  reliefM: z.number().int().nullable(),
});
export type MountainCountrySummary = z.infer<typeof MountainCountrySummarySchema>;

export const MountainSummaryResponseSchema = z.object({
  countries: z.array(MountainCountrySummarySchema),
  count: z.number().int().nonnegative(),
});
export type MountainSummaryResponse = z.infer<typeof MountainSummaryResponseSchema>;

const NamedRefSchema = z.object({ slug: z.string(), name: z.string() });

export const MountainSchema = z.object({
  slug: z.string(),
  name: z.string(),
  altNames: z.array(z.string()),
  elevationM: z.number().int(),
  confidence: ConfidenceSchema,
  lat: z.number(),
  lon: z.number(),
  peakType: PeakTypeSchema.nullable(),
  volcanicStatus: VolcanicStatusSchema.nullable(),
  isVolcanic: z.boolean(),
  prominenceM: z.number().int().nullable(),
  isolationKm: z.number().nullable(),
  summitKind: SummitKindSchema,
  parent: NamedRefSchema.nullable(),
  range: NamedRefSchema.nullable(),
  countries: z.array(z.string().length(3)),
  highPointOf: z.array(z.string().length(3)),
  isShared: z.boolean(),
  territory: z.string().nullable(),
  needsReview: z.boolean(),
  /** For a massif, its summits (highest first). */
  summits: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      elevationM: z.number().int(),
      confidence: ConfidenceSchema,
    }),
  ),
});
export type Mountain = z.infer<typeof MountainSchema>;

export const MountainsResponseSchema = z.object({
  mountains: z.array(MountainSchema),
  count: z.number().int().nonnegative(),
  /** Mountains matching the filters; `count` is lower when the list was capped. */
  total: z.number().int().nonnegative(),
  capped: z.boolean(),
});
export type MountainsResponse = z.infer<typeof MountainsResponseSchema>;

export const MountainSourceSchema = z.object({
  key: z.string(),
  title: z.string(),
  url: z.url(),
  sourceType: z.string(),
  reliabilityTier: ReliabilityTierSchema,
  fields: z.array(MountainFieldSchema),
});
export type MountainSource = z.infer<typeof MountainSourceSchema>;

const SourceRefSchema = z.object({ key: z.string(), title: z.string(), url: z.url() });

export const MountainDetailSchema = MountainSchema.extend({
  elevationSource: SourceRefSchema,
  elevationAlternatives: z.array(
    z.object({ elevationM: z.number().int(), source: SourceRefSchema }),
  ),
  localNames: z.array(
    z.object({
      name: z.string(),
      language: z.string(),
      meaning: z.string().nullable(),
      source: SourceRefSchema,
    }),
  ),
  nameOrigin: z.object({ text: z.string(), source: SourceRefSchema.nullable() }).nullable(),
  notes: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  wikidataQid: z.string().nullable(),
  geonamesId: z.number().int().nullable(),
  sources: z.array(MountainSourceSchema),
});
export type MountainDetail = z.infer<typeof MountainDetailSchema>;

export const MountainResponseSchema = z.object({ mountain: MountainDetailSchema });
export type MountainResponse = z.infer<typeof MountainResponseSchema>;

// ── Ranges ───────────────────────────────────────────────────────────────────

export const RangeTypeSchema = z.enum([
  'volcanic',
  'fold',
  'rift_shoulder',
  'massif',
  'plateau_escarpment',
  'other',
]);
export type RangeType = z.infer<typeof RangeTypeSchema>;

export const RangesQuerySchema = z.object({
  region: RegionSlugSchema.optional(),
  q: searchText,
});
export type RangesQuery = z.infer<typeof RangesQuerySchema>;

export const RangeSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  rangeType: RangeTypeSchema.nullable(),
  lengthKm: z.number().nullable(),
  /** Counted mountains (a massif once, a border peak once). */
  peakCount: z.number().int().nonnegative(),
  tallest: z
    .object({ slug: z.string(), name: z.string(), elevationM: z.number().int() })
    .nullable(),
  /** Its mountains' heights in metres, highest first (the mini bar). */
  heights: z.array(z.number().int()),
  /** Countries it spans, those with the most of its peaks first. */
  countries: z.array(z.string().length(3)),
  regions: z.array(RegionSlugSchema),
  /** The card's tint: the region of the country with the most of its peaks; null when split. */
  tintRegion: RegionSlugSchema.nullable(),
  /** True when its text is unsourced or uncertain. */
  needsReview: z.boolean(),
  /** True when a sourced description is available (shown on the range page). */
  hasDescription: z.boolean(),
});
export type RangeSummary = z.infer<typeof RangeSummarySchema>;

export const RangesResponseSchema = z.object({
  ranges: z.array(RangeSummarySchema),
  count: z.number().int().nonnegative(),
});
export type RangesResponse = z.infer<typeof RangesResponseSchema>;

export const RangeDetailSchema = RangeSummarySchema.extend({
  description: z.string().nullable(),
  formationNote: z.string().nullable(),
  source: SourceRefSchema.nullable(),
  reviewNotes: z.string().nullable(),
  wikidataQid: z.string().nullable(),
  /** Its counted mountains, highest first (a massif's summits nested). */
  mountains: z.array(MountainSchema),
});
export type RangeDetail = z.infer<typeof RangeDetailSchema>;

export const RangeResponseSchema = z.object({ range: RangeDetailSchema });
export type RangeResponse = z.infer<typeof RangeResponseSchema>;

// ── Export ───────────────────────────────────────────────────────────────────

/** The catalogue as a file: the same filters as /api/mountains, never capped. */
export const MountainsExportQuerySchema = MountainsQuerySchema.extend({
  format: z.enum(EXPORT_FORMATS).default('csv'),
});
export type MountainsExportQuery = z.infer<typeof MountainsExportQuerySchema>;

export const HARIM_STAT_KEYS = [
  'mountains_catalogued',
  'volcanic_mountains',
  'tallest_mountain',
  'lowest_national_high_point',
  'peaks_above_4000',
  'most_mountainous_country',
  'busiest_range',
  'lowest_point',
  'greatest_relief',
  'most_prominent_peak',
] as const;
export const HarimStatKeySchema = z.enum(HARIM_STAT_KEYS);
export type HarimStatKey = z.infer<typeof HarimStatKeySchema>;

// Entities named by the cards (ties are all listed). Each kind links somewhere: a mountain to
// its drawer, a country to its row, a range to its peaks.
const StatAlternativeSchema = z.object({ elevationM: z.number().int(), source: z.string() });
export type StatAlternative = z.infer<typeof StatAlternativeSchema>;

export const StatMountainSchema = z.object({
  kind: z.literal('mountain'),
  slug: z.string(),
  name: z.string(),
  elevationM: z.number().int(),
  /** A massif's highest summit. */
  summitName: z.string().nullable(),
  countries: z.array(z.string().length(3)),
  confidence: ConfidenceSchema,
  needsReview: z.boolean(),
  /** The mountain's other sourced heights. */
  alternatives: z.array(StatAlternativeSchema),
  prominenceM: z.number().int().optional(),
});
export type StatMountain = z.infer<typeof StatMountainSchema>;

const StatCountrySchema = z.object({
  kind: z.literal('country'),
  iso3: z.string().length(3),
  name: z.string(),
});

export const StatHighPointSchema = StatCountrySchema.extend({
  mountain: z.string(),
  mountainName: z.string(),
  elevationM: z.number().int(),
  confidence: ConfidenceSchema,
  needsReview: z.boolean(),
  alternatives: z.array(StatAlternativeSchema),
});
export type StatHighPoint = z.infer<typeof StatHighPointSchema>;

export const StatCountryCountSchema = StatCountrySchema.extend({ count: z.number().int() });
export type StatCountryCount = z.infer<typeof StatCountryCountSchema>;

export const StatRangeSchema = z.object({
  kind: z.literal('range'),
  slug: z.string(),
  name: z.string(),
  count: z.number().int(),
  tallest: z.object({ slug: z.string(), name: z.string(), elevationM: z.number().int() }),
});
export type StatRange = z.infer<typeof StatRangeSchema>;

export const StatLowPointSchema = StatCountrySchema.extend({
  pointName: z.string(),
  elevationM: z.number().int(),
  feature: LowPointFeatureSchema,
  needsReview: z.boolean(),
});
export type StatLowPoint = z.infer<typeof StatLowPointSchema>;

export const StatReliefSchema = StatCountrySchema.extend({
  highestM: z.number().int(),
  highestName: z.string(),
  lowestM: z.number().int(),
  lowestName: z.string(),
});
export type StatRelief = z.infer<typeof StatReliefSchema>;

const count = z.number().int().nonnegative();

const statBase = {
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  definition: z.string(),
  /** null = All Africa; otherwise the region the figures cover. */
  scope: z.enum(REGION_SLUGS).nullable(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};
const noDetail = z.object({}).strict();

/** One card of the statistics band; `detail` and `entities` depend on the card (see docs). */
export const HarimStatSchema = z.discriminatedUnion('key', [
  z.object({
    ...statBase,
    key: z.literal('mountains_catalogued'),
    detail: z.object({ countries: count, territoryPeaks: count }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('volcanic_mountains'),
    detail: z.object({ active: count, dormant: count, extinct: count, unknown: count }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('tallest_mountain'),
    detail: noDetail,
    entities: z.array(StatMountainSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('lowest_national_high_point'),
    detail: noDetail,
    entities: z.array(StatHighPointSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('peaks_above_4000'),
    detail: z.object({
      above5000: count,
      from4000to5000: count,
      from3000to4000: count,
      upTo3000: count,
    }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('most_mountainous_country'),
    detail: noDetail,
    entities: z.array(StatCountryCountSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('busiest_range'),
    detail: noDetail,
    entities: z.array(StatRangeSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('lowest_point'),
    detail: noDetail,
    entities: z.array(StatLowPointSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('greatest_relief'),
    detail: noDetail,
    entities: z.array(StatReliefSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('most_prominent_peak'),
    detail: z.object({ available: z.boolean(), coverage: z.number().nullable() }),
    entities: z.array(StatMountainSchema.required({ prominenceM: true })),
  }),
]);
export type HarimStat = z.infer<typeof HarimStatSchema>;
/** The card for one key. */
export type HarimStatOf<K extends HarimStatKey> = Extract<HarimStat, { key: K }>;

export const HarimStatsResponseSchema = z.object({ stats: z.array(HarimStatSchema) });
export type HarimStatsResponse = z.infer<typeof HarimStatsResponseSchema>;
