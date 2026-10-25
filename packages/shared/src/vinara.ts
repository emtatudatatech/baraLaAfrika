import { z } from 'zod';

import { RegionSlugSchema } from './schemas.ts';

/*
 * The Vinara API contract: for each metric, the cardinal (the leading state) and the silent
 * contender (the runner-up) for Africa or one region, whether the lead is narrowing, and the
 * regions compared. Every value is computed in the database (migration 0015); the definitions
 * are docs/vinara-method.md word for word. Values are rounded to the metric's precision; ties
 * are all named, never broken.
 */

export const VINARA_METRICS = [
  'population',
  'land_area',
  'gdp_usd',
  'gdp_ppp',
  'gdp_per_capita_ppp',
  'gdp_growth',
  'inflation',
  'government_debt',
  'gni_usd',
  'currency_performance',
  'currency_stability',
  'military_usd',
  'hdi',
] as const;
export type VinaraMetricKey = (typeof VINARA_METRICS)[number];
export const VinaraMetricKeySchema = z.enum(VINARA_METRICS);

export const VINARA_SIGNALS = ['gap_closing', 'lead_holding', 'not_enough_data'] as const;
export type VinaraSignal = (typeof VINARA_SIGNALS)[number];

const Year = z.coerce.number().int().min(1960).max(2100);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const VinaraQuerySchema = z
  .object({
    region: RegionSlugSchema.optional(),
    from: Year.optional(),
    to: Year.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: '`from` must not be after `to`',
  });
export type VinaraQuery = z.infer<typeof VinaraQuerySchema>;

export const VinaraWindowSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  /** The metric's default window (the last ten complete years), not a range asked for. */
  isDefault: z.boolean(),
});
export type VinaraWindow = z.infer<typeof VinaraWindowSchema>;

export const VinaraEntitySchema = z.object({
  iso3: z.string().length(3),
  name: z.string(),
  region: RegionSlugSchema,
  value: z.number(),
  /** The year the value refers to (for a mean or a change: the window's last year). */
  year: z.number().int(),
  /** An IMF estimate rather than a reported figure. */
  estimate: z.boolean(),
});
export type VinaraEntity = z.infer<typeof VinaraEntitySchema>;

export const VinaraUnrankedSchema = z.object({
  iso3: z.string().length(3),
  name: z.string(),
  reason: z.string(),
});

export const VinaraRegionValueSchema = z.object({
  slug: RegionSlugSchema,
  name: z.string(),
  value: z.number().nullable(),
  /** The median over the region's states. */
  median: z.number().nullable(),
  /** Share of the region (by population or GDP) the figure covers, 0 to 1. */
  coverage: z.number(),
  /** Below 90% coverage: shown, not ranked. */
  partial: z.boolean(),
  rank: z.number().int().nullable(),
});
export type VinaraRegionValue = z.infer<typeof VinaraRegionValueSchema>;

const RegionRefSchema = z.object({ slug: RegionSlugSchema, name: z.string(), value: z.number() });

export const VinaraMetricSchema = z.object({
  key: VinaraMetricKeySchema,
  name: z.string(),
  unit: z.string(),
  decimals: z.number().int(),
  /** max: the largest leads; min: the smallest leads. */
  direction: z.enum(['max', 'min']),
  kind: z.enum(['level', 'rate']),
  definition: z.string(),
  window: VinaraWindowSchema,
  cardinals: z.array(VinaraEntitySchema),
  contenders: z.array(VinaraEntitySchema),
  /** Null when the cardinal or the contender is a tie (the signal compares two states). */
  signal: z.enum(VINARA_SIGNALS).nullable(),
  /** The contender did better than the cardinal in the window's last year. */
  contenderLeadsLatest: z.boolean(),
  ranked: z.number().int().nonnegative(),
  unranked: z.array(VinaraUnrankedSchema),
  /** Africa only (null for a region): the regions compared. */
  regions: z
    .object({
      cardinals: z.array(RegionRefSchema),
      contenders: z.array(RegionRefSchema),
      values: z.array(VinaraRegionValueSchema),
    })
    .nullable(),
});
export type VinaraMetric = z.infer<typeof VinaraMetricSchema>;

export const VinaraResponseSchema = z.object({
  region: RegionSlugSchema.nullable(),
  metrics: z.array(VinaraMetricSchema),
});
export type VinaraResponse = z.infer<typeof VinaraResponseSchema>;

export const VinaraRankedSchema = VinaraEntitySchema.extend({ rank: z.number().int() });

