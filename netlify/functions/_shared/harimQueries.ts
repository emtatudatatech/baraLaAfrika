import type {
  CountryRef,
  HarimStat,
  Mountain,
  MountainCountrySummary,
  MountainDetail,
  MountainsQuery,
  MountainSource,
  MountainSummaryQuery,
  RegionSlug,
} from './contract.ts';

import type { Db } from './db.ts';

/* Harim (mountains) SQL: parameterised queries over the read models in migration 0004. */

/** The most rows /api/mountains returns (the catalogue is a few hundred; this is a safety cap). */
export const MOUNTAIN_LIST_CAP = 600;

const MOUNTAIN_DATASETS = ['mountains-baseline', 'mountains-wikidata', 'mountains-geonames'];

function flagOf(iso2: string, template: string): CountryRef['flag'] {
  const code = iso2.toLowerCase();
  return {
    svgUrl: `https://flagcdn.com/${code}.svg`,
    pngUrlTemplate: template,
    fallbackUrl: `/flags/${code}.svg`,
  };
}

interface SummaryRow {
  iso3: string;
  iso2: string;
  name: string;
  region_slug: RegionSlug;
  region_name: string;
  region_color_hex: string | null;
  flag_url_template: string;
  highest_peak_slug: string | null;
  highest_peak_name: string | null;
  highest_summit_name: string | null;
  highest_peak_m: number | null;
  highest_peak_confidence: string | null;
  high_point_shared_with: string[];
  high_point_needs_review: boolean;
  peak_count: number;
  mean_peak_m: number | null;
  range_names: string[];
  lowest_point_name: string | null;
  lowest_point_m: number | null;
  lowest_point_feature: string | null;
  lowest_point_needs_review: boolean | null;
  relief_m: number | null;
}

export async function listMountainSummary(
  db: Db,
  filters: MountainSummaryQuery,
): Promise<MountainCountrySummary[]> {
  const rows = await db.query<SummaryRow>(
    `SELECT iso3, iso2, name, region_slug, region_name, region_color_hex, flag_url_template,
            highest_peak_slug, highest_peak_name, highest_summit_name, highest_peak_m,
            highest_peak_confidence::text AS highest_peak_confidence, high_point_shared_with,
            high_point_needs_review, peak_count, mean_peak_m, range_names, lowest_point_name,
            lowest_point_m, lowest_point_feature::text AS lowest_point_feature,
            lowest_point_needs_review, relief_m
     FROM v_country_mountain_summary
     WHERE ($1::text IS NULL OR region_slug = $1)
       AND ($2::text IS NULL OR strpos(search_text, search_fold($2)) > 0)
     ORDER BY highest_peak_m DESC NULLS LAST, search_fold(name)`,
    [filters.region ?? null, filters.q ?? null],
  );
  return rows.map((row) => ({
    country: {
      iso3: row.iso3,
      iso2: row.iso2,
      name: row.name,
      region: { slug: row.region_slug, name: row.region_name, colorHex: row.region_color_hex },
      flag: flagOf(row.iso2, row.flag_url_template),
    },
    highestPeak:
      row.highest_peak_slug === null ||
      row.highest_peak_name === null ||
      row.highest_peak_m === null
        ? null
        : {
            slug: row.highest_peak_slug,
            name: row.highest_peak_name,
            summitName: row.highest_summit_name,
            elevationM: row.highest_peak_m,
            confidence: row.highest_peak_confidence as MountainDetail['confidence'],
            sharedWith: row.high_point_shared_with,
            needsReview: row.high_point_needs_review,
          },
    peakCount: row.peak_count,
    meanPeakM: row.mean_peak_m,
    ranges: row.range_names,
    lowestPoint:
      row.lowest_point_name === null || row.lowest_point_m === null
        ? null
        : {
            name: row.lowest_point_name,
            elevationM: row.lowest_point_m,
            feature: row.lowest_point_feature as NonNullable<
              MountainCountrySummary['lowestPoint']
            >['feature'],
            needsReview: row.lowest_point_needs_review ?? false,
          },
    reliefM: row.relief_m,
  }));
}

interface MountainRow {
  mountain_id: number;
  slug: string;
  name: string;
  alt_names: string[];
  elevation_m: number;
  elevation_confidence: Mountain['confidence'];
  latitude: number;
  longitude: number;
  peak_type: Mountain['peakType'];
  volcanic_status: Mountain['volcanicStatus'];
  is_volcanic: boolean;
  prominence_m: number | null;
  isolation_km: string | number | null;
  summit_kind: Mountain['summitKind'];
  parent_slug: string | null;
  parent_name: string | null;
  range_slug: string | null;
  range_name: string | null;
  country_iso3s: string[];
  high_point_of: string[];
  is_shared: boolean;
  territory_name: string | null;
  needs_review: boolean;
  summits: Mountain['summits'] | null;
}

