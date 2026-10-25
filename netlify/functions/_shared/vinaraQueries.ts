import type {
  RegionSlug,
  VinaraCountryResponse,
  VinaraCreditor,
  VinaraEntity,
  VinaraMetric,
  VinaraMetricKey,
  VinaraMetricResponse,
  VinaraRegionValue,
  VinaraResponse,
} from './contract.ts';

import type { Db } from './db.ts';
import type { DatasetMeta } from './harimQueries.ts';

/*
 * Vinara: every rule is computed by the SQL functions of migration 0015 (vinara_summary,
 * vinara_rankings, vinara_region_values, vinara_window, vinara_country_years); this layer only
 * shapes their rows. Parameterised queries only.
 */

interface MetricRow {
  key: VinaraMetricKey;
  name: string;
  unit: string;
  decimals: number;
  direction: 'max' | 'min';
  kind: 'level' | 'rate';
  definition: string;
}

type Json<T> = T | string;

interface SummaryRow extends MetricRow {
  from_year: number;
  to_year: number;
  is_default: boolean;
  cardinals: Json<RawEntity[]>;
  contenders: Json<RawEntity[]>;
  signal: VinaraMetric['signal'];
  contender_leads_latest: boolean;
  ranked: number;
  unranked: Json<{ iso3: string; name: string; reason: string }[]>;
  region_cardinals: Json<RawRegionRef[]> | null;
  region_contenders: Json<RawRegionRef[]> | null;
  regions: Json<RawRegionValue[]> | null;
}

interface RawEntity {
  iso3: string;
  name: string;
  region: RegionSlug;
  value: number | string;
  year: number;
  estimate: boolean;
}

interface RawRegionRef {
  slug: RegionSlug;
  name: string;
  value: number | string;
}

interface RawRegionValue {
  slug: RegionSlug;
  name: string;
  value: number | string | null;
  median: number | string | null;
  coverage: number | string;
  partial: boolean;
  rank: number | null;
}

/** node-postgres parses jsonb; the Neon HTTP driver may hand it over as text. */
function json<T>(value: Json<T>): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function num(value: number | string): number {
  return Number(value);
}

function numOrNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function entity(raw: RawEntity): VinaraEntity {
  return { ...raw, value: num(raw.value) };
}

function regionValue(raw: RawRegionValue): VinaraRegionValue {
  return {
    slug: raw.slug,
    name: raw.name,
    value: numOrNull(raw.value),
    median: numOrNull(raw.median),
    coverage: num(raw.coverage),
    partial: raw.partial,
    rank: raw.rank,
  };
}

function regionRef(raw: RawRegionRef) {
  return { slug: raw.slug, name: raw.name, value: num(raw.value) };
}

function metric(row: SummaryRow): VinaraMetric {
  return {
    key: row.key,
    name: row.name,
    unit: row.unit,
    decimals: row.decimals,
    direction: row.direction,
    kind: row.kind,
    definition: row.definition,
    window: { from: row.from_year, to: row.to_year, isDefault: row.is_default },
    cardinals: json(row.cardinals).map(entity),
    contenders: json(row.contenders).map(entity),
    signal: row.signal,
    contenderLeadsLatest: row.contender_leads_latest,
    ranked: row.ranked,
    unranked: json(row.unranked),
    regions:
      row.regions === null || row.region_cardinals === null || row.region_contenders === null
        ? null
        : {
            cardinals: json(row.region_cardinals).map(regionRef),
            contenders: json(row.region_contenders).map(regionRef),
            values: json(row.regions).map(regionValue),
          },
  };
}

const METRIC_COLUMNS = `m.key, m.name, m.unit, m.decimals, m.direction, m.kind, m.definition`;

/** True when the indicator data has been loaded (Vinara has nothing to rank before). */
async function loaded(db: Db): Promise<boolean> {
  const [row] = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM (SELECT 1 FROM indicator_observations LIMIT 1) x',
  );
  return (row?.n ?? 0) > 0;
}

export async function getVinara(
  db: Db,
  region: RegionSlug | undefined,
  from: number | undefined,
  to: number | undefined,
  only?: VinaraMetricKey,
): Promise<VinaraResponse | null> {
  if (!(await loaded(db))) return null;
  const rows = await db.query<SummaryRow>(
    `SELECT ${METRIC_COLUMNS}, s.from_year, s.to_year, s.is_default, s.cardinals, s.contenders,
            s.signal, s.contender_leads_latest, s.ranked, s.unranked, s.region_cardinals,
            s.region_contenders, s.regions
     FROM vinara_summary($1, $2, $3, $4) s JOIN vinara_metrics m ON m.key = s.metric
     ORDER BY m.sort_order`,
    [region ?? null, from ?? null, to ?? null, only ?? null],
  );
  return { region: region ?? null, metrics: rows.map(metric) };
}

