import type {
  GoldCountriesQuery,
  GoldCountry,
  GoldPresence,
  GoldPriceResponse,
  GoldStat,
  PriceGranularity,
  RegionSlug,
} from './contract.ts';

import { sortGoldCountries } from './contract.ts';
import type { Db } from './db.ts';
import { type DatasetMeta, flagOf } from './harimQueries.ts';

/* Dhahabu (gold) SQL: parameterised queries over migrations 0007 and 0008. */

export const GOLD_DATASETS = [
  'gold-price',
  'gold-production',
  'gold-official-reserves',
  'gold-trade',
  'gold-presence',
];

interface CountryRow {
  iso3: string;
  iso2: string;
  name: string;
  region_slug: RegionSlug;
  region_name: string;
  region_color_hex: string | null;
  flag_url_template: string;
  presence_tier: GoldPresence['tier'];
  presence_basis: string;
  presence_confidence: GoldPresence['confidence'];
  presence_as_of_year: number | null;
  presence_source_title: string | null;
  presence_source_url: string | null;
  presence_source_tier: NonNullable<GoldPresence['source']>['reliabilityTier'] | null;
  commercial_mining: boolean | null;
  asm_present: boolean | null;
  asm_share_pct_estimate: string | null;
  summary: string;
  needs_review: boolean;
  review_notes: string | null;
  production: GoldCountry['production'];
  exports_reported: GoldCountry['exports']['reported'];
  exports_mirror: GoldCountry['exports']['mirror'];
  imports_reported: GoldCountry['imports']['reported'];
  imports_mirror: GoldCountry['imports']['mirror'];
  holdings: GoldCountry['holdings'];
  export_share: GoldCountry['exportShare'];
  reporting_status: NonNullable<GoldCountry['reporting']>['status'] | null;
  reporting_last_month: string | null;
  reporting_note: string | null;
}

/**
 * Every country (or those matching region, search and presence) with its gold profile and its
 * latest figure per metric in or before `year` (latest available when undefined).
 */
export async function listGoldCountries(
  db: Db,
  query: Pick<GoldCountriesQuery, 'region' | 'q' | 'year' | 'presence' | 'sort'>,
): Promise<GoldCountry[]> {
  const rows = await db.query<CountryRow>(
    `SELECT c.iso3, c.iso2, c.name, g.slug AS region_slug, g.name AS region_name,
            g.color_hex AS region_color_hex, c.flag_url_template,
            p.presence_tier::text AS presence_tier, p.presence_basis,
            p.presence_confidence::text AS presence_confidence, p.presence_as_of_year,
            s.title AS presence_source_title, s.url AS presence_source_url,
            s.reliability_tier::text AS presence_source_tier,
            p.commercial_mining, p.asm_present, p.asm_share_pct_estimate::text, p.summary,
            p.needs_review, p.review_notes,
            m.production, m.exports_reported, m.exports_mirror, m.imports_reported,
            m.imports_mirror, m.holdings, m.export_share,
            r.status::text AS reporting_status, r.last_month::text AS reporting_last_month,
            r.note AS reporting_note
     FROM countries c
     JOIN regions g ON g.id = c.region_id
     JOIN country_gold_profiles p ON p.country_id = c.id
     LEFT JOIN sources s ON s.id = p.presence_source_id
     LEFT JOIN gold_country_metrics($1::int) m ON m.country_id = c.id
     LEFT JOIN gold_reserves_reporting r ON r.country_id = c.id
     WHERE ($2::text IS NULL OR g.slug = $2)
       AND ($3::text IS NULL OR strpos(search_fold(c.name || ' ' || c.iso3), search_fold($3)) > 0)
       AND ($4::text IS NULL OR p.presence_tier::text = $4)`,
    [query.year ?? null, query.region ?? null, query.q ?? null, query.presence ?? null],
  );
  return sortGoldCountries(rows.map(toGoldCountry), query.sort);
}