const MOUNTAIN_COLUMNS = `v.mountain_id, v.slug, v.name, v.alt_names, v.elevation_m,
  v.elevation_confidence::text AS elevation_confidence, v.latitude, v.longitude,
  v.peak_type::text AS peak_type, v.volcanic_status::text AS volcanic_status, v.is_volcanic,
  v.prominence_m, v.isolation_km, v.summit_kind::text AS summit_kind, v.parent_slug,
  v.parent_name, v.range_slug, v.range_name, v.country_iso3s, v.high_point_of, v.is_shared,
  v.territory_name, v.needs_review,
  (SELECT json_agg(json_build_object('slug', s.slug, 'name', s.name, 'elevationM', s.elevation_m,
     'confidence', s.elevation_confidence) ORDER BY s.elevation_m DESC, s.name)
   FROM mountains s WHERE s.parent_id = v.mountain_id) AS summits`;

function toMountain(row: MountainRow): Mountain {
  return {
    slug: row.slug,
    name: row.name,
    altNames: row.alt_names,
    elevationM: row.elevation_m,
    confidence: row.elevation_confidence,
    lat: row.latitude,
    lon: row.longitude,
    peakType: row.peak_type,
    volcanicStatus: row.volcanic_status,
    isVolcanic: row.is_volcanic,
    prominenceM: row.prominence_m,
    isolationKm: row.isolation_km === null ? null : Number(row.isolation_km),
    summitKind: row.summit_kind,
    parent:
      row.parent_slug && row.parent_name ? { slug: row.parent_slug, name: row.parent_name } : null,
    range: row.range_slug && row.range_name ? { slug: row.range_slug, name: row.range_name } : null,
    countries: row.country_iso3s,
    highPointOf: row.high_point_of,
    isShared: row.is_shared,
    territory: row.territory_name,
    needsReview: row.needs_review,
    summits: row.summits ?? [],
  };
}

const ORDER_BY: Record<MountainsQuery['sort'], string> = {
  height: 'v.elevation_m DESC, v.slug',
  '-height': 'v.elevation_m ASC, v.slug',
  // Unknown prominence sorts last, whichever way.
  prominence: 'v.prominence_m DESC NULLS LAST, v.elevation_m DESC, v.slug',
  name: 'search_fold(v.name), v.slug',
};

export async function listMountains(
  db: Db,
  query: MountainsQuery,
): Promise<{ mountains: Mountain[]; total: number }> {
  const where = `
    WHERE (CASE WHEN $1::boolean THEN v.territory_name IS NOT NULL
                ELSE v.territory_name IS NULL END)
      AND ($2::boolean OR v.summit_kind <> 'summit')
      AND ($3::text IS NULL OR $3 = ANY (v.region_slugs))
      AND ($4::text IS NULL OR $4 = ANY (v.country_iso3s))
      AND ($5::text IS NULL OR v.range_slug = $5)
      AND ($6::text IS NULL OR strpos(v.search_text, search_fold($6)) > 0)
      AND ($7::int IS NULL OR v.elevation_m >= $7)
      AND ($8::text IS NULL
           OR ($8 = '1' AND v.is_volcanic)
           OR ($8 = 'unknown' AND v.is_volcanic AND v.volcanic_status IS NULL)
           OR v.volcanic_status::text = $8)`;
  const params = [
    query.territories === '1',
    query.summits === '1',
    query.region ?? null,
    query.country ?? null,
    query.range ?? null,
    query.q ?? null,
    query.minHeight ?? null,
    query.volcanic ?? null,
  ];
  const rows = await db.query<MountainRow & { total: number }>(
    `SELECT ${MOUNTAIN_COLUMNS}, count(*) OVER ()::int AS total
     FROM v_mountains v ${where}
     ORDER BY ${ORDER_BY[query.sort]}
     LIMIT ${String(MOUNTAIN_LIST_CAP)}`,
    params,
  );
  return { mountains: rows.map(toMountain), total: rows[0]?.total ?? 0 };
}

interface SourceRow {
  source_key: string;
  title: string;
  url: string;
  source_type: string;
  reliability_tier: MountainSource['reliabilityTier'];
  fields: MountainSource['fields'];
}

interface DetailRow extends MountainRow {
  elevation_source_key: string;
  elevation_source_title: string;
  elevation_source_url: string;
  elevation_alternatives: { m: number; source: string }[];
  local_names: { name: string; language: string; meaning?: string; source: string }[];
  name_origin: string | null;
  name_origin_source_key: string | null;
  notes: string | null;
  review_notes: string | null;
  wikidata_qid: string | null;
  geonames_id: string | number | null;
}

