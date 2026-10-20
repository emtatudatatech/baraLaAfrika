import { z } from 'zod';

import {
  GOLD_EXPORT_FORMATS,
  GOLD_SERIES_MAX_COUNTRIES,
  GOLD_SERIES_METRICS,
  GOLD_SORTS,
  PRESENCE_TIERS,
  PRICE_GRANULARITIES,
} from './goldConstants.ts';
import { CountryRefSchema } from './harim.ts';
import { REGION_SLUGS } from './regions.ts';
import { ReliabilityTierSchema, RegionSlugSchema } from './schemas.ts';

/*
 * The Dhahabu (gold) API contract. Tonnes are metric tonnes of fine gold; money is nominal US
 * dollars. Every figure carries its own year or date; null means no data (never zero), and a
 * production figure with basis "included_in_other" has null tonnes.
 */

export const PresenceTierSchema = z.enum(PRESENCE_TIERS);
export const GoldConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const ProductionBasisSchema = z.enum(['reported', 'estimate', 'included_in_other']);
export const ValuationSchema = z.enum(['market', 'national', 'computed']);
export const ReportingStatusSchema = z.enum(['current', 'late', 'stale', 'pooled', 'none']);

export type ProductionBasis = z.infer<typeof ProductionBasisSchema>;
export type ReportingStatus = z.infer<typeof ReportingStatusSchema>;

// ── Requests ─────────────────────────────────────────────────────────────────

const searchText = z
  .string()
  .trim()
  .max(80)
  .transform((value) => (value === '' ? undefined : value))
  .optional();
const Year = z.coerce.number().int().min(1900).max(2100);

export const GoldCountriesQuerySchema = z.object({
  region: RegionSlugSchema.optional(),
  q: searchText,
  /** The reference year: each metric's latest value in or before it (omit for latest). */
  year: Year.optional(),
  presence: PresenceTierSchema.optional(),
  sort: z.enum(GOLD_SORTS).default('production'),
});
export type GoldCountriesQuery = z.infer<typeof GoldCountriesQuerySchema>;

export const GoldStatsQuerySchema = z.object({
  region: RegionSlugSchema.optional(),
  year: Year.optional(),
});

export const GoldExportQuerySchema = GoldCountriesQuerySchema.extend({
  format: z.enum(GOLD_EXPORT_FORMATS).default('csv'),
});
export type GoldExportQuery = z.infer<typeof GoldExportQuerySchema>;

export const GoldPriceQuerySchema = z
  .object({
    from: Year.optional(),
    to: Year.optional(),
    granularity: z.enum(PRICE_GRANULARITIES).default('month'),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
  });

/** `KEN,TZA` → ['KEN', 'TZA'] (upper-cased, de-duplicated). */
const Iso3List = z
  .string()
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code !== ''),
    ),
  ])
  .pipe(
    z
      .array(z.string().regex(/^[A-Z]{3}$/))
      .min(1)
      .max(GOLD_SERIES_MAX_COUNTRIES),
  );

const fromBeforeTo = (q: { from?: number | undefined; to?: number | undefined }) =>
  q.from === undefined || q.to === undefined || q.from <= q.to;

export const GoldSeriesQuerySchema = z
  .object({
    metric: z.enum(GOLD_SERIES_METRICS),
    /** Countries to return (omit for all, within `region`). */
    countries: Iso3List.optional(),
    region: RegionSlugSchema.optional(),
    from: Year.optional(),
    to: Year.optional(),
    /** Holdings can be monthly; production and trade are annual. */
    granularity: z.enum(PRICE_GRANULARITIES).default('year'),
  })
  .refine(fromBeforeTo, { message: 'from must not be after to' });
export type GoldSeriesQuery = z.infer<typeof GoldSeriesQuerySchema>;

export const GoldHoldingsChangeQuerySchema = z
  .object({
    countries: Iso3List.optional(),
    from: Year.optional(),
    to: Year.optional(),
  })
  .refine(fromBeforeTo, { message: 'from must not be after to' });
export type GoldHoldingsChangeQuery = z.infer<typeof GoldHoldingsChangeQuerySchema>;

export const GoldCountryQuerySchema = z.object({ year: Year.optional() });

// ── Responses ────────────────────────────────────────────────────────────────

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GoldProductionSchema = z.object({
  year: z.number().int(),
  /** Null only when the source lumps the country into "other countries". */
  tonnes: z.number().nullable(),
  basis: ProductionBasisSchema,
  /** Computed (tonnes × the year's average price); null until the year's prices are complete. */
  valueUsd: z.number().nullable(),
  priceUsdPerOz: z.number().nullable(),
  source: z.string(),
  notes: z.string().nullable(),
});
export type GoldProduction = z.infer<typeof GoldProductionSchema>;

