import type {
  CountryDetail,
  CountryFacts,
  CountrySummary,
  CoverageDataset,
  DatasetKey,
  Election,
  Leader,
  Region,
  RegionSlug,
  Source,
  YearValue,
} from './contract.ts';

import type { Db } from './db.ts';

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
  population: string | null;
  population_year: number | null;
  population_is_estimate: boolean | null;
  land_area_km2: string | null;
  land_area_year: number | null;
  leaders: Leader[] | string;
  election_decides: Election['decides'] | null;
  election_kind: Election['kind'];
  election_date: string | null;
  election_precision: Election['precision'];
  election_status: Election['status'] | null;
  politics_note: string | null;
}

const SUMMARY_COLUMNS = `country_id, iso3, iso2, name, official_name, region_slug, region_name,
  region_color_hex, flag_url_template, centroid_lon, centroid_lat, is_microstate_marker,
  etymology_summary, etymology_category, flag_design_summary, flag_design_detail,
  national_symbol_summary, national_animal_name, animal_status, needs_review`;

/** The summary's columns from v_country_summary (as `v`) and v_country_facts (as `f`). */
const SUMMARY_SELECT = `${SUMMARY_COLUMNS.split(',')
  .map((column) => `v.${column.trim()}`)
  .join(', ')},
  f.population::text AS population, f.population_year, f.population_is_estimate,
  f.land_area_km2::text AS land_area_km2, f.land_area_year, f.leaders, f.election_decides,
  f.election_kind, f.election_date::text AS election_date, f.election_precision,
  f.election_status, f.politics_note`;
const SUMMARY_FROM = `v_country_summary v LEFT JOIN v_country_facts f ON f.country_id = v.country_id`;

function yearValue(
  value: string | null,
  year: number | null,
  estimate: boolean | null,
): YearValue | null {
  return value === null || year === null
    ? null
    : { value: Number(value), year, estimate: estimate === true };
}

function facts(row: CountrySummaryRow): CountryFacts {
  // node-postgres parses json columns; the Neon HTTP driver may hand them over as text.
  const leaders =
    typeof row.leaders === 'string' ? (JSON.parse(row.leaders) as Leader[]) : row.leaders;
  return {
    population: yearValue(row.population, row.population_year, row.population_is_estimate),
    landAreaKm2: yearValue(row.land_area_km2, row.land_area_year, false),
    leaders,
    election:
      row.election_decides === null || row.election_status === null
        ? null
        : {
            decides: row.election_decides,
            kind: row.election_kind,
            date: row.election_date,
            precision: row.election_precision,
            status: row.election_status,
          },
    note: row.politics_note,
  };
}

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
    facts: facts(row),
  };
}

export async function listCountries(
  db: Db,
  filters: { region?: RegionSlug | undefined; q?: string | undefined },
): Promise<CountrySummary[]> {
  const rows = await db.query<CountrySummaryRow>(
    `SELECT ${SUMMARY_SELECT} FROM ${SUMMARY_FROM}
     WHERE ($1::text IS NULL OR v.region_slug = $1)
       AND ($2::text IS NULL OR strpos(v.search_text, search_fold($2)) > 0)
     ORDER BY search_fold(v.name), v.name`,
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
    `SELECT ${SUMMARY_SELECT},
       p.etymology_detail, p.national_symbol_detail, p.national_animal_scientific,
       p.national_animal_detail, p.review_notes
     FROM ${SUMMARY_FROM} JOIN country_profiles p ON p.country_id = v.country_id
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