export async function getMountain(db: Db, slug: string): Promise<MountainDetail | null> {
  const [row] = await db.query<DetailRow>(
    `SELECT ${MOUNTAIN_COLUMNS}, es.source_key AS elevation_source_key,
            es.title AS elevation_source_title, es.url AS elevation_source_url,
            m.elevation_alternatives, m.local_names, m.name_origin,
            ns.source_key AS name_origin_source_key, m.notes, m.review_notes, m.wikidata_qid,
            m.geonames_id
     FROM v_mountains v
     JOIN mountains m ON m.id = v.mountain_id
     JOIN sources es ON es.id = m.elevation_source_id
     LEFT JOIN sources ns ON ns.id = m.name_origin_source_id
     WHERE v.slug = $1`,
    [slug],
  );
  if (!row) return null;
  const sources = await db.query<SourceRow>(
    `SELECT s.source_key, s.title, s.url, s.source_type,
            s.reliability_tier::text AS reliability_tier,
            array_agg(ms.field::text ORDER BY ms.field) AS fields
     FROM mountain_sources ms JOIN sources s ON s.id = ms.source_id
     WHERE ms.mountain_id = $1
     GROUP BY s.id ORDER BY s.reliability_tier, s.title`,
    [row.mountain_id],
  );
  // Sources named in the JSON columns (alternatives, local names) by key.
  const keys = [
    ...new Set([
      ...row.elevation_alternatives.map((a) => a.source),
      ...row.local_names.map((n) => n.source),
      ...(row.name_origin_source_key ? [row.name_origin_source_key] : []),
    ]),
  ];
  const refs = keys.length
    ? await db.query<{ source_key: string; title: string; url: string }>(
        'SELECT source_key, title, url FROM sources WHERE source_key = ANY ($1::text[])',
        [keys],
      )
    : [];
  const byKey = new Map(
    refs.map((r) => [r.source_key, { key: r.source_key, title: r.title, url: r.url }]),
  );
  const ref = (key: string) => {
    const found = byKey.get(key);
    if (!found) throw new Error(`Mountain ${slug} cites unknown source ${key}`);
    return found;
  };
  return {
    ...toMountain(row),
    elevationSource: {
      key: row.elevation_source_key,
      title: row.elevation_source_title,
      url: row.elevation_source_url,
    },
    elevationAlternatives: row.elevation_alternatives.map((a) => ({
      elevationM: a.m,
      source: ref(a.source),
    })),
    localNames: row.local_names.map((n) => ({
      name: n.name,
      language: n.language,
      meaning: n.meaning ?? null,
      source: ref(n.source),
    })),
    nameOrigin: row.name_origin
      ? {
          text: row.name_origin,
          source: row.name_origin_source_key ? ref(row.name_origin_source_key) : null,
        }
      : null,
    notes: row.notes,
    reviewNotes: row.review_notes,
    wikidataQid: row.wikidata_qid,
    geonamesId: row.geonames_id === null ? null : Number(row.geonames_id),
    sources: sources.map((s) => ({
      key: s.source_key,
      title: s.title,
      url: s.url,
      sourceType: s.source_type,
      reliabilityTier: s.reliability_tier,
      fields: s.fields,
    })),
  };
}

interface StatRow {
  key: HarimStat['key'];
  label: string;
  value: string | number | null;
  unit: string;
  detail: Record<string, unknown>;
  entities: Record<string, unknown>[];
  definition: string;
}

/** The statistics, or null when the mountain datasets are not loaded yet. */
export async function getHarimStats(
  db: Db,
  region: RegionSlug | undefined,
): Promise<HarimStat[] | null> {
  const [stats, asOf] = await Promise.all([
    db.query<StatRow>(
      `SELECT key, label, value, unit, detail, entities, definition
       FROM v_harim_stats($1::text) ORDER BY sort_order`,
      [region ?? null],
    ),
    db.query<{ as_of: string | null }>(
      'SELECT max(as_of)::text AS as_of FROM datasets WHERE key = ANY ($1::text[])',
      [MOUNTAIN_DATASETS],
    ),
  ]);
  const date = asOf[0]?.as_of;
  if (!date) return null;
  // The shape of each card's detail and entities is fixed by v_harim_stats (the API tests
  // validate every card against HarimStatSchema).
  return stats.map(
    (row) =>
      ({
        key: row.key,
        label: row.label,
        value: row.value === null ? null : Number(row.value),
        unit: row.unit,
        detail: row.detail,
        entities: row.entities,
        definition: row.definition,
        scope: region ?? null,
        asOf: date,
      }) as HarimStat,
  );
}
