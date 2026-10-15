import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, api } from './api';

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

  it('lets aborts propagate unchanged', async () => {
    stubFetch(new DOMException('aborted', 'AbortError'));
    await expect(api.regions(new AbortController().signal)).rejects.toThrow('aborted');
  });
});
