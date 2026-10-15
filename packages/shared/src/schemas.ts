import { z } from 'zod';

import { DATASET_KEYS } from './datasets.ts';
import { REGION_SLUGS } from './regions.ts';

/*
 * The API contract shared by the Netlify Functions (which validate their input and are tested
 * against these response schemas) and the web app (which uses the inferred types).
 */

// ── Enumerations ─────────────────────────────────────────────────────────────

export const RegionSlugSchema = z.enum(REGION_SLUGS);
export const DatasetKeySchema = z.enum(DATASET_KEYS);
export const AnimalStatusSchema = z.enum([
  'official',
  'de_facto',
  'inferred',
  'sports_nickname',
  'contested',
]);
export const EtymologyCategorySchema = z.enum([
  'geographic_feature',
  'ethnic_group',
  'kingdom_or_ruler',
  'colonial_or_translation',
]);
export const ReliabilityTierSchema = z.enum(['primary', 'reference', 'secondary', 'low']);
export const ProfileFieldSchema = z.enum([
  'etymology',
  'flag_design',
  'national_symbol',
  'national_animal',
]);
export const RefreshCadenceSchema = z.enum([
  'static',
  'manual',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'on_release',
]);

export type AnimalStatus = z.infer<typeof AnimalStatusSchema>;
export type EtymologyCategory = z.infer<typeof EtymologyCategorySchema>;
export type ReliabilityTier = z.infer<typeof ReliabilityTierSchema>;
export type ProfileField = z.infer<typeof ProfileFieldSchema>;

const HexColourSchema = z.string().regex(/^#[0-9a-f]{6}$/);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── Requests ─────────────────────────────────────────────────────────────────

const optionalText = z
  .string()
  .trim()
  .max(80)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const CountriesQuerySchema = z.object({
  region: RegionSlugSchema.optional(),
  q: optionalText,
});
export type CountriesQuery = z.infer<typeof CountriesQuerySchema>;

export const Iso3ParamSchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Expected a three-letter ISO 3166-1 alpha-3 code')
  .transform((value) => value.toUpperCase());

export const CoverageQuerySchema = z.object({
  datasets: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : [
            ...new Set(
              value
                .split(',')
                .map((key) => key.trim())
                .filter(Boolean),
            ),
          ],
    )
    .pipe(z.array(DatasetKeySchema).min(1).max(DATASET_KEYS.length).optional()),
});
export type CoverageQuery = z.infer<typeof CoverageQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const RegionSchema = z.object({
  slug: RegionSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Approved region identity colour; null until approved. */
  colorHex: HexColourSchema.nullable(),
  sortOrder: z.number().int(),
  countryCount: z.number().int().nonnegative(),
});
export type Region = z.infer<typeof RegionSchema>;

export const RegionsResponseSchema = z.object({ regions: z.array(RegionSchema) });
export type RegionsResponse = z.infer<typeof RegionsResponseSchema>;

export const FlagSchema = z.object({
  /** Flagpedia SVG (flagcdn.com). */
  svgUrl: z.url(),
  /** Flagpedia PNG with a {width} placeholder (w20, w40, w80, w160, w320, w640…). */
  pngUrlTemplate: z.string(),
  /** Self-hosted copy used when the CDN fails. */
  fallbackUrl: z.string().startsWith('/flags/'),
});
export type Flag = z.infer<typeof FlagSchema>;

export const CountrySummarySchema = z.object({
  iso3: z.string().length(3),
  iso2: z.string().length(2),
  name: z.string(),
  officialName: z.string().nullable(),
  region: z.object({
    slug: RegionSlugSchema,
    name: z.string(),
    colorHex: HexColourSchema.nullable(),
  }),
  flag: FlagSchema,
  centroid: z.object({ lon: z.number(), lat: z.number() }).nullable(),
  isMicrostateMarker: z.boolean(),
  etymologySummary: z.string(),
  etymologyCategory: EtymologyCategorySchema.nullable(),
  flagDesignSummary: z.string(),
  flagDesignDetail: z.string().nullable(),
  nationalSymbolSummary: z.string(),
  nationalAnimalName: z.string(),
  animalStatus: AnimalStatusSchema,
  needsReview: z.boolean(),
});
export type CountrySummary = z.infer<typeof CountrySummarySchema>;

export const CountriesResponseSchema = z.object({
  countries: z.array(CountrySummarySchema),
  count: z.number().int().nonnegative(),
});
export type CountriesResponse = z.infer<typeof CountriesResponseSchema>;

export const SourceSchema = z.object({
  key: z.string(),
  refNo: z.number().int().positive().nullable(),
  title: z.string(),
  url: z.url(),
  sourceType: z.string(),
  reliabilityTier: ReliabilityTierSchema,
  fields: z.array(ProfileFieldSchema),
});
export type Source = z.infer<typeof SourceSchema>;

export const CountryDetailSchema = CountrySummarySchema.extend({
  etymologyDetail: z.string().nullable(),
  nationalSymbolDetail: z.string().nullable(),
  nationalAnimalScientific: z.string().nullable(),
  nationalAnimalDetail: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  sources: z.array(SourceSchema),
});
export type CountryDetail = z.infer<typeof CountryDetailSchema>;

export const CountryResponseSchema = z.object({ country: CountryDetailSchema });
export type CountryResponse = z.infer<typeof CountryResponseSchema>;

export const CoverageDatasetSchema = z.object({
  key: DatasetKeySchema,
  name: z.string(),
  provider: z.string(),
  license: z.string(),
  attribution: z.string(),
  coverageStart: IsoDateSchema.nullable(),
  coverageEnd: IsoDateSchema.nullable(),
  asOf: IsoDateSchema,
  lastRefreshedAt: z.iso.datetime({ offset: true }).nullable(),
  refreshCadence: RefreshCadenceSchema,
});
export type CoverageDataset = z.infer<typeof CoverageDatasetSchema>;

export const CoverageResponseSchema = z.object({
  datasets: z.array(CoverageDatasetSchema),
  /** Requested keys with no row yet (dataset not loaded). */
  missing: z.array(DatasetKeySchema),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;
