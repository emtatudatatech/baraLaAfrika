import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  HARIM_STAT_KEYS,
  HarimStatsResponseSchema,
  MountainResponseSchema,
  MountainSummaryResponseSchema,
  MountainsResponseSchema,
  REGION_SLUGS,
  RangeResponseSchema,
  RangesResponseSchema,
} from '@bla/shared';
import type { Context } from '@netlify/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readJson, seededDb } from '../../db/tests/seededDb.ts';
import mountain from '../functions/mountain.ts';
import mountainRange from '../functions/mountain-range.ts';
import mountainRanges from '../functions/mountain-ranges.ts';
import mountains from '../functions/mountains.ts';
import mountainsExport from '../functions/mountains-export.ts';
import mountainsStats from '../functions/mountains-stats.ts';
import mountainsSummary from '../functions/mountains-summary.ts';
import { setDbForTesting } from '../functions/_shared/db.ts';
import { matchingFunctions } from './functionRoutes.ts';

let pg: PGlite;

interface SeedMountain {
  slug: string;
  summit_kind: string;
  territory_name: string | null;
  elevation_m: number;
  prominence_m: number | null;
}
const seed = (readJson('db', 'seeds', 'mountains.json') as { mountains: SeedMountain[] }).mountains;
const counted = seed.filter((m) => m.summit_kind !== 'summit' && m.territory_name === null);

beforeAll(async () => {
  pg = await seededDb();
  setDbForTesting({
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      return (await pg.query<Row>(text, [...params])).rows;
    },
  });
});

afterAll(() => {
  setDbForTesting(undefined);
});

function call(
  handler: (request: Request, context: Context) => Promise<Response>,
  path: string,
  params: Record<string, string> = {},
): Promise<Response> {
  return handler(new Request(`https://bla.test${path}`), { params } as unknown as Context);
}

async function list(query = '') {
  const response = await call(mountains, `/api/mountains${query}`);
  expect(response.status).toBe(200);
  return MountainsResponseSchema.parse(await response.json());
}

describe('GET /api/mountains/summary', () => {
  it('returns all 54 countries, highest first, with high and low points', async () => {
    const response = await call(mountainsSummary, '/api/mountains/summary');
    const body = MountainSummaryResponseSchema.parse(await response.json());
    expect(body.count).toBe(54);
    const [first] = body.countries;
    expect(first?.country.iso3).toBe('TZA');
    expect(first?.highestPeak).toMatchObject({
      slug: 'mount-kilimanjaro',
      summitName: 'Mount Kibo',
      elevationM: 5895,
    });
    const heights = body.countries.map((c) => c.highestPeak?.elevationM ?? 0);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    const djibouti = body.countries.find((c) => c.country.iso3 === 'DJI');
    expect(djibouti?.lowestPoint).toMatchObject({ elevationM: -155, feature: 'lake' });
    expect(djibouti?.reliefM).toBe((djibouti?.highestPeak?.elevationM ?? 0) + 155);
    const uganda = body.countries.find((c) => c.country.iso3 === 'UGA');
    expect(uganda?.highestPeak?.sharedWith).toEqual(['COD']);
  });

  it('filters by region and searches names and ranges without accents', async () => {
    const east = MountainSummaryResponseSchema.parse(
      await (await call(mountainsSummary, '/api/mountains/summary?region=east')).json(),
    );
    expect(east.count).toBe(18);
    const rwenzori = MountainSummaryResponseSchema.parse(
      await (await call(mountainsSummary, '/api/mountains/summary?q=rwenzori')).json(),
    );
    expect(rwenzori.countries.map((c) => c.country.iso3).sort()).toEqual(['COD', 'UGA']);
    const accent = MountainSummaryResponseSchema.parse(
      await (await call(mountainsSummary, '/api/mountains/summary?q=sao%20tome')).json(),
    );
    expect(accent.countries.map((c) => c.country.iso3)).toEqual(['STP']);
  });
});