function toGoldCountry(row: CountryRow): GoldCountry {
  return {
    country: {
      iso3: row.iso3,
      iso2: row.iso2,
      name: row.name,
      region: { slug: row.region_slug, name: row.region_name, colorHex: row.region_color_hex },
      flag: flagOf(row.iso2, row.flag_url_template),
    },
    presence: {
      tier: row.presence_tier,
      basis: row.presence_basis,
      confidence: row.presence_confidence,
      asOfYear: row.presence_as_of_year,
      source:
        row.presence_source_title !== null &&
        row.presence_source_url !== null &&
        row.presence_source_tier !== null
          ? {
              title: row.presence_source_title,
              url: row.presence_source_url,
              reliabilityTier: row.presence_source_tier,
            }
          : null,
      commercialMining: row.commercial_mining,
      asmPresent: row.asm_present,
      asmSharePct: row.asm_share_pct_estimate === null ? null : Number(row.asm_share_pct_estimate),
      summary: row.summary,
      needsReview: row.needs_review,
      reviewNotes: row.review_notes,
    },
    production: row.production,
    exports: { reported: row.exports_reported, mirror: row.exports_mirror },
    imports: { reported: row.imports_reported, mirror: row.imports_mirror },
    holdings: row.holdings,
    reporting:
      row.reporting_status === null || row.reporting_note === null
        ? null
        : {
            status: row.reporting_status,
            lastMonth: row.reporting_last_month,
            note: row.reporting_note,
          },
    exportShare: row.export_share,
  };
}

interface StatRow {
  key: GoldStat['key'];
  label: string;
  value: string | null;
  unit: string;
  as_of: string | null;
  detail: GoldStat['detail'];
  entities: GoldStat['entities'];
  definition: string;
}

/** The summary cards (v_gold_stats); null when the gold data is not loaded. */
export async function getGoldStats(
  db: Db,
  region: RegionSlug | undefined,
  year: number | undefined,
): Promise<GoldStat[] | null> {
  const loaded = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM country_gold_profiles',
  );
  if ((loaded[0]?.n ?? 0) === 0) return null;
  const rows = await db.query<StatRow>(
    `SELECT key, label, value::text, unit, as_of::text, detail, entities, definition
     FROM v_gold_stats($1::text, $2::int) ORDER BY sort_order`,
    [region ?? null, year ?? null],
  );
  // Each card's detail and entities are fixed by v_gold_stats (the API tests validate every
  // card against GoldStatSchema).
  return rows.map(
    (row) =>
      ({
        key: row.key,
        label: row.label,
        value: row.value === null ? null : Number(row.value),
        unit: row.unit,
        asOf: row.as_of,
        detail: row.detail,
        entities: row.entities,
        definition: row.definition,
        scope: region ?? null,
      }) as GoldStat,
  );
}

/** The monthly price, or its annual means, within the years given. */
export async function goldPrice(
  db: Db,
  {
    from,
    to,
    granularity,
  }: { from?: number | undefined; to?: number | undefined; granularity: PriceGranularity },
): Promise<GoldPriceResponse> {
  const [points, source] = await Promise.all([
    granularity === 'month'
      ? db.query<{ period: string; value: string }>(
          `SELECT to_char(month, 'YYYY-MM') AS period, usd_per_troy_oz::text AS value
           FROM gold_price_monthly
           WHERE ($1::int IS NULL OR month >= make_date($1, 1, 1))
             AND ($2::int IS NULL OR month <= make_date($2, 12, 1))
           ORDER BY month`,
          [from ?? null, to ?? null],
        )
      : db.query<{ period: string; value: string; months: number }>(
          `SELECT year::text AS period, round(mean_usd_per_troy_oz, 2)::text AS value, months
           FROM v_gold_price_annual
           WHERE ($1::int IS NULL OR year >= $1) AND ($2::int IS NULL OR year <= $2)
           ORDER BY year`,
          [from ?? null, to ?? null],
        ),
    db.query<{ title: string }>(
      `SELECT s.title FROM gold_price_monthly g JOIN sources s ON s.id = g.source_id
       ORDER BY g.month DESC LIMIT 1`,
    ),
  ]);
  return {
    granularity,
    source: source[0]?.title ?? '',
    points: points.map((p: { period: string; value: string; months?: number }) => ({
      period: p.period,
      usdPerOz: Number(p.value),
      ...(p.months === undefined ? {} : { months: p.months }),
    })),
  };
}

/** The gold datasets behind an export (versions, licences and attributions). */
export async function goldDatasets(db: Db): Promise<DatasetMeta[]> {
  const rows = await db.query<{
    key: string;
    name: string;
    provider: string;
    license: string;
    attribution: string;
    as_of: string;
  }>(
    `SELECT key, name, provider, license, attribution, as_of::text AS as_of
     FROM datasets WHERE key = ANY ($1::text[]) ORDER BY key`,
    [GOLD_DATASETS],
  );
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    provider: row.provider,
    license: row.license,
    attribution: row.attribution,
    asOf: row.as_of,
  }));
}