interface RankedRow {
  iso3: string;
  name: string;
  region: RegionSlug;
  value: string | number;
  year: number;
  estimate: boolean;
  rank: number;
}

interface SeriesRow {
  iso3: string;
  year: number;
  value: string | number;
  estimate: boolean;
}

export async function getVinaraMetric(
  db: Db,
  key: VinaraMetricKey,
  region: RegionSlug | undefined,
  from: number | undefined,
  to: number | undefined,
): Promise<VinaraMetricResponse | null> {
  const summary = await getVinara(db, region, from, to, key);
  const found = summary?.metrics.find((m) => m.key === key);
  if (!summary || !found) return null;
  const { regions: regional, ...head } = found;
  const { from: windowFrom, to: windowTo } = head.window;
  const ranking = await db.query<RankedRow>(
    `SELECT iso3, name, region, value, year, estimate, rank
     FROM vinara_rankings($1, $2, $3, $4) ORDER BY rank, name`,
    [key, region ?? null, windowFrom, windowTo],
  );
  const pair = [head.cardinals, head.contenders]
    .map((list) => (list.length === 1 ? list[0]?.iso3 : undefined))
    .filter((iso3): iso3 is string => iso3 !== undefined);
  const series =
    pair.length === 0
      ? []
      : await db.query<SeriesRow>(
          `SELECT c.iso3::text AS iso3, y.year, round(y.value, m.decimals) AS value, y.estimate
           FROM vinara_country_years($1) y
           JOIN countries c ON c.id = y.country_id
           JOIN vinara_metrics m ON m.key = $1
           WHERE c.iso3 = ANY($2::text[]) AND y.year BETWEEN $3 AND $4
           ORDER BY c.iso3, y.year`,
          [key, pair, windowFrom, windowTo],
        );
  return {
    region: summary.region,
    metric: head,
    ranking: ranking.map((r) => ({ ...r, value: num(r.value) })),
    regions: regional ? regional.values : null,
    series: pair.map((iso3, index) => ({
      iso3,
      role: index === 0 && head.cardinals.length === 1 ? 'cardinal' : 'contender',
      points: series
        .filter((s) => s.iso3 === iso3)
        .map((s) => ({ year: s.year, value: num(s.value), estimate: s.estimate })),
    })),
  };
}

// ── One state (the drawer) ───────────────────────────────────────────────────

interface CountryMeasureRow {
  key: VinaraMetricKey;
  name: string;
  unit: string;
  decimals: number;
  kind: 'level' | 'rate';
  from_year: number;
  to_year: number;
  is_default: boolean;
  value: number | string | null;
  year: number | null;
  estimate: boolean;
  rank_africa: number | null;
  rank_region: number | null;
  ranked_africa: number;
  ranked_region: number;
  unranked_reason: string | null;
}

/** The figures shown for context in the drawer (not ranked). */
const CONTEXT_KEYS = [
  'population_growth',
  'military_pct_gdp',
  'external_debt',
  'external_debt_public',
] as const;

/** How many creditors the drawer lists by name (the rest are summed). */
const CREDITORS_LISTED = 8;

/**
 * One state's page in the drawer: each measure's value over its window (the page's years) with
 * its rank in Africa and in its region, context figures, public external debt by creditor and
 * its currency. Null for an unknown state.
 */
