import type {
  CountriesQuery,
  CountriesResponse,
  CountryResponse,
  CoverageResponse,
  DatasetKey,
  GoldCountriesResponse,
  GoldCountryResponse,
  GoldHoldingsChangeResponse,
  GoldPriceResponse,
  GoldSeriesMetric,
  GoldSeriesResponse,
  GoldStatsResponse,
  PriceGranularity,
  HarimStatsResponse,
  MountainResponse,
  MountainSummaryResponse,
  MountainsResponse,
  RangeResponse,
  RangesResponse,
  RegionSlug,
  RegionsResponse,
  VinaraCountryResponse,
  VinaraMetricKey,
  VinaraMetricResponse,
  VinaraResponse,
} from '@bla/shared';

/** An API call failed; `code` is the API's error code (or a transport-level code). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function isErrorBody(value: unknown): value is { error: { code: string; message: string } } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    // Aborts (component unmounted, newer request) propagate unchanged in every runtime.
    if ((error as { name?: unknown } | null)?.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'network_error', 'Could not reach the server');
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON (e.g. a CDN error page).
    }
    if (isErrorBody(body)) {
      throw new ApiRequestError(response.status, body.error.code, body.error.message);
    }
    throw new ApiRequestError(response.status, 'http_error', `Request failed (${response.status})`);
  }
  // A 200 that is not JSON is not the API: typically a dev server answering /api with the app's
  // HTML page because no API is running behind it.
  if (!(response.headers.get('Content-Type') ?? '').includes('json')) {
    throw new ApiRequestError(
      response.status,
      'invalid_response',
      'The server did not return JSON',
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      response.status,
      'invalid_response',
      'The server returned invalid JSON',
    );
  }
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const api = {
  regions: (signal?: AbortSignal) => apiGet<RegionsResponse>('/api/regions', signal),
  countries: (query: CountriesQuery = {}, signal?: AbortSignal) =>
    apiGet<CountriesResponse>(
      withQuery('/api/countries', { region: query.region, q: query.q }),
      signal,
    ),
  country: (iso3: string, signal?: AbortSignal) =>
    apiGet<CountryResponse>(`/api/countries/${encodeURIComponent(iso3)}`, signal),
  coverage: (datasets: readonly DatasetKey[], signal?: AbortSignal) =>
    apiGet<CoverageResponse>(withQuery('/api/coverage', { datasets: datasets.join(',') }), signal),
  mountainSummary: (signal?: AbortSignal) =>
    apiGet<MountainSummaryResponse>('/api/mountains/summary', signal),
  /** The counted catalogue, or (`territories`) the peaks in territories outside the 54 states. */
  mountains: (query: { territories?: boolean } = {}, signal?: AbortSignal) =>
    apiGet<MountainsResponse>(
      withQuery('/api/mountains', { territories: query.territories ? '1' : undefined }),
      signal,
    ),
  mountain: (slug: string, signal?: AbortSignal) =>
    apiGet<MountainResponse>(`/api/mountains/${encodeURIComponent(slug)}`, signal),
  ranges: (signal?: AbortSignal) => apiGet<RangesResponse>('/api/mountains/ranges', signal),
  range: (slug: string, signal?: AbortSignal) =>
    apiGet<RangeResponse>(`/api/mountains/ranges/${encodeURIComponent(slug)}`, signal),
  /** The download address for the catalogue (filtered by `params`) as CSV or GeoJSON. */
  exportUrl: (format: 'csv' | 'geojson', params: Record<string, string | undefined> = {}) =>
    withQuery('/api/mountains/export', { format, ...params }),
  /** Every country's gold figures, each the latest in or before `year` (latest without it). */
  goldCountries: (year: number | undefined, signal?: AbortSignal) =>
    apiGet<GoldCountriesResponse>(
      withQuery('/api/gold/countries', { year: year === undefined ? undefined : String(year) }),
      signal,
    ),
  goldStats: (region: RegionSlug | null, year: number | undefined, signal?: AbortSignal) =>
    apiGet<GoldStatsResponse>(
      withQuery('/api/gold/stats', {
        region: region ?? undefined,
        year: year === undefined ? undefined : String(year),
      }),
      signal,
    ),
  /** One country's gold drawer; its row follows the reference year. */
  goldCountry: (iso3: string, year: number | undefined, signal?: AbortSignal) =>
    apiGet<GoldCountryResponse>(
      withQuery(`/api/gold/countries/${encodeURIComponent(iso3)}`, {
        year: year === undefined ? undefined : String(year),
      }),
      signal,
    ),
  /** A chart series: one per country (production adds Africa's yearly totals). */
  goldSeries: (
    query: {
      metric: GoldSeriesMetric;
      countries?: readonly string[];
      region?: RegionSlug | null;
      from?: number;
      to?: number;
      granularity?: PriceGranularity;
    },
    signal?: AbortSignal,
  ) =>
    apiGet<GoldSeriesResponse>(
      withQuery('/api/gold/series', {
        metric: query.metric,
        countries: query.countries?.join(','),
        region: query.region ?? undefined,
        from: query.from === undefined ? undefined : String(query.from),
        to: query.to === undefined ? undefined : String(query.to),
        granularity: query.granularity,
      }),
      signal,
    ),
  /** Each country's change in holdings value, split into price and volume effects. */
  goldHoldingsChange: (
    query: { countries?: readonly string[]; from?: number; to?: number },
    signal?: AbortSignal,
  ) =>
    apiGet<GoldHoldingsChangeResponse>(
      withQuery('/api/gold/holdings-change', {
        countries: query.countries?.join(','),
        from: query.from === undefined ? undefined : String(query.from),
        to: query.to === undefined ? undefined : String(query.to),
      }),
      signal,
    ),
  goldPrice: (
    query: { from?: number; to?: number; granularity: PriceGranularity },
    signal?: AbortSignal,
  ) =>
    apiGet<GoldPriceResponse>(
      withQuery('/api/gold/price', {
        from: query.from === undefined ? undefined : String(query.from),
        to: query.to === undefined ? undefined : String(query.to),
        granularity: query.granularity,
      }),
      signal,
    ),
  /** The download address for the gold table as CSV (filtered by `params`). */
  goldExportUrl: (params: Record<string, string | undefined> = {}) =>
    withQuery('/api/gold/export', { format: 'csv', ...params }),
  /** Every Vinara measure for Africa or one region, over each measure's default years or a range. */
  vinara: (
    query: { region: RegionSlug | null; from?: number | undefined; to?: number | undefined },
    signal?: AbortSignal,
  ) =>
    apiGet<VinaraResponse>(
      withQuery('/api/vinara', {
        region: query.region ?? undefined,
        from: query.from === undefined ? undefined : String(query.from),
        to: query.to === undefined ? undefined : String(query.to),
      }),
      signal,
    ),
  /** One measure in full: its ranking, regions and the leaders' yearly values. */
  vinaraMetric: (
    query: {
      key: VinaraMetricKey;
      region: RegionSlug | null;
      from?: number | undefined;
      to?: number | undefined;
    },
    signal?: AbortSignal,
  ) =>
    apiGet<VinaraMetricResponse>(
      withQuery(`/api/vinara/metrics/${encodeURIComponent(query.key)}`, {
        region: query.region ?? undefined,
        from: query.from === undefined ? undefined : String(query.from),
        to: query.to === undefined ? undefined : String(query.to),
      }),
      signal,
    ),
  /** One state on every measure, with context, debt by creditor and its currency. */
  vinaraCountry: (
    query: { iso3: string; from?: number | undefined; to?: number | undefined },
    signal?: AbortSignal,
  ) =>
    apiGet<VinaraCountryResponse>(
      withQuery(`/api/vinara/countries/${encodeURIComponent(query.iso3)}`, {
        from: query.from === undefined ? undefined : String(query.from),
        to: query.to === undefined ? undefined : String(query.to),
      }),
      signal,
    ),
  /** The download address for every measure's ranking as CSV. */
  vinaraExportUrl: (params: Record<string, string | undefined> = {}) =>
    withQuery('/api/vinara/export', { format: 'csv', ...params }),
  mountainStats: (region: RegionSlug | null = null, signal?: AbortSignal) =>
    apiGet<HarimStatsResponse>(
      withQuery('/api/mountains/stats', { region: region ?? undefined }),
      signal,
    ),
};
