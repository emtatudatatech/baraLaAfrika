import { metresToFeet } from './contract.ts';
import type { Mountain, MountainsExportQuery } from './contract.ts';
import type { DatasetMeta } from './harimQueries.ts';

/*
 * /api/mountains/export: the catalogue (or the filtered view) as CSV or GeoJSON. Every file
 * carries its "as of" date, the dataset versions and the attributions and licences the sources
 * require (GeoNames' CC BY 4.0 in particular).
 */

export interface ExportContext {
  mountains: readonly Mountain[];
  query: MountainsExportQuery;
  datasets: readonly DatasetMeta[];
  heightSources: ReadonlyMap<string, { title: string; url: string }>;
  countryNames: ReadonlyMap<string, string>;
  /** The site's origin, for links back to each peak's page. */
  origin: string;
  /** When the file was made (ISO timestamp). */
  generatedAt: string;
}

/** Sources used for some values that are not datasets of their own. */
const OTHER_SOURCES = [
  'The World Factbook, final edition (CIA; public domain): cross-check of national high and low points.',
  'Wikipedia (CC BY-SA 4.0): curated facts such as some summit heights, each cited.',
  'Smithsonian Global Volcanism Program: volcano identifiers via Wikidata (linked, not copied).',
];

const FILTER_KEYS = [
  'region',
  'country',
  'range',
  'q',
  'minHeight',
  'volcanic',
  'territories',
  'summits',
] as const;

/** The filters applied, as [key, value] pairs (none for the whole catalogue). */
export function filterEntries(query: MountainsExportQuery): [string, string][] {
  return FILTER_KEYS.flatMap((key): [string, string][] => {
    const value = query[key];
    return value === undefined ? [] : [[key, String(value)]];
  });
}

/** The filters applied, as "key=value" strings. */
export function describeFilters(query: MountainsExportQuery): string[] {
  return filterEntries(query).map(([key, value]) => `${key}=${value}`);
}

export function asOf(datasets: readonly DatasetMeta[]): string | null {
  return datasets.reduce<string | null>(
    (latest, d) => (latest === null || d.asOf > latest ? d.asOf : latest),
    null,
  );
}

function filename(context: ExportContext, extension: string): string {
  const date = asOf(context.datasets) ?? context.generatedAt.slice(0, 10);
  const scope = describeFilters(context.query).length > 0 ? 'mountains-filtered' : 'mountains';
  return `harim-${scope}-${date}.${extension}`;
}

/** One record per mountain, shared by both formats. */
function record(mountain: Mountain, context: ExportContext) {
  const source = context.heightSources.get(mountain.slug);
  return {
    slug: mountain.slug,
    name: mountain.name,
    elevation_m: mountain.elevationM,
    elevation_ft: Math.round(metresToFeet(mountain.elevationM)),
    elevation_confidence: mountain.confidence,
    elevation_source: source?.title ?? null,
    elevation_source_url: source?.url ?? null,
    prominence_m: mountain.prominenceM,
    isolation_km: mountain.isolationKm,
    latitude: mountain.lat,
    longitude: mountain.lon,
    countries: mountain.countries.join(';'),
    country_names: mountain.countries
      .map((iso3) => context.countryNames.get(iso3) ?? iso3)
      .join(';'),
    national_high_point_of: mountain.highPointOf.join(';'),
    shared: mountain.isShared,
    territory: mountain.territory,
    range: mountain.range?.name ?? null,
    peak_type: mountain.peakType,
    volcanic: mountain.isVolcanic,
    volcanic_status: mountain.volcanicStatus,
    summit_kind: mountain.summitKind,
    massif: mountain.parent?.name ?? null,
    summits: mountain.summits.map((s) => s.name).join(';'),
    needs_review: mountain.needsReview,
    page: `${context.origin}/harim/peaks/${mountain.slug}`,
  };
}

function metadataLines(context: ExportContext): string[] {
  const filters = describeFilters(context.query);
  return [
    'Bara La Afrika · Harim: mountains of Africa',
    `Generated: ${context.generatedAt}`,
    `As of: ${asOf(context.datasets) ?? 'unknown'}`,
    `Rows: ${String(context.mountains.length)}`,
    `Filters: ${filters.length > 0 ? filters.join(', ') : 'none (the whole catalogue)'}`,
    'The catalogue is curated (every national high point, every peak of 3,000 m or more, and notable further peaks); it is not every mountain in Africa. Heights are in metres; feet are converted.',
    'Datasets:',
    ...context.datasets.map(
      (d) =>
        `  ${d.name} (as of ${d.asOf}); provider: ${d.provider}; licence: ${d.license}; attribution: ${d.attribution}`,
    ),
    'Other sources:',
    ...OTHER_SOURCES.map((line) => `  ${line}`),
    `Source: Bara La Afrika (${context.origin}/harim). Contains data from GeoNames (geonames.org), CC BY 4.0.`,
  ];
}

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV (RFC 4180 rows) after a block of "# " metadata lines. */
export function buildCsv(context: ExportContext): { body: string; filename: string } {
  const rows = context.mountains.map((mountain) => record(mountain, context));
  const header = Object.keys(record(EMPTY, context));
  const lines = [
    ...metadataLines(context).map((line) => `# ${line}`),
    header.join(','),
    ...rows.map((row) => header.map((key) => csvCell(row[key as keyof typeof row])).join(',')),
  ];
  return { body: `${lines.join('\r\n')}\r\n`, filename: filename(context, 'csv') };
}

/** GeoJSON FeatureCollection (RFC 7946) with the metadata as a foreign member. */
export function buildGeoJson(context: ExportContext): { body: string; filename: string } {
  const collection = {
    type: 'FeatureCollection',
    metadata: {
      title: 'Bara La Afrika · Harim: mountains of Africa',
      generatedAt: context.generatedAt,
      asOf: asOf(context.datasets),
      count: context.mountains.length,
      filters: Object.fromEntries(filterEntries(context.query)),
      note: 'The catalogue is curated (every national high point, every peak of 3,000 m or more, and notable further peaks); it is not every mountain in Africa.',
      datasets: context.datasets,
      otherSources: OTHER_SOURCES,
      attribution: `Bara La Afrika (${context.origin}/harim). Contains data from GeoNames (geonames.org), CC BY 4.0.`,
    },
    features: context.mountains.map((mountain) => {
      const { latitude, longitude, ...properties } = record(mountain, context);
      return {
        type: 'Feature',
        id: mountain.slug,
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
        properties,
      };
    }),
  };
  return { body: JSON.stringify(collection, null, 2), filename: filename(context, 'geojson') };
}

/** A blank mountain, only to list the CSV columns when there are no rows. */
const EMPTY: Mountain = {
  slug: '',
  name: '',
  altNames: [],
  elevationM: 0,
  confidence: 'high',
  lat: 0,
  lon: 0,
  peakType: null,
  volcanicStatus: null,
  isVolcanic: false,
  prominenceM: null,
  isolationKm: null,
  summitKind: 'standalone',
  parent: null,
  range: null,
  countries: [],
  highPointOf: [],
  isShared: false,
  territory: null,
  needsReview: false,
  summits: [],
};