export const VinaraSeriesSchema = z.object({
  iso3: z.string().length(3),
  role: z.enum(['cardinal', 'contender']),
  points: z.array(z.object({ year: z.number().int(), value: z.number(), estimate: z.boolean() })),
});

export const VinaraMetricResponseSchema = z.object({
  region: RegionSlugSchema.nullable(),
  metric: VinaraMetricSchema.omit({ regions: true }),
  /** Every state with a value, best first. */
  ranking: z.array(VinaraRankedSchema),
  /** Africa only: each region's figure. */
  regions: z.array(VinaraRegionValueSchema).nullable(),
  /** The cardinal's and the contender's yearly values over the window (for charts). */
  series: z.array(VinaraSeriesSchema),
});
export type VinaraMetricResponse = z.infer<typeof VinaraMetricResponseSchema>;

/** One measure for one state: its value over the window and its rank in Africa and its region. */
export const VinaraCountryMeasureSchema = z.object({
  key: VinaraMetricKeySchema,
  name: z.string(),
  unit: z.string(),
  decimals: z.number().int(),
  kind: z.enum(['level', 'rate']),
  window: VinaraWindowSchema,
  /** Null when the state takes no part (see `unrankedReason`). */
  value: z.number().nullable(),
  year: z.number().int().nullable(),
  estimate: z.boolean(),
  rankAfrica: z.number().int().nullable(),
  rankedAfrica: z.number().int().nonnegative(),
  rankRegion: z.number().int().nullable(),
  rankedRegion: z.number().int().nonnegative(),
  unrankedReason: z.string().nullable(),
});
export type VinaraCountryMeasure = z.infer<typeof VinaraCountryMeasureSchema>;

/** A figure shown for context and not ranked (population growth, external debt…): its latest. */
export const VinaraContextFigureSchema = z.object({
  key: z.string(),
  name: z.string(),
  unit: z.string(),
  decimals: z.number().int(),
  value: z.number(),
  year: z.number().int(),
  estimate: z.boolean(),
});
export type VinaraContextFigure = z.infer<typeof VinaraContextFigureSchema>;

export const CREDITOR_KINDS = [
  'multilateral',
  'bilateral',
  'bondholders',
  'commercial_banks',
  'other_private',
] as const;

export const VinaraCreditorSchema = z.object({
  kind: z.enum(CREDITOR_KINDS),
  name: z.string(),
  amountUsd: z.number(),
  /** Share of the public external debt owed that year, 0 to 100. */
  sharePct: z.number(),
});
export type VinaraCreditor = z.infer<typeof VinaraCreditorSchema>;

export const VinaraCurrencySchema = z.object({
  code: z.string().length(3),
  unionName: z.string().nullable(),
  peg: z.object({ anchor: z.string().length(3), parity: z.number(), since: IsoDate }).nullable(),
  /** Official daily rates, where the state has a source usable without permission. */
  daily: z
    .object({
      basis: z.enum(['ecb', 'derived', 'bis', 'central_bank']),
      source: z.string(),
      url: z.string(),
      first: IsoDate,
      last: IsoDate,
    })
    .nullable(),
  /** The IMF's monthly series: how recent it is. */
  monthly: z
    .object({
      status: z.enum(['current', 'late', 'stale', 'none']),
      lastMonth: IsoDate.nullable(),
    })
    .nullable(),
});
export type VinaraCurrency = z.infer<typeof VinaraCurrencySchema>;

export const VinaraCountryResponseSchema = z.object({
  country: z.object({
    iso3: z.string().length(3),
    name: z.string(),
    region: z.object({ slug: RegionSlugSchema, name: z.string() }),
  }),
  measures: z.array(VinaraCountryMeasureSchema),
  context: z.array(VinaraContextFigureSchema),
  /** Public external debt by creditor in its latest year (null outside the World Bank's IDS). */
  debt: z
    .object({
      year: z.number().int(),
      totalUsd: z.number(),
      creditors: z.array(VinaraCreditorSchema),
      /** Creditors beyond those listed, summed. */
      othersUsd: z.number(),
    })
    .nullable(),
  currency: VinaraCurrencySchema.nullable(),
});
export type VinaraCountryResponse = z.infer<typeof VinaraCountryResponseSchema>;

export const VinaraExportQuerySchema = z
  .object({
    format: z.literal('csv').default('csv'),
    region: RegionSlugSchema.optional(),
    from: Year.optional(),
    to: Year.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: '`from` must not be after `to`',
  });
export type VinaraExportQuery = z.infer<typeof VinaraExportQuerySchema>;