export const GoldTradeFigureSchema = z.object({
  year: z.number().int(),
  valueUsd: z.number(),
  netWeightKg: z.number().nullable(),
  /** Mirror figures: how many partners' reports are summed. */
  partnerCount: z.number().int().nullable(),
  notes: z.string().nullable(),
});
export type GoldTradeFigure = z.infer<typeof GoldTradeFigureSchema>;

export const GoldFlowSchema = z.object({
  reported: GoldTradeFigureSchema.nullable(),
  mirror: GoldTradeFigureSchema.nullable(),
});
export type GoldFlow = z.infer<typeof GoldFlowSchema>;

export const GoldHoldingSchema = z.object({
  asOf: IsoDate,
  tonnes: z.number(),
  valueUsd: z.number(),
  pctOfReserves: z.number().nullable(),
  valuation: ValuationSchema,
  change12mTonnes: z.number().nullable(),
  change12mValueUsd: z.number().nullable(),
});
export type GoldHolding = z.infer<typeof GoldHoldingSchema>;

export const GoldReportingSchema = z.object({
  status: ReportingStatusSchema,
  lastMonth: IsoDate.nullable(),
  note: z.string(),
});
export type GoldReporting = z.infer<typeof GoldReportingSchema>;

export const GoldExportShareSchema = z.object({
  year: z.number().int(),
  /** Null when the reported gold exports exceed the reported total (inconsistent data). */
  pct: z.number().nullable(),
  exceedsTotal: z.boolean(),
  goldUsd: z.number(),
  totalUsd: z.number(),
});
export type GoldExportShare = z.infer<typeof GoldExportShareSchema>;

export const GoldSourceRefSchema = z.object({
  title: z.string(),
  url: z.url(),
  reliabilityTier: ReliabilityTierSchema,
});
export type GoldSourceRef = z.infer<typeof GoldSourceRefSchema>;

export const GoldPresenceSchema = z.object({
  tier: PresenceTierSchema,
  basis: z.string(),
  confidence: GoldConfidenceSchema,
  asOfYear: z.number().int().nullable(),
  source: GoldSourceRefSchema.nullable(),
  commercialMining: z.boolean().nullable(),
  asmPresent: z.boolean().nullable(),
  asmSharePct: z.number().nullable(),
  summary: z.string(),
  needsReview: z.boolean(),
  reviewNotes: z.string().nullable(),
});
export type GoldPresence = z.infer<typeof GoldPresenceSchema>;

export const GoldCountrySchema = z.object({
  country: CountryRefSchema,
  presence: GoldPresenceSchema,
  production: GoldProductionSchema.nullable(),
  exports: GoldFlowSchema,
  imports: GoldFlowSchema,
  holdings: GoldHoldingSchema.nullable(),
  reporting: GoldReportingSchema.nullable(),
  exportShare: GoldExportShareSchema.nullable(),
});
export type GoldCountry = z.infer<typeof GoldCountrySchema>;

export const GoldCountriesResponseSchema = z.object({
  /** The reference year asked for; null = latest available. */
  year: z.number().int().nullable(),
  countries: z.array(GoldCountrySchema),
});
export type GoldCountriesResponse = z.infer<typeof GoldCountriesResponseSchema>;

// ── Statistics band ──────────────────────────────────────────────────────────

const count = z.number().int().nonnegative();
const StatCountry = z.object({
  kind: z.literal('country'),
  iso3: z.string().length(3),
  name: z.string(),
});

export const GoldStatProducerSchema = StatCountry.extend({
  tonnes: z.number(),
  estimate: z.boolean(),
});
export const GoldStatHolderSchema = StatCountry.extend({
  tonnes: z.number(),
  valueUsd: z.number(),
  pctOfReserves: z.number().nullable(),
  asOf: IsoDate,
});
export const GoldStatShareSchema = StatCountry.extend({
  pct: z.number(),
  year: z.number().int(),
  goldUsd: z.number(),
  totalUsd: z.number(),
});
export const GoldStatGapSchema = StatCountry.extend({
  year: z.number().int(),
  gapUsd: z.number(),
  reportedUsd: z.number(),
  mirrorUsd: z.number(),
  partnerCount: z.number().int().nullable(),
});
export const GoldStatBuyerSchema = StatCountry.extend({ changeTonnes: z.number(), asOf: IsoDate });

export type GoldStatProducer = z.infer<typeof GoldStatProducerSchema>;
export type GoldStatHolder = z.infer<typeof GoldStatHolderSchema>;
export type GoldStatShare = z.infer<typeof GoldStatShareSchema>;
export type GoldStatGap = z.infer<typeof GoldStatGapSchema>;
export type GoldStatBuyer = z.infer<typeof GoldStatBuyerSchema>;

