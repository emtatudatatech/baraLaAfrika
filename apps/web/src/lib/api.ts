import type {
  CountriesQuery,
  CountriesResponse,
  CountryResponse,
  CoverageResponse,
  DatasetKey,
  RegionsResponse,
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
  return (await response.json()) as T;
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
};
