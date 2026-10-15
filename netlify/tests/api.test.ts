import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  CountriesResponseSchema,
  CountryResponseSchema,
  CoverageResponseSchema,
  RegionsResponseSchema,
} from '@bla/shared';
import type { Context } from '@netlify/functions';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { seededDb } from '../../db/tests/seededDb';
import countries from '../functions/countries';
import country from '../functions/country';
import coverage from '../functions/coverage';
import { setDbForTesting } from '../functions/_shared/db';
import regions from '../functions/regions';

let pg: PGlite;

beforeAll(async () => {
  pg = await seededDb();
  setDbForTesting({
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      const result = await pg.query<Row>(text, [...params]);
      return result.rows;
    },
  });
});

afterAll(() => {
  setDbForTesting(undefined);
});

function call(
  handler: (request: Request, context: Context) => Promise<Response>,
  path: string,
  { params = {}, method = 'GET' }: { params?: Record<string, string>; method?: string } = {},
): Promise<Response> {
  const context = { params } as unknown as Context;
  return handler(new Request(`https://bla.test${path}`, { method }), context);
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ApiErrorSchema.parse(await response.json()).error;
}

describe('GET /api/regions', () => {
  it('returns the five regions in document order with approved colours and counts', async () => {
    const response = await call(regions, '/api/regions');
    expect(response.status).toBe(200);
    const body = RegionsResponseSchema.parse(await response.json());
    expect(body.regions.map((r) => [r.slug, r.countryCount, r.colorHex])).toEqual([
      ['north', 6, '#c1272d'],
      ['west', 15, '#009e49'],
      ['central', 9, '#fcd116'],
      ['east', 16, '#418fde'],
      ['southern', 8, '#001489'],
    ]);
  });
});

describe('GET /api/countries', () => {
  it('returns all 54 countries without parameters', async () => {
    const body = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries')).json(),
    );
    expect(body.count).toBe(54);
    expect(body.countries).toHaveLength(54);
    const kenya = body.countries.find((c) => c.iso3 === 'KEN');
    expect(kenya).toMatchObject({
      name: 'Kenya',
      region: { slug: 'east', colorHex: '#418fde' },
      flag: {
        svgUrl: 'https://flagcdn.com/ke.svg',
        pngUrlTemplate: 'https://flagcdn.com/w{width}/ke.png',
        fallbackUrl: '/flags/ke.svg',
      },
      animalStatus: 'official',
    });
  });

  it('filters by region', async () => {
    const body = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries?region=north')).json(),
    );
    expect(body.countries.map((c) => c.iso3)).toEqual(['DZA', 'EGY', 'LBY', 'MRT', 'MAR', 'TUN']);
  });

  it('searches without accents and by ISO code', async () => {
    const cote = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries?q=cote')).json(),
    );
    expect(cote.countries.map((c) => c.name)).toEqual(["Côte d'Ivoire"]);
    const byCode = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries?q=zwe')).json(),
    );
    expect(byCode.countries.map((c) => c.iso3)).toEqual(['ZWE']);
    const combined = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries?region=west&q=guinea')).json(),
    );
    expect(combined.countries.map((c) => c.name)).toEqual(['Guinea', 'Guinea-Bissau']);
  });

  it('treats an empty search as no filter and returns an empty list for no match', async () => {
    const all = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries?q=%20')).json(),
    );
    expect(all.count).toBe(54);
    const none = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries?q=atlantis')).json(),
    );
    expect(none).toEqual({ countries: [], count: 0 });
  });

  it('rejects an unknown region with a 400 in the error shape', async () => {
    const response = await call(countries, '/api/countries?region=antarctica');
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('bad_request');
  });

  it('treats search text as data, not SQL', async () => {
    const response = await call(
      countries,
      `/api/countries?q=${encodeURIComponent("'; DROP TABLE countries; --")}`,
    );
    expect(response.status).toBe(200);
    const after = CountriesResponseSchema.parse(
      await (await call(countries, '/api/countries')).json(),
    );
    expect(after.count).toBe(54);
  });
});