const statBase = {
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  definition: z.string(),
  /** null = All Africa; otherwise the region the figures cover. */
  scope: z.enum(REGION_SLUGS).nullable(),
  /** The date the figure refers to (a year's end, or a month's end); null when not dated. */
  asOf: IsoDate.nullable(),
};
const noDetail = z.object({}).strict();
const Year4 = z.number().int().nullable();

export const GoldStatSchema = z.discriminatedUnion('key', [
  z.object({
    ...statBase,
    key: z.literal('gold_producing_countries'),
    detail: z.object({
      majorProducer: count,
      producer: count,
      occurrencesKnown: count,
      noneIdentified: count,
      unknown: count,
      countries: count,
    }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('africa_production'),
    detail: z.object({
      year: Year4,
      countries: count.nullable(),
      missingCountries: count.nullable(),
      worldTonnes: z.number().nullable(),
      worldSharePct: z.number().nullable(),
      previousYear: Year4,
      changeTonnes: z.number().nullable(),
      changePct: z.number().nullable(),
      newestYear: Year4,
    }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('production_value'),
    detail: z.object({
      year: Year4,
      priceUsdPerOz: z.number().nullable(),
      computed: z.literal(true),
    }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('largest_producer'),
    detail: z.object({ year: Year4, sharePct: z.number().nullable() }),
    entities: z.array(GoldStatProducerSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('central_bank_gold'),
    detail: z.object({
      valueUsd: z.number().nullable(),
      priceUsdPerOz: z.number().nullable(),
      reporting: count,
      notCurrent: count,
    }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('largest_holder'),
    detail: noDetail,
    entities: z.array(GoldStatHolderSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('gold_price'),
    detail: z.object({
      month: IsoDate.nullable(),
      yearAgoUsdPerOz: z.number().nullable(),
      changePct: z.number().nullable(),
    }),
    entities: z.array(z.never()),
  }),
  z.object({
    ...statBase,
    key: z.literal('most_gold_dependent'),
    detail: noDetail,
    entities: z.array(GoldStatShareSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('biggest_reporting_gap'),
    detail: noDetail,
    entities: z.array(GoldStatGapSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('largest_net_buyer'),
    detail: z.object({ noNetBuyer: z.boolean() }),
    entities: z.array(GoldStatBuyerSchema),
  }),
  z.object({
    ...statBase,
    key: z.literal('price_effect'),
    detail: z.object({
      changeUsd: z.number().nullable(),
      priceEffectUsd: z.number().nullable(),
      volumeEffectUsd: z.number().nullable(),
      valueFromUsd: z.number().nullable(),
      valueToUsd: z.number().nullable(),
      tonnesChange: z.number().nullable(),
      countries: count.nullable(),
    }),
    entities: z.array(z.never()),
  }),
]);
export type GoldStat = z.infer<typeof GoldStatSchema>;

export const GoldStatsResponseSchema = z.object({
  /** The reference year asked for; null = latest available. */
  year: z.number().int().nullable(),
  stats: z.array(GoldStatSchema),
});
export type GoldStatsResponse = z.infer<typeof GoldStatsResponseSchema>;

export const GoldPricePointSchema = z.object({
  /** `2026-09` for months, `2026` for years. */
  period: z.string(),
  usdPerOz: z.number(),
  /** For years: how many monthly averages the mean covers (12 when complete). */
  months: z.number().int().optional(),
});
export const GoldPriceResponseSchema = z.object({
  granularity: z.enum(PRICE_GRANULARITIES),
  source: z.string(),
  points: z.array(GoldPricePointSchema),
});
export type GoldPriceResponse = z.infer<typeof GoldPriceResponseSchema>;

// ── Chart series ─────────────────────────────────────────────────────────────

export const GoldSeriesPointSchema = z.object({
  /** `2021` for years, `2021-09` for months. */
  period: z.string(),
  /** Tonnes or US dollars; null when the source lumps the country into "other countries". */
  value: z.number().nullable(),
  /** Production: reported, estimate or included_in_other; trade: reported or mirror. */
  basis: z.string().nullable(),
  /** Production only: the computed value at the year's average price (null until complete). */
  valueUsd: z.number().nullable(),
});
export type GoldSeriesPoint = z.infer<typeof GoldSeriesPointSchema>;

export const GoldSeriesSchema = z.object({
  country: z.object({ iso3: z.string().length(3), name: z.string(), region: RegionSlugSchema }),
  points: z.array(GoldSeriesPointSchema),
});
export type GoldSeries = z.infer<typeof GoldSeriesSchema>;

export const GoldProductionTotalSchema = z.object({
  year: z.number().int(),
  tonnes: z.number(),
  countries: count,
  /** What producers without a figure that year would add (their nearest figure, ±3 years). */
  missingTonnes: z.number(),
  missingCountries: count,
  /** At most 5% missing: a total that can be compared. */
  complete: z.boolean(),
});
export type GoldProductionTotal = z.infer<typeof GoldProductionTotalSchema>;

export const GoldSeriesResponseSchema = z.object({
  metric: z.enum(GOLD_SERIES_METRICS),
  unit: z.enum(['t', 'USD']),
  granularity: z.enum(PRICE_GRANULARITIES),
  series: z.array(GoldSeriesSchema),
  /** Production: Africa's (or the region's) total per year, with its completeness. */
  totals: z.array(GoldProductionTotalSchema).nullable(),
  /** True when the request asked for more points than the cap and was cut (latest kept). */
  capped: z.boolean(),
});
export type GoldSeriesResponse = z.infer<typeof GoldSeriesResponseSchema>;

// ── Price effect versus volume effect ───────────────────────────────────────

export const GoldHoldingsChangeSchema = z.object({
  country: z.object({ iso3: z.string().length(3), name: z.string() }),
  fromMonth: IsoDate,
  toMonth: IsoDate,
  tonnesFrom: z.number(),
  tonnesTo: z.number(),
  priceFrom: z.number().nullable(),
  priceTo: z.number().nullable(),
  valueFromUsd: z.number(),
  valueToUsd: z.number(),
  changeUsd: z.number(),
  /** The two effects sum exactly to changeUsd; null when a month's price is missing. */
  priceEffectUsd: z.number().nullable(),
  volumeEffectUsd: z.number().nullable(),
});
export type GoldHoldingsChange = z.infer<typeof GoldHoldingsChangeSchema>;

export const GoldHoldingsChangeResponseSchema = z.object({
  changes: z.array(GoldHoldingsChangeSchema),
});
export type GoldHoldingsChangeResponse = z.infer<typeof GoldHoldingsChangeResponseSchema>;

// ── One country (the drawer) ─────────────────────────────────────────────────

const SourceLinkSchema = z.object({
  title: z.string(),
  url: z.url(),
  reliabilityTier: ReliabilityTierSchema,
});

export const GoldTradeYearSchema = z.object({
  year: z.number().int(),
  exportsReported: GoldTradeFigureSchema.nullable(),
  exportsMirror: GoldTradeFigureSchema.nullable(),
  importsReported: GoldTradeFigureSchema.nullable(),
  importsMirror: GoldTradeFigureSchema.nullable(),
});
export type GoldTradeYear = z.infer<typeof GoldTradeYearSchema>;

export const GoldPartnerSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  iso3: z.string().length(3).nullable(),
  valueUsd: z.number(),
  netWeightKg: z.number().nullable(),
});

export const GoldCountryDetailSchema = z.object({
  /** The table's row for the reference year (latest available without one). */
  row: GoldCountrySchema,
  artisanalSource: SourceLinkSchema.nullable(),
  production: z.array(
    z.object({
      year: z.number().int(),
      tonnes: z.number().nullable(),
      basis: ProductionBasisSchema,
      valueUsd: z.number().nullable(),
      priceUsdPerOz: z.number().nullable(),
      source: z.string(),
      notes: z.string().nullable(),
    }),
  ),
  trade: z.array(GoldTradeYearSchema),
  /** The top partners for the latest year with a breakdown of the country's gold exports. */
  partners: z
    .object({
      year: z.number().int(),
      reported: z.array(GoldPartnerSchema),
      mirror: z.array(GoldPartnerSchema),
    })
    .nullable(),
  /** Each year's last reported month. */
  holdings: z.array(
    z.object({
      asOf: IsoDate,
      tonnes: z.number(),
      valueUsd: z.number(),
      pctOfReserves: z.number().nullable(),
    }),
  ),
  /** Geological reserves: a different thing from central bank holdings. */
  inground: z.array(
    z.object({
      year: z.number().int(),
      tonnes: z.number(),
      definition: z.string(),
      source: z.string(),
    }),
  ),
  /** The latest monthly price, for the illustrative value of in-ground reserves. */
  latestPrice: z.object({ month: IsoDate, usdPerOz: z.number() }).nullable(),
  notes: z.array(
    z.object({
      note: z.string(),
      asOf: IsoDate,
      source: SourceLinkSchema,
      needsReview: z.boolean(),
      reviewNotes: z.string().nullable(),
    }),
  ),
  /** Every source behind the drawer, with what it supports. */
  sources: z.array(SourceLinkSchema.extend({ usedFor: z.array(z.string()) })),
});
export type GoldCountryDetail = z.infer<typeof GoldCountryDetailSchema>;

export const GoldCountryResponseSchema = z.object({
  year: z.number().int().nullable(),
  country: GoldCountryDetailSchema,
});
export type GoldCountryResponse = z.infer<typeof GoldCountryResponseSchema>;
