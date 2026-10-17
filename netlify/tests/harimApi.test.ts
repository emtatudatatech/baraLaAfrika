import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  HARIM_STAT_KEYS,
  HarimStatsResponseSchema,
  MountainResponseSchema,
  MountainSummaryResponseSchema,
  MountainsResponseSchema,
  REGION_SLUGS,
} from '@bla/shared';
import type { Context } from '@netlify/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readJson, seededDb } from '../../db/tests/seededDb.ts';
import mountain from '../functions/mountain.ts';
import mountains from '../functions/mountains.ts';
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
    expect(east.count).toBe(16);
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
