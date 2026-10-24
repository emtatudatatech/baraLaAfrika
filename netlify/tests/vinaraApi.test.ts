import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  VINARA_METRICS,
  VinaraCountryResponseSchema,
  VinaraMetricResponseSchema,
  VinaraResponseSchema,
} from '@bla/shared';
import type { Context } from '@netlify/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, seededDb } from '../../db/tests/seededDb.ts';
import vinara from '../functions/vinara.ts';
import vinaraCountry from '../functions/vinara-country.ts';
import vinaraExport from '../functions/vinara-export.ts';
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

describe('GET /api/vinara/countries/:iso3', () => {
  async function country(iso3: string, query = '') {
    const response = await call(vinaraCountry, `/api/vinara/countries/${iso3}${query}`, { iso3 });
    expect(response.status).toBe(200);
    return VinaraCountryResponseSchema.parse(await response.json());
  }

  it('ranks the state on every measure, in Africa and in its region', async () => {
    const nigeria = await country('NGA');
    expect(nigeria.country).toEqual({
      iso3: 'NGA',
      name: 'Nigeria',
      region: { slug: 'west', name: 'Western Africa' },
    });
    expect(nigeria.measures.map((m) => m.key)).toEqual([...VINARA_METRICS]);
    const population = nigeria.measures.find((m) => m.key === 'population');
    expect(population).toMatchObject({
      rankAfrica: 1,
      rankedAfrica: 54,
      rankRegion: 1,
      rankedRegion: 16,
    });
    for (const m of nigeria.measures) {
      if (m.rankAfrica === null) {
        expect(m.value).toBeNull();
        expect(m.unrankedReason).not.toBeNull();
      } else {
        expect(m.rankRegion).not.toBeNull();
        expect(m.rankRegion ?? 0).toBeLessThanOrEqual(m.rankAfrica);
        expect(m.unrankedReason).toBeNull();
      }
    }
  }, 60_000);

  it('the cardinal of a region ranks first in it, and the windows follow the years asked for', async () => {
    const kenya = await country('KEN', '?from=2018&to=2022');
    const gdp = kenya.measures.find((m) => m.key === 'gdp_usd');
    expect(gdp?.window).toEqual({ from: 2018, to: 2022, isDefault: false });
    expect(gdp?.year).toBe(2022);
    const east = await call(vinara, '/api/vinara?region=east&from=2018&to=2022');
    const cardinal = VinaraResponseSchema.parse(await east.json()).metrics.find(
      (m) => m.key === 'gdp_usd',
    )?.cardinals[0]?.iso3;
    if (cardinal === 'KEN') expect(gdp?.rankRegion).toBe(1);
    else expect(gdp?.rankRegion).toBeGreaterThan(1);
  }, 60_000);

  it('gives context, public external debt by creditor and the currency', async () => {
    const kenya = await country('KEN');
    expect(kenya.context.map((c) => c.key)).toContain('population_growth');
    expect(kenya.debt).not.toBeNull();
    const debt = kenya.debt;
    if (debt !== null) {
      expect(debt.creditors.length).toBeLessThanOrEqual(8);
      const listed = debt.creditors.reduce((sum, c) => sum + c.amountUsd, 0);
      expect(listed + debt.othersUsd).toBeCloseTo(debt.totalUsd, -1);
      const amounts = debt.creditors.map((c) => c.amountUsd);
      expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    }
    expect(kenya.currency).toMatchObject({ code: 'KES', peg: null });
    expect(kenya.currency?.daily?.basis).toBe('central_bank');
    // A currency fixed to the euro, with daily rates derived from the ECB's.
    const senegal = await country('SEN');
    expect(senegal.currency?.peg?.anchor).toBe('EUR');
    expect(senegal.currency?.unionName).not.toBeNull();
    // Outside the World Bank's debt statistics: no debt, never zero.
    const libya = await country('LBY');
    expect(libya.debt).toBeNull();
  }, 60_000);

  it('says why a state takes no part', async () => {
    const somalia = await country('SOM');
    const performance = somalia.measures.find((m) => m.key === 'currency_performance');
    expect(performance).toMatchObject({ value: null, rankAfrica: null });
    expect(performance?.unrankedReason).toMatch(/exchange rate/i);
  }, 60_000);

  it('is 404 for an unknown or malformed code', async () => {
    for (const iso3 of ['XXX', 'ke', 'KENYA']) {
      const response = await call(vinaraCountry, `/api/vinara/countries/${iso3}`, { iso3 });
      expect(response.status).toBe(404);
    }
  });
});

describe('GET /api/vinara/export', () => {
  it('lists every measure and state as CSV, after the notes, definitions and attributions', async () => {
    const response = await call(vinaraExport, '/api/vinara/export?format=csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toMatch(
      /vinara-africa-\d{4}-\d{2}-\d{2}\.csv/,
    );
    const body = await response.text();
    const lines = body.trimEnd().split('\r\n');
    expect(lines[0]).toBe('# Bara La Afrika · Vinara: the cardinals of Africa');
    const header = lines.findIndex((line) => !line.startsWith('#'));
    expect(lines[header]).toBe(
      'metric,metric_name,unit,window_from,window_to,rank,iso3,country,region,value,year,imf_estimate,not_ranked_reason',
    );
    expect(lines.length - header - 1).toBe(13 * 54);
    expect(body).toContain('# Definitions:');
    expect(body).toContain('ECB statistics');
    expect(body).toContain('Source: World Bank, World Development Indicators');
    expect(body).toContain('population,Population,people,2016,2025,1,NGA,Nigeria,Western Africa,');
  }, 60_000);

  it('follows the region and years asked for', async () => {
    const response = await call(vinaraExport, '/api/vinara/export?region=east&from=2018&to=2022');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('vinara-east-2018-2022-');
    const lines = (await response.text()).trimEnd().split('\r\n');
    const rows = lines.filter((line) => !line.startsWith('#')).slice(1);
    expect(rows).toHaveLength(13 * 18);
    expect(rows.every((row) => row.includes('Eastern Africa'))).toBe(true);
    expect(lines).toContain('# Scope: Eastern Africa');
  }, 60_000);

  it('rejects a reversed range', async () => {
    const response = await call(vinaraExport, '/api/vinara/export?from=2022&to=2018');
    expect(response.status).toBe(400);
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
    expect(names('/api/vinara/countries/KEN')).toEqual(['vinara-country']);
    expect(names('/api/vinara/export')).toEqual(['vinara-export']);
  });
});