describe('GET /api/countries/:iso3', () => {
  it('returns the full profile with sources, case-insensitively', async () => {
    const response = await call(country, '/api/countries/cod', { params: { iso3: 'cod' } });
    expect(response.status).toBe(200);
    const { country: drc } = CountryResponseSchema.parse(await response.json());
    expect(drc.iso3).toBe('COD');
    expect(drc.etymologySummary).toBe('Congo River (Kongo Kingdom)');
    expect(drc.etymologyCategory).toBe('geographic_feature');
    expect(drc.needsReview).toBe(true);
    expect(drc.reviewNotes).toContain('[corrected]');
    const zaire = drc.sources.find((s) => s.key === 'wikipedia-zaire');
    expect(zaire).toMatchObject({
      refNo: null,
      reliabilityTier: 'reference',
      fields: ['etymology'],
    });
    const refs = drc.sources.map((s) => s.refNo).filter((n) => n !== null);
    expect(refs).toEqual([...refs].sort((a, b) => a - b));
  });

  it('returns 404 for unknown and malformed codes alike', async () => {
    for (const code of ['XYZ', 'KE', 'KENYA', '%3Cscript%3E']) {
      const response = await call(country, `/api/countries/${code}`, { params: { iso3: code } });
      expect(response.status).toBe(404);
      const error = await errorOf(response);
      expect(error.code).toBe('not_found');
      expect(error.message).toBe(`No country with code ${code.toUpperCase()}`);
    }
    const empty = await call(country, '/api/countries/', { params: {} });
    expect(await errorOf(empty)).toEqual({ code: 'not_found', message: 'No such country' });
  });
});

describe('GET /api/coverage', () => {
  it('returns requested datasets and reports the ones not loaded yet', async () => {
    const response = await call(
      coverage,
      '/api/coverage?datasets=symbology-pdf,flags-flagpedia,boundaries-natural-earth',
    );
    const body = CoverageResponseSchema.parse(await response.json());
    expect(body.datasets.map((d) => d.key)).toEqual(['flags-flagpedia', 'symbology-pdf']);
    expect(body.missing).toEqual(['boundaries-natural-earth']);
    expect(body.datasets[1]).toMatchObject({ asOf: '2026-10-14', refreshCadence: 'manual' });
    expect(body.datasets[1]?.lastRefreshedAt).toBe('2026-10-15T08:00:00Z');
  });

  it('returns every dataset without a filter and rejects unknown keys', async () => {
    const all = CoverageResponseSchema.parse(await (await call(coverage, '/api/coverage')).json());
    expect(all.datasets).toHaveLength(2);
    expect(all.missing).toEqual([]);
    const bad = await call(coverage, '/api/coverage?datasets=symbology-pdf,nope');
    expect(bad.status).toBe(400);
  });
});

describe('shared handler behaviour', () => {
  it('caches responses and honours If-None-Match', async () => {
    const first = await call(regions, '/api/regions');
    expect(first.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    const etag = first.headers.get('etag') ?? '';
    const second = await regions(
      new Request('https://bla.test/api/regions', { headers: { 'If-None-Match': etag } }),
      { params: {} } as unknown as Context,
    );
    expect(second.status).toBe(304);
  });

  it('allows only GET and HEAD', async () => {
    const post = await call(regions, '/api/regions', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    const head = await call(regions, '/api/regions', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('returns 503 when the database is not configured, and 500 without details on errors', async () => {
    setDbForTesting(undefined);
    const previous = process.env.DATABASE_URL_READ;
    delete process.env.DATABASE_URL_READ;
    const unavailable = await call(regions, '/api/regions');
    expect(unavailable.status).toBe(503);
    if (previous !== undefined) process.env.DATABASE_URL_READ = previous;

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setDbForTesting({
      query: () => Promise.reject(new Error('relation "secret_table" does not exist')),
    });
    const failed = await call(regions, '/api/regions');
    expect(failed.status).toBe(500);
    expect(await errorOf(failed)).toEqual({
      code: 'internal_error',
      message: 'Something went wrong',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    setDbForTesting({
      async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
        return (await pg.query<Row>(text, [...params])).rows;
      },
    });
  });
});