export async function getVinaraCountry(
  db: Db,
  iso3: string,
  from: number | undefined,
  to: number | undefined,
): Promise<VinaraCountryResponse | null> {
  const [country] = await db.query<{
    iso3: string;
    name: string;
    slug: RegionSlug;
    region: string;
  }>(
    `SELECT c.iso3::text AS iso3, c.name, r.slug, r.name AS region
     FROM countries c JOIN regions r ON r.id = c.region_id WHERE c.iso3 = $1`,
    [iso3],
  );
  if (country === undefined) return null;

  const [measures, context, creditors, currencies] = await Promise.all([
    db.query<CountryMeasureRow>(
      `WITH c AS (
         SELECT c.id, r.slug FROM countries c JOIN regions r ON r.id = c.region_id WHERE c.iso3 = $1
       ),
       w AS (
         SELECT m.key, m.sort_order, m.name, m.unit, m.decimals, m.kind, m.unranked_reason,
                w.from_year, w.to_year, w.is_default
         FROM vinara_metrics m CROSS JOIN LATERAL vinara_window(m.key, $2, $3) w
         WHERE w.to_year IS NOT NULL
       ),
       r AS MATERIALIZED (
         SELECT w.key, x.country_id, x.region, x.value, x.year, x.estimate, x.rank
         FROM w CROSS JOIN LATERAL vinara_rankings(w.key, NULL, w.from_year, w.to_year) x
       ),
       rr AS (
         SELECT r.*, rank() OVER (PARTITION BY r.key, r.region ORDER BY r.rank)::int AS rank_region
         FROM r
       )
       SELECT w.key, w.name, w.unit, w.decimals, w.kind, w.from_year, w.to_year, w.is_default,
              me.value, me.year, coalesce(me.estimate, false) AS estimate,
              me.rank AS rank_africa, me.rank_region,
              (SELECT count(*)::int FROM r WHERE r.key = w.key) AS ranked_africa,
              (SELECT count(*)::int FROM r WHERE r.key = w.key AND r.region = c.slug) AS ranked_region,
              CASE WHEN me.country_id IS NULL THEN w.unranked_reason END AS unranked_reason
       FROM w CROSS JOIN c
       LEFT JOIN rr me ON me.key = w.key AND me.country_id = c.id
       ORDER BY w.sort_order`,
      [iso3, from ?? null, to ?? null],
    ),
    db.query<{
      key: string;
      name: string;
      unit: string;
      decimals: number;
      value: number | string;
      year: number;
      estimate: boolean;
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (i.key) i.key, i.name, i.unit, i.decimals, i.sort_order,
                round(o.value, i.decimals) AS value, o.year::int AS year,
                o.basis = 'estimate' AS estimate
         FROM indicator_observations o
         JOIN indicators i ON i.id = o.indicator_id
         JOIN countries c ON c.id = o.country_id
         WHERE c.iso3 = $1 AND i.key = ANY ($2::text[])
         ORDER BY i.key, o.year DESC
       ) latest ORDER BY sort_order`,
      [iso3, [...CONTEXT_KEYS]],
    ),
    db.query<{
      year: number;
      kind: VinaraCreditor['kind'];
      name: string;
      amount_usd: number | string;
      total_usd: number | string;
    }>(
      `WITH d AS (
         SELECT e.* FROM external_debt_creditors e JOIN countries c ON c.id = e.country_id
         WHERE c.iso3 = $1
       ),
       latest AS (SELECT max(year) AS year FROM d)
       SELECT d.year::int AS year, d.creditor_kind::text AS kind, d.creditor_name AS name,
              d.amount_usd, sum(d.amount_usd) OVER () AS total_usd
       FROM d JOIN latest ON d.year = latest.year
       ORDER BY d.amount_usd DESC, d.creditor_name`,
      [iso3],
    ),
    db.query<{
      code: string;
      union_name: string | null;
      anchor: string | null;
      parity: number | string | null;
      since: string | null;
      basis: 'ecb' | 'derived' | 'bis' | 'central_bank' | null;
      source: string | null;
      url: string | null;
      first_day: string | null;
      last_day: string | null;
      status: 'current' | 'late' | 'stale' | 'none' | null;
      last_month: string | null;
    }>(
      `SELECT cc.currency_code::text AS code, cc.union_name, cc.peg_anchor::text AS anchor,
              cc.peg_parity AS parity, cc.peg_since::text AS since,
              d.basis::text AS basis, s.title AS source, s.url,
              d.first_day::text AS first_day, d.last_day::text AS last_day,
              fr.status::text AS status, fr.last_month::text AS last_month
       FROM countries c
       JOIN country_currencies cc ON cc.country_id = c.id
       LEFT JOIN LATERAL (
         SELECT min(f.day) AS first_day, max(f.day) AS last_day,
                (array_agg(f.basis ORDER BY f.day DESC))[1] AS basis,
                (array_agg(f.source_id ORDER BY f.day DESC))[1] AS source_id
         FROM fx_daily f WHERE f.currency_code = cc.currency_code
         HAVING count(*) > 0
       ) d ON true
       LEFT JOIN sources s ON s.id = d.source_id
       LEFT JOIN fx_reporting fr ON fr.country_id = c.id
       WHERE c.iso3 = $1`,
      [iso3],
    ),
  ]);

  const [first] = creditors;
  const listed = creditors.slice(0, CREDITORS_LISTED);
  const total = first === undefined ? 0 : num(first.total_usd);
  const share = (amount: number) => (total > 0 ? Math.round((amount / total) * 1000) / 10 : 0);
  const [currency] = currencies;

  return {
    country: {
      iso3: country.iso3,
      name: country.name,
      region: { slug: country.slug, name: country.region },
    },
    measures: measures.map((m) => ({
      key: m.key,
      name: m.name,
      unit: m.unit,
      decimals: m.decimals,
      kind: m.kind,
      window: { from: m.from_year, to: m.to_year, isDefault: m.is_default },
      value: numOrNull(m.value),
      year: m.year,
      estimate: m.estimate,
      rankAfrica: m.rank_africa,
      rankedAfrica: m.ranked_africa,
      rankRegion: m.rank_region,
      rankedRegion: m.ranked_region,
      unrankedReason: m.unranked_reason,
    })),
    context: context.map((c) => ({
      key: c.key,
      name: c.name,
      unit: c.unit,
      decimals: c.decimals,
      value: num(c.value),
      year: c.year,
      estimate: c.estimate,
    })),
    debt:
      first === undefined
        ? null
        : {
            year: first.year,
            totalUsd: total,
            creditors: listed.map((c) => ({
              kind: c.kind,
              name: c.name,
              amountUsd: num(c.amount_usd),
              sharePct: share(num(c.amount_usd)),
            })),
            othersUsd: Math.max(0, total - listed.reduce((sum, c) => sum + num(c.amount_usd), 0)),
          },
    currency:
      currency === undefined
        ? null
        : {
            code: currency.code,
            unionName: currency.union_name,
            peg:
              currency.anchor === null || currency.parity === null || currency.since === null
                ? null
                : { anchor: currency.anchor, parity: num(currency.parity), since: currency.since },
            daily:
              currency.basis === null ||
              currency.source === null ||
              currency.url === null ||
              currency.first_day === null ||
              currency.last_day === null
                ? null
                : {
                    basis: currency.basis,
                    source: currency.source,
                    url: currency.url,
                    first: currency.first_day,
                    last: currency.last_day,
                  },
            monthly:
              currency.status === null
                ? null
                : { status: currency.status, lastMonth: currency.last_month },
          },
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export interface VinaraExportRow {
  metric: VinaraMetricKey;
  metricName: string;
  unit: string;
  from: number;
  to: number;
  rank: number | null;
  iso3: string;
  country: string;
  region: string;
  value: number | null;
  year: number | null;
  estimate: boolean;
  unrankedReason: string | null;
}

/** Every measure's full ranking for the scope and years, then the states taking no part. */
export async function getVinaraExportRows(
  db: Db,
  region: RegionSlug | undefined,
  from: number | undefined,
  to: number | undefined,
): Promise<VinaraExportRow[]> {
  const rows = await db.query<{
    key: VinaraMetricKey;
    name: string;
    unit: string;
    from_year: number;
    to_year: number;
    rank: number | null;
    iso3: string;
    country: string;
    region: string;
    value: number | string | null;
    year: number | null;
    estimate: boolean | null;
    unranked_reason: string | null;
  }>(
    `WITH w AS (
       SELECT m.key, w.from_year, w.to_year
       FROM vinara_metrics m CROSS JOIN LATERAL vinara_window(m.key, $2, $3) w
       WHERE w.to_year IS NOT NULL
     ),
     r AS MATERIALIZED (
       SELECT w.key, x.* FROM w CROSS JOIN LATERAL vinara_rankings(w.key, $1, w.from_year, w.to_year) x
     )
     SELECT m.key, m.name, m.unit, w.from_year, w.to_year, r.rank, c.iso3::text AS iso3,
            c.name AS country, rg.name AS region, r.value, r.year, r.estimate,
            CASE WHEN r.country_id IS NULL THEN m.unranked_reason END AS unranked_reason
     FROM w
     JOIN vinara_metrics m ON m.key = w.key
     CROSS JOIN countries c
     JOIN regions rg ON rg.id = c.region_id
     LEFT JOIN r ON r.key = w.key AND r.country_id = c.id
     WHERE $1::text IS NULL OR rg.slug = $1
     ORDER BY m.sort_order, r.rank NULLS LAST, c.name`,
    [region ?? null, from ?? null, to ?? null],
  );
  return rows.map((r) => ({
    metric: r.key,
    metricName: r.name,
    unit: r.unit,
    from: r.from_year,
    to: r.to_year,
    rank: r.rank,
    iso3: r.iso3,
    country: r.country,
    region: r.region,
    value: numOrNull(r.value),
    year: r.year,
    estimate: r.estimate ?? false,
    unrankedReason: r.unranked_reason,
  }));
}

/** The datasets behind Vinara (versions, licences and attributions), for the export. */
export async function vinaraDatasets(db: Db): Promise<DatasetMeta[]> {
  const rows = await db.query<{
    key: string;
    name: string;
    provider: string;
    license: string;
    attribution: string;
    as_of: string;
  }>(
    `SELECT key, name, provider, license, attribution, as_of::text AS as_of
     FROM datasets WHERE key LIKE 'vinara-%' ORDER BY key`,
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

/** Each measure's definition, in display order (docs/vinara-method.md, word for word). */
export async function vinaraDefinitions(db: Db): Promise<{ key: string; definition: string }[]> {
  return db.query<{ key: string; definition: string }>(
    'SELECT key, definition FROM vinara_metrics ORDER BY sort_order',
  );
}
