import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  VINARA_METRICS,
  VinaraMetricResponseSchema,
  VinaraResponseSchema,
} from '@bla/shared';
import type { Context } from '@netlify/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, seededDb } from '../../db/tests/seededDb.ts';
import vinara from '../functions/vinara.ts';
import vinaraMetric from '../functions/vinara-metric.ts';
import { setDbForTesting } from '../functions/_shared/db.ts';
import { matchingFunctions } from './functionRoutes.ts';

type Handler = (request: Request, context: Context) => Promise<Response>;

function use(pg: PGlite) {
  setDbForTesting({
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      return (await pg.query<Row>(text, [...params])).rows;
    },
  });
}

function call(handler: Handler, path: string, params: Record<string, string> = {}) {
  return handler(new Request(`https://bla.test${path}`), { params } as unknown as Context);
}

async function errorCode(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error.code;
}

let pg: PGlite;

beforeAll(async () => {
  pg = await seededDb();
  use(pg);
}, 60_000);

afterAll(() => {
  setDbForTesting(undefined);
});

describe('GET /api/vinara', () => {
  it('returns every metric for Africa, with the regions compared', async () => {
    const response = await call(vinara, '/api/vinara');
    expect(response.status).toBe(200);
    const body = VinaraResponseSchema.parse(await response.json());
    expect(body.region).toBeNull();
    expect(body.metrics.map((m) => m.key)).toEqual([...VINARA_METRICS]);
    for (const metric of body.metrics) {
      expect(metric.window.isDefault).toBe(true);
      expect(metric.ranked + metric.unranked.length).toBe(54);
      expect(metric.regions?.values).toHaveLength(5);
      // A signal only between one cardinal and one contender.
      if (metric.cardinals.length !== 1 || metric.contenders.length !== 1) {
        expect(metric.signal).toBeNull();
      }
    }
    expect(body.metrics[0]?.cardinals.map((e) => e.iso3)).toEqual(['NGA']);
  }, 60_000);

  it('ranks within one region over the years asked for', async () => {
    const response = await call(vinara, '/api/vinara?region=east&from=2018&to=2022');
    expect(response.status).toBe(200);
    const body = VinaraResponseSchema.parse(await response.json());
    expect(body.region).toBe('east');
    const gdp = body.metrics.find((m) => m.key === 'gdp_usd');
    expect(gdp?.window).toEqual({ from: 2018, to: 2022, isDefault: false });
    expect(gdp?.regions).toBeNull();
    for (const metric of body.metrics) {
      for (const entity of [...metric.cardinals, ...metric.contenders]) {
        expect(entity.region).toBe('east');
      }
      expect(metric.ranked + metric.unranked.length).toBe(18);
    }
  }, 60_000);

  it('rejects an unknown region and a reversed range with a 400', async () => {
    for (const query of ['region=atlantis', 'from=2022&to=2018', 'from=abc']) {
      const response = await call(vinara, `/api/vinara?${query}`);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('bad_request');
    }
  });
});

describe('GET /api/vinara/metrics/:key', () => {
  it('returns one metric’s full ranking, its regions and the leaders’ yearly values', async () => {
    const response = await call(vinaraMetric, '/api/vinara/metrics/gdp_usd', { key: 'gdp_usd' });
    expect(response.status).toBe(200);
    const body = VinaraMetricResponseSchema.parse(await response.json());
    expect(body.metric.key).toBe('gdp_usd');
    expect(body.ranking.length).toBe(body.metric.ranked);
    const ranks = body.ranking.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(body.ranking[0]?.iso3).toBe(body.metric.cardinals[0]?.iso3);
    expect(body.regions).toHaveLength(5);
    expect(body.series.map((s) => s.role)).toEqual(['cardinal', 'contender']);
    for (const s of body.series) {
      expect(s.points.length).toBeGreaterThan(0);
      for (const p of s.points) {
        expect(p.year).toBeGreaterThanOrEqual(body.metric.window.from);
        expect(p.year).toBeLessThanOrEqual(body.metric.window.to);
      }
    }
  }, 60_000);

  it('gives no regions for one region', async () => {
    const response = await call(vinaraMetric, '/api/vinara/metrics/hdi?region=north', {
      key: 'hdi',
    });
    const body = VinaraMetricResponseSchema.parse(await response.json());
    expect(body.regions).toBeNull();
    expect(body.ranking.every((r) => r.region === 'north')).toBe(true);
  }, 60_000);

  it('is 404 for an unknown metric', async () => {
    const response = await call(vinaraMetric, '/api/vinara/metrics/happiness', {
      key: 'happiness',
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
  });
});

describe('before the indicators are loaded', () => {
  it('answers 503 rather than an empty ranking', async () => {
    use(await migratedDb());
    try {
      const response = await call(vinara, '/api/vinara');
      expect(response.status).toBe(503);
      const metric = await call(vinaraMetric, '/api/vinara/metrics/hdi', { key: 'hdi' });
      expect(metric.status).toBe(503);
    } finally {
      use(pg);
    }
  }, 60_000);
});

describe('routing', () => {
  it('routes each Vinara path to its function', () => {
    const names = (path: string) => matchingFunctions(path).map((m) => m.name);
    expect(names('/api/vinara')).toEqual(['vinara']);
    expect(names('/api/vinara/metrics/gdp_usd')).toEqual(['vinara-metric']);
  });
});
