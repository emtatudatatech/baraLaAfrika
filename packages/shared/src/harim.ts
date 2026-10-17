import { z } from 'zod';

import { MOUNTAIN_SORTS, VOLCANIC_FILTERS } from './harimConstants.ts';
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

export const HarimStatSchema = z.object({
  key: HarimStatKeySchema,
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  detail: z.record(z.string(), z.unknown()),
  /** Mountains, countries or ranges the card names; ties are all listed. */
  entities: z.array(z.record(z.string(), z.unknown())),
  definition: z.string(),
  /** null = All Africa; otherwise the region the figures cover. */
  scope: z.enum(REGION_SLUGS).nullable(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type HarimStat = z.infer<typeof HarimStatSchema>;

export const HarimStatsResponseSchema = z.object({ stats: z.array(HarimStatSchema) });
export type HarimStatsResponse = z.infer<typeof HarimStatsResponseSchema>;
