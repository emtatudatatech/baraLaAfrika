import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, api } from './api';
import { devApiHint } from './apiHint';

/** Stubs fetch; a Response is cloned per call (bodies can only be read once). */
function stubFetch(response: Response | Error | DOMException) {
  const fetchMock = vi.fn(() =>
    response instanceof Response ? Promise.resolve(response.clone()) : Promise.reject(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('builds query strings and omits empty parameters', async () => {
    const fetchMock = stubFetch(Response.json({ countries: [], count: 0 }));
    await api.countries({ region: 'west', q: "côte d'" });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/countries?region=west&q=c%C3%B4te+d%27',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    await api.countries({});
    expect(fetchMock).toHaveBeenLastCalledWith('/api/countries', expect.anything());
    await api.coverage(['symbology-pdf', 'flags-flagpedia']);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/coverage?datasets=symbology-pdf%2Cflags-flagpedia',
      expect.anything(),
    );
  });

  it('builds the Harim paths', async () => {
    const fetchMock = stubFetch(Response.json({}));
    await api.mountainSummary();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/mountains/summary', expect.anything());
    await api.mountains();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/mountains', expect.anything());
    await api.mountains({ territories: true });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/mountains?territories=1', expect.anything());
    await api.mountain('mount-kenya');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/mountains/mount-kenya', expect.anything());
    await api.mountainStats('east');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/mountains/stats?region=east',
      expect.anything(),
    );
  });

  it('turns the API error shape into ApiRequestError', async () => {
    stubFetch(
      Response.json(
        { error: { code: 'not_found', message: 'No country with code XYZ' } },
        { status: 404 },
      ),
    );
    await expect(api.country('XYZ')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'No country with code XYZ',
    });
  });

  it('handles non-JSON error pages and network failures', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.regions()).rejects.toMatchObject({ status: 502, code: 'http_error' });
    stubFetch(new TypeError('Failed to fetch'));
    const error: unknown = await api.regions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'network_error' });
  });

  it('rejects a 200 that is not JSON (a dev server answering /api with the app page)', async () => {
    stubFetch(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(api.countries()).rejects.toMatchObject({ status: 200, code: 'invalid_response' });
    stubFetch(new Response('{"countries": [', { headers: { 'Content-Type': 'application/json' } }));
    await expect(api.countries()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('lets aborts propagate unchanged', async () => {
    stubFetch(new DOMException('aborted', 'AbortError'));
    await expect(api.regions(new AbortController().signal)).rejects.toThrow('aborted');
  });
});

describe('development API hints', () => {
  const unreachable = new ApiRequestError(200, 'invalid_response', 'not JSON');
  it('explain how to start an API in development only', () => {
    expect(devApiHint(unreachable, true)).toContain('npm run dev:local');
    expect(devApiHint(new ApiRequestError(0, 'network_error', 'down'), true)).toContain(
      'npm run dev:netlify',
    );
    expect(devApiHint(new ApiRequestError(502, 'http_error', 'proxy'), true)).not.toBeNull();
    expect(devApiHint(unreachable, false)).toBeNull();
  });

  it('point at the database when the API has none, and stay quiet for real API errors', () => {
    expect(
      devApiHint(new ApiRequestError(503, 'service_unavailable', 'No database'), true),
    ).toContain('DATABASE_URL_READ');
    expect(devApiHint(new ApiRequestError(404, 'not_found', 'No such country'), true)).toBeNull();
    expect(devApiHint(new Error('other'), true)).toBeNull();
    expect(devApiHint(undefined, true)).toBeNull();
  });
});
