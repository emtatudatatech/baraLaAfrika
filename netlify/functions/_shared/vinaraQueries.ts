import type {
  RegionSlug,
  VinaraEntity,
  VinaraMetric,
  VinaraMetricKey,
  VinaraMetricResponse,
  VinaraRegionValue,
  VinaraResponse,
} from './contract.ts';

import type { Db } from './db.ts';

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