describe('GET /api/mountains', () => {
  it('lists the counted mountains, highest first with a stable tie-break', async () => {
    const body = await list();
    expect(body.total).toBe(counted.length);
    expect(body.capped).toBe(false);
    expect(body.mountains.some((m) => m.summitKind === 'summit' || m.territory)).toBe(false);
    const keys = body.mountains.map((m) => [m.elevationM, m.slug] as const);
    const sorted = [...keys].sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
    expect(keys).toEqual(sorted);
    const kilimanjaro = body.mountains[0];
    expect(kilimanjaro?.slug).toBe('mount-kilimanjaro');
    expect(kilimanjaro?.summits.map((s) => s.name)).toEqual(['Mount Kibo', 'Mawenzi', 'Shira']);
  });

  it('lists a shared peak under every country it lies in', async () => {
    const uganda = await list('?country=uga');
    const congo = await list('?country=COD');
    expect(uganda.mountains.some((m) => m.slug === 'mount-stanley')).toBe(true);
    expect(congo.mountains.some((m) => m.slug === 'mount-stanley')).toBe(true);
    expect(uganda.mountains.find((m) => m.slug === 'mount-stanley')?.isShared).toBe(true);
  });

  it('filters by height, volcanic status, range and search', async () => {
    const high = await list('?minHeight=5000');
    expect(high.mountains.map((m) => m.slug).sort()).toEqual(
      counted
        .filter((m) => m.elevation_m >= 5000)
        .map((m) => m.slug)
        .sort(),
    );
    const volcanic = await list('?volcanic=1');
    expect(volcanic.total).toBeGreaterThan(0);
    expect(volcanic.mountains.every((m) => m.isVolcanic)).toBe(true);
    const unknown = await list('?volcanic=unknown');
    expect(unknown.mountains.every((m) => m.isVolcanic && m.volcanicStatus === null)).toBe(true);
    const rwenzori = await list('?range=rwenzori');
    expect(rwenzori.mountains.every((m) => m.range?.slug === 'rwenzori')).toBe(true);
    const search = await list('?q=kibo');
    expect(search.mountains.map((m) => m.slug)).toEqual([]); // summits are not listed by default
    const withSummits = await list('?q=kibo&summits=1');
    expect(withSummits.mountains.map((m) => m.slug)).toEqual(['mount-kibo']);
  });

  it('sorts by prominence with unknown values last', async () => {
    const body = await list('?sort=prominence');
    const known = body.mountains.filter((m) => m.prominenceM !== null);
    expect(known.length).toBeGreaterThan(0);
    expect(body.mountains.slice(0, known.length).every((m) => m.prominenceM !== null)).toBe(true);
    const values = known.map((m) => m.prominenceM ?? 0);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('lists territory peaks only when asked', async () => {
    const body = await list('?territories=1');
    expect(body.total).toBe(seed.filter((m) => m.territory_name !== null).length);
    expect(body.mountains.every((m) => m.territory !== null && m.countries.length === 0)).toBe(
      true,
    );
  });

  it('rejects invalid parameters with 400', async () => {
    for (const query of ['?sort=random', '?minHeight=9000', '?country=KE', '?volcanic=maybe']) {
      const response = await call(mountains, `/api/mountains${query}`);
      expect(response.status, query).toBe(400);
      expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('bad_request');
    }
  });
});

describe('GET /api/mountains/:slug', () => {
  it('returns the full record with sourced alternatives and names', async () => {
    const response = await call(mountain, '/api/mountains/mount-kenya', { slug: 'mount-kenya' });
    const { mountain: kenya } = MountainResponseSchema.parse(await response.json());
    expect(kenya.summitKind).toBe('massif');
    expect(kenya.summits.map((s) => s.name)).toEqual(['Batian', 'Nelion', 'Point Lenana']);
    expect(kenya.localNames.some((n) => n.language === 'Kikuyu')).toBe(true);
    expect(kenya.localNames.every((n) => n.source.url.startsWith('https://'))).toBe(true);
    expect(kenya.sources.length).toBeGreaterThan(0);
    const emba = MountainResponseSchema.parse(
      await (await call(mountain, '/api/mountains/emba-soira', { slug: 'emba-soira' })).json(),
    ).mountain;
    expect(emba.elevationM).toBe(3018);
    const prototype = emba.elevationAlternatives.find((a) => a.source.key === 'harim-prototype');
    expect(prototype?.elevationM).toBe(2586);
  });

  it('links a summit to its massif, and 404s unknown or malformed slugs', async () => {
    const kibo = MountainResponseSchema.parse(
      await (await call(mountain, '/api/mountains/mount-kibo', { slug: 'mount-kibo' })).json(),
    ).mountain;
    expect(kibo.parent).toEqual({ slug: 'mount-kilimanjaro', name: 'Mount Kilimanjaro' });
    for (const slug of ['no-such-mountain', 'Bad Slug!']) {
      const response = await call(mountain, `/api/mountains/${encodeURIComponent(slug)}`, { slug });
      expect(response.status).toBe(404);
    }
  });
});

describe('GET /api/mountains/stats', () => {
  it('returns every card for All Africa and for a region', async () => {
    const africa = HarimStatsResponseSchema.parse(
      await (await call(mountainsStats, '/api/mountains/stats')).json(),
    );
    expect(africa.stats.map((s) => s.key)).toEqual([...HARIM_STAT_KEYS]);
    expect(africa.stats.every((s) => s.scope === null && s.definition.length > 20)).toBe(true);
    expect(africa.stats.find((s) => s.key === 'mountains_catalogued')?.value).toBe(counted.length);
    const east = HarimStatsResponseSchema.parse(
      await (await call(mountainsStats, '/api/mountains/stats?region=east')).json(),
    );
    expect(east.stats.every((s) => s.scope === 'east')).toBe(true);
    // Every region's cards match the strict per-card contract (details and entities).
    for (const region of REGION_SLUGS) {
      const body = HarimStatsResponseSchema.parse(
        await (await call(mountainsStats, `/api/mountains/stats?region=${region}`)).json(),
      );
      expect(
        body.stats.map((s) => s.key),
        region,
      ).toEqual([...HARIM_STAT_KEYS]);
    }
    const tallest = africa.stats.find((s) => s.key === 'tallest_mountain');
    expect(tallest?.entities[0]).toMatchObject({
      slug: 'mount-kilimanjaro',
      summitName: 'Mount Kibo',
    });
    const bad = await call(mountainsStats, '/api/mountains/stats?region=asia');
    expect(bad.status).toBe(400);
  });
});

describe('GET /api/mountains/ranges', () => {
  it('lists the ranges with catalogued mountains, tallest first', async () => {
    const body = RangesResponseSchema.parse(
      await (await call(mountainRanges, '/api/mountains/ranges')).json(),
    );
    expect(body.count).toBeGreaterThan(20);
    const tops = body.ranges.map((r) => r.tallest?.elevationM ?? 0);
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
    for (const range of body.ranges) {
      expect(range.heights).toHaveLength(range.peakCount);
      expect(range.heights).toEqual([...range.heights].sort((a, b) => b - a));
      if (range.tintRegion !== null) expect(range.regions).toContain(range.tintRegion);
    }
    const rwenzori = body.ranges.find((r) => r.slug === 'rwenzori');
    expect(rwenzori?.tallest).toEqual({
      slug: 'mount-stanley',
      name: 'Mount Stanley',
      elevationM: 5109,
    });
    expect(rwenzori?.countries.sort()).toEqual(['COD', 'UGA']);
    expect(rwenzori?.hasDescription).toBe(true);
  });

  it('filters by region and searches range and mountain names', async () => {
    const north = RangesResponseSchema.parse(
      await (await call(mountainRanges, '/api/mountains/ranges?region=north')).json(),
    );
    expect(north.ranges.every((r) => r.regions.includes('north'))).toBe(true);
    expect(north.ranges.map((r) => r.slug)).toContain('high-atlas');
    const toubkal = RangesResponseSchema.parse(
      await (await call(mountainRanges, '/api/mountains/ranges?q=toubkal')).json(),
    );
    expect(toubkal.ranges.map((r) => r.slug)).toEqual(['high-atlas']);
  });
});

describe('GET /api/mountains/ranges/:slug', () => {
  it("returns the sourced text and the range's mountains", async () => {
    const response = await call(mountainRange, '/api/mountains/ranges/high-atlas', {
      slug: 'high-atlas',
    });
    const { range } = RangeResponseSchema.parse(await response.json());
    expect(range.description).toContain('Atlas');
    expect(range.rangeType).toBe('fold');
    expect(range.source?.url).toBe('https://en.wikipedia.org/wiki/High_Atlas');
    expect(range.mountains).toHaveLength(range.peakCount);
    expect(range.mountains.every((m) => m.range?.slug === 'high-atlas')).toBe(true);
    expect(range.mountains[0]?.slug).toBe('jbel-toubkal');
  });

  it('404s unknown and malformed slugs', async () => {
    for (const slug of ['no-such-range', 'Bad Slug!']) {
      const response = await call(
        mountainRange,
        `/api/mountains/ranges/${encodeURIComponent(slug)}`,
        {
          slug,
        },
      );
      expect(response.status).toBe(404);
    }
  });
});

describe('GET /api/mountains/export', () => {
  function csvRows(body: string): string[] {
    return body.split('\r\n').filter((line) => line !== '' && !line.startsWith('#'));
  }

  it('exports the whole catalogue as CSV with an attribution block', async () => {
    const response = await call(mountainsExport, '/api/mountains/export');
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="harim-mountains-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const body = await response.text();
    expect(body.startsWith('# Bara La Afrika · Harim: mountains of Africa')).toBe(true);
    expect(body).toMatch(/^# As of: \d{4}-\d{2}-\d{2}/m);
    expect(body).toContain('# Filters: none (the whole catalogue)');
    expect(body).toContain('Contains data from GeoNames (geonames.org), CC BY 4.0');
    expect(body).toMatch(/licence: CC0 1\.0/);
    expect(body).toMatch(/licence: CC BY 4\.0/);
    const [header, ...rows] = csvRows(body);
    expect(header?.split(',').slice(0, 4)).toEqual(['slug', 'name', 'elevation_m', 'elevation_ft']);
    expect(rows).toHaveLength(counted.length);
    expect(rows[0]).toMatch(/^mount-kilimanjaro,Mount Kilimanjaro,5895,19341,/);
  });

  it('respects the filters and quotes fields that need it', async () => {
    const body = await (
      await call(mountainsExport, '/api/mountains/export?minHeight=4001&region=east')
    ).text();
    expect(body).toContain('# Filters: region=east, minHeight=4001');
    const rows = csvRows(body).slice(1);
    const expected = await list('?minHeight=4001&region=east');
    expect(rows).toHaveLength(expected.total);
    // Names with commas or quotes are quoted (RFC 4180).
    const all = await (await call(mountainsExport, '/api/mountains/export')).text();
    for (const line of csvRows(all).slice(1)) {
      expect(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(25);
    }
  });

  it('exports GeoJSON points with the metadata', async () => {
    const response = await call(
      mountainsExport,
      '/api/mountains/export?format=geojson&country=KEN',
    );
    expect(response.headers.get('Content-Type')).toBe('application/geo+json; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /harim-mountains-filtered-.*\.geojson"$/,
    );
    const body = (await response.json()) as {
      type: string;
      metadata: { datasets: unknown[]; attribution: string; filters: Record<string, string> };
      features: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[];
    };
    expect(body.type).toBe('FeatureCollection');
    expect(body.metadata.datasets).toHaveLength(3);
    expect(body.metadata.attribution).toContain('GeoNames');
    expect(body.metadata.filters).toEqual({ country: 'KEN' });
    const kenya = body.features.find((f) => f.properties.slug === 'mount-kenya');
    expect(kenya?.geometry.coordinates).toEqual([37.2, -0.1]);
    expect(kenya?.properties.page).toBe('https://bla.test/harim/peaks/mount-kenya');
    expect(kenya?.properties.volcanic_status).toBe('extinct');
  });

  it('rejects an unknown format', async () => {
    const response = await call(mountainsExport, '/api/mountains/export?format=xlsx');
    expect(response.status).toBe(400);
  });
});

describe('routes', () => {
  it('send every API path to exactly one function', () => {
    const expected: Record<string, string> = {
      '/api/regions': 'regions',
      '/api/countries': 'countries',
      '/api/countries/KEN': 'country',
      '/api/coverage': 'coverage',
      '/api/mountains': 'mountains',
      '/api/mountains/summary': 'mountains-summary',
      '/api/mountains/stats': 'mountains-stats',
      '/api/mountains/mount-kenya': 'mountain',
      '/api/mountains/ranges': 'mountain-ranges',
      '/api/mountains/ranges/rwenzori': 'mountain-range',
      '/api/mountains/export': 'mountains-export',
    };
    for (const [path, name] of Object.entries(expected)) {
      expect(
        matchingFunctions(path).map((m) => m.name),
        path,
      ).toEqual([name]);
    }
    expect(matchingFunctions('/api/nope')).toEqual([]);
  });
});
