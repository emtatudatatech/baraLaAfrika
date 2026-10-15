import type {
  CountryDetail,
  CountrySummary,
  CoverageDataset,
  DatasetKey,
  Region,
  RegionSlug,
  Source,
} from './contract';

import type { Db } from './db';

/* All SQL used by the API lives here: parameterised queries only. */

interface RegionRow {
  slug: Region['slug'];
  name: string;
  description: string | null;
  color_hex: string | null;
  sort_order: number;
  country_count: number;
}

export async function listRegions(db: Db): Promise<Region[]> {
  const rows = await db.query<RegionRow>(
    `SELECT r.slug, r.name, r.description, r.color_hex, r.sort_order,
            count(c.id)::int AS country_count
     FROM regions r LEFT JOIN countries c ON c.region_id = r.id
     GROUP BY r.id ORDER BY r.sort_order`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    colorHex: row.color_hex,
    sortOrder: row.sort_order,
    countryCount: row.country_count,
  }));
}

interface CountrySummaryRow {
  country_id: number;
  iso3: string;
  iso2: string;
  name: string;
  official_name: string | null;
  region_slug: RegionSlug;
  region_name: string;
  region_color_hex: string | null;
  flag_url_template: string;
  centroid_lon: number | null;
  centroid_lat: number | null;
  is_microstate_marker: boolean;
  etymology_summary: string;
  etymology_category: CountrySummary['etymologyCategory'];
  flag_design_summary: string;
  flag_design_detail: string | null;
  national_symbol_summary: string;
  national_animal_name: string;
  animal_status: CountrySummary['animalStatus'];
  needs_review: boolean;
}

const SUMMARY_COLUMNS = `country_id, iso3, iso2, name, official_name, region_slug, region_name,
  region_color_hex, flag_url_template, centroid_lon, centroid_lat, is_microstate_marker,
  etymology_summary, etymology_category, flag_design_summary, flag_design_detail,
  national_symbol_summary, national_animal_name, animal_status, needs_review`;

function toSummary(row: CountrySummaryRow): CountrySummary {
  const code = row.iso2.toLowerCase();
  return {
    iso3: row.iso3,
    iso2: row.iso2,
    name: row.name,
    officialName: row.official_name,
    region: { slug: row.region_slug, name: row.region_name, colorHex: row.region_color_hex },
    flag: {
      svgUrl: `https://flagcdn.com/${code}.svg`,
      pngUrlTemplate: row.flag_url_template,
      fallbackUrl: `/flags/${code}.svg`,
    },
    centroid:
      row.centroid_lon === null || row.centroid_lat === null
        ? null
        : { lon: row.centroid_lon, lat: row.centroid_lat },
    isMicrostateMarker: row.is_microstate_marker,
    etymologySummary: row.etymology_summary,
    etymologyCategory: row.etymology_category,
    flagDesignSummary: row.flag_design_summary,
    flagDesignDetail: row.flag_design_detail,
    nationalSymbolSummary: row.national_symbol_summary,
    nationalAnimalName: row.national_animal_name,
    animalStatus: row.animal_status,
    needsReview: row.needs_review,
  };
}

export async function listCountries(
  db: Db,
  filters: { region?: RegionSlug | undefined; q?: string | undefined },
): Promise<CountrySummary[]> {
  const rows = await db.query<CountrySummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM v_country_summary
     WHERE ($1::text IS NULL OR region_slug = $1)
       AND ($2::text IS NULL OR strpos(search_text, search_fold($2)) > 0)
     ORDER BY search_fold(name), name`,
    [filters.region ?? null, filters.q ?? null],
  );
  return rows.map(toSummary);
}

interface CountryDetailRow extends CountrySummaryRow {
  etymology_detail: string | null;
  national_symbol_detail: string | null;
  national_animal_scientific: string | null;
  national_animal_detail: string | null;
  review_notes: string | null;
}

interface SourceRow {
  source_key: string;
  ref_no: number | null;
  title: string;
  url: string;
  source_type: string;
  reliability_tier: Source['reliabilityTier'];
  fields: Source['fields'];
}

export async function getCountry(db: Db, iso3: string): Promise<CountryDetail | null> {
  const [row] = await db.query<CountryDetailRow>(
    `SELECT ${SUMMARY_COLUMNS.split(',')
      .map((column) => `v.${column.trim()}`)
      .join(', ')},
       p.etymology_detail, p.national_symbol_detail, p.national_animal_scientific,
       p.national_animal_detail, p.review_notes
     FROM v_country_summary v JOIN country_profiles p ON p.country_id = v.country_id
     WHERE v.iso3 = $1`,
    [iso3],
  );
  if (!row) return null;
  const sources = await db.query<SourceRow>(
    `SELECT s.source_key, s.ref_no, s.title, s.url, s.source_type,
            s.reliability_tier::text AS reliability_tier,
            array_agg(cs.field::text ORDER BY cs.field) AS fields
     FROM country_sources cs JOIN sources s ON s.id = cs.source_id
     WHERE cs.country_id = $1
     GROUP BY s.id ORDER BY s.ref_no NULLS LAST, s.source_key`,
    [row.country_id],
  );
  return {
    ...toSummary(row),
    etymologyDetail: row.etymology_detail,
    nationalSymbolDetail: row.national_symbol_detail,
    nationalAnimalScientific: row.national_animal_scientific,
    nationalAnimalDetail: row.national_animal_detail,
    reviewNotes: row.review_notes,
    sources: sources.map((s) => ({
      key: s.source_key,
      refNo: s.ref_no,
      title: s.title,
      url: s.url,
      sourceType: s.source_type,
      reliabilityTier: s.reliability_tier,
      fields: s.fields,
    })),
  };
}

interface DatasetRow {
  key: DatasetKey;
  name: string;
  provider: string;
  license: string;
  attribution: string;
  coverage_start: string | null;
  coverage_end: string | null;
  as_of: string;
  last_refreshed_at: string | null;
  refresh_cadence: CoverageDataset['refreshCadence'];
}

export async function listDatasets(
  db: Db,
  keys: readonly DatasetKey[] | undefined,
): Promise<CoverageDataset[]> {
  const rows = await db.query<DatasetRow>(
    `SELECT key, name, provider, license, attribution,
            coverage_start::text AS coverage_start, coverage_end::text AS coverage_end,
            as_of::text AS as_of,
            to_char(last_refreshed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
              AS last_refreshed_at,
            refresh_cadence::text AS refresh_cadence
     FROM datasets WHERE ($1::text[] IS NULL OR key = ANY($1::text[])) ORDER BY key`,
    [keys ? [...keys] : null],
  );
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    provider: row.provider,
    license: row.license,
    attribution: row.attribution,
    coverageStart: row.coverage_start,
    coverageEnd: row.coverage_end,
    asOf: row.as_of,
    lastRefreshedAt: row.last_refreshed_at,
    refreshCadence: row.refresh_cadence,
  }));
}
