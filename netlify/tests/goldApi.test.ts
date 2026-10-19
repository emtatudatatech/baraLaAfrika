import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  GOLD_STAT_KEYS,
  GoldCountriesResponseSchema,
  type GoldCountry,
  GoldPriceResponseSchema,
  GoldStatsResponseSchema,
  type GoldStat,
  TROY_OZ_PER_TONNE,
  sortGoldCountries,
} from '@bla/shared';
import type { Context } from '@netlify/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seededDb } from '../../db/tests/seededDb.ts';
import goldCountries from '../functions/gold-countries.ts';
import goldExport from '../functions/gold-export.ts';
import goldPrice from '../functions/gold-price.ts';
import goldStats from '../functions/gold-stats.ts';
import { setDbForTesting } from '../functions/_shared/db.ts';
import { matchingFunctions } from './functionRoutes.ts';

let pg: PGlite;

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

type Handler = (request: Request, context: Context) => Promise<Response>;

function call(handler: Handler, path: string): Promise<Response> {
  return handler(new Request(`https://bla.test${path}`), { params: {} } as unknown as Context);
}

async function countries(query = '') {
  const response = await call(goldCountries, `/api/gold/countries${query}`);
  expect(response.status).toBe(200);
  return GoldCountriesResponseSchema.parse(await response.json());
}

async function stats(query = '') {
  const response = await call(goldStats, `/api/gold/stats${query}`);
  expect(response.status).toBe(200);
  return GoldStatsResponseSchema.parse(await response.json());
}

const relative = (a: number, b: number) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b));

function card<K extends GoldStat['key']>(list: readonly GoldStat[], key: K) {
  const found = list.find((s) => s.key === key);
  if (!found) throw new Error(`no ${key} card`);
  return found as Extract<GoldStat, { key: K }>;
}

describe('GET /api/gold/countries', () => {
  it('returns all 54 countries with a presence tier and dated figures', async () => {
    const body = await countries();
    expect(body.year).toBeNull();
    expect(body.countries).toHaveLength(54);
    const ghana = body.countries.find((c) => c.country.iso3 === 'GHA');
    expect(ghana?.presence.tier).toBe('major_producer');
    expect(ghana?.production?.year).toBeGreaterThanOrEqual(2024);
    expect(ghana?.holdings?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ghana?.exports.reported?.year).toBeTypeOf('number');
    expect(ghana?.exports.mirror?.partnerCount).toBeGreaterThan(0);
  });

  it('keeps no data apart from zero', async () => {
    const body = await countries();
    const tunisia = body.countries.find((c) => c.country.iso3 === 'TUN');
    expect(tunisia?.presence.tier).toBe('none_identified');
    expect(tunisia?.production).toBeNull(); // no data, never 0
    const kenya = body.countries.find((c) => c.country.iso3 === 'KEN');
    expect(kenya?.holdings?.tonnes).toBe(0); // a reported zero
    const mali = body.countries.find((c) => c.country.iso3 === 'MLI');
    expect(mali?.holdings).toBeNull();
    expect(mali?.reporting?.status).toBe('pooled');
  });

  it('values production at its own year and never reports "included in other" as a figure', async () => {
    const body = await countries();
    for (const row of body.countries) {
      const p = row.production;
      if (p === null) continue;
      if (p.basis === 'included_in_other') expect(p.tonnes).toBeNull();
      if (p.tonnes !== null && p.valueUsd !== null && p.priceUsdPerOz !== null) {
        // The price is shown rounded to cents; the value uses the exact annual mean.
        expect(relative(p.valueUsd, p.tonnes * TROY_OZ_PER_TONNE * p.priceUsdPerOz)).toBeLessThan(
          1e-5,
        );
      }
    }
  });

  it('takes each figure in or before the reference year', async () => {
    const body = await countries('?year=2019');
    expect(body.year).toBe(2019);
    for (const row of body.countries) {
      if (row.production) expect(row.production.year).toBeLessThanOrEqual(2019);
      if (row.holdings) expect(row.holdings.asOf <= '2019-12-31').toBe(true);
      if (row.exports.reported) expect(row.exports.reported.year).toBeLessThanOrEqual(2019);
      if (row.exportShare) expect(row.exportShare.year).toBeLessThanOrEqual(2019);
    }
  });

  it('filters by region, presence and search', async () => {
    const west = await countries('?region=west');
    expect(west.countries).toHaveLength(15);
    const none = await countries('?presence=none_identified');
    expect(none.countries.every((c) => c.presence.tier === 'none_identified')).toBe(true);
    const search = await countries('?q=cote');
    expect(search.countries.map((c) => c.country.iso3)).toEqual(['CIV']);
  });

  it('sorts figures largest first with missing figures last in both directions', async () => {
    const down = (await countries('?sort=production')).countries;
    const up = (await countries('?sort=-production')).countries;
    const tonnes = (rows: readonly GoldCountry[]) => rows.map((r) => r.production?.tonnes ?? null);
    const known = (values: (number | null)[]) => values.filter((v): v is number => v !== null);
    expect(known(tonnes(down))).toEqual([...known(tonnes(down))].sort((a, b) => b - a));
    expect(known(tonnes(up))).toEqual([...known(tonnes(up))].sort((a, b) => a - b));
    expect(tonnes(down).at(-1)).toBeNull();
    expect(tonnes(up).at(-1)).toBeNull();
    expect(sortGoldCountries(down, 'name')[0]?.country.name).toBe('Algeria');
  });

  it('rejects invalid parameters with the error shape', async () => {
    for (const query of ['?year=abc', '?presence=lots', '?sort=size', '?region=mars']) {
      const response = await call(goldCountries, `/api/gold/countries${query}`);
      expect(response.status).toBe(400);
      ApiErrorSchema.parse(await response.json());
    }
  });
});

describe('GET /api/gold/stats', () => {
  it('returns every card, valid against the schema, in order', async () => {
    const body = await stats();
    expect(body.stats.map((s) => s.key)).toEqual([...GOLD_STAT_KEYS]);
    expect(body.stats.every((s) => s.scope === null)).toBe(true);
  });

  it('counts producers from the presence tiers', async () => {
    const body = await stats();
    const producing = card(body.stats, 'gold_producing_countries');
    const d = producing.detail;
    expect(producing.value).toBe(d.majorProducer + d.producer);
    expect(d.majorProducer + d.producer + d.occurrencesKnown + d.noneIdentified + d.unknown).toBe(
      54,
    );
  });

  it("sums production in the latest complete year, valued at that year's price", async () => {
    const body = await stats();
    const production = card(body.stats, 'africa_production');
    const value = card(body.stats, 'production_value');
    const year = production.detail.year;
    expect(year).not.toBeNull();
    // Newer years cover only the producers the USGS names, so they are not "complete".
    expect(year).toBeLessThan(production.detail.newestYear ?? 0);
    expect(production.detail.missingCountries).toBe(0);
    expect(value.detail.year).toBe(year);
    expect(
      relative(
        value.value ?? 0,
        (production.value ?? 0) * TROY_OZ_PER_TONNE * (value.detail.priceUsdPerOz ?? 0),
      ),
    ).toBeLessThan(1e-4); // the card shows tonnes to 0.1 t
    const largest = card(body.stats, 'largest_producer');
    expect(largest.entities.length).toBeGreaterThan(0);
    expect(largest.detail.sharePct).toBeCloseTo(
      (100 * (largest.value ?? 0)) / (production.value ?? 1),
      0,
    );
  });

  it('follows the reference year and the region', async () => {
    const body = await stats('?region=west&year=2019');
    expect(body.year).toBe(2019);
    expect(body.stats.every((s) => s.scope === 'west')).toBe(true);
    for (const stat of body.stats) {
      if (stat.asOf !== null) expect(stat.asOf <= '2019-12-31').toBe(true);
    }
    expect(card(body.stats, 'gold_producing_countries').detail.countries).toBe(15);
    expect(card(body.stats, 'gold_price').detail.month).toBe('2019-12-01');
  });

  it('describes the reporting gap neutrally and the net buyer honestly', async () => {
    const body = await stats();
    const gap = card(body.stats, 'biggest_reporting_gap');
    expect(gap.definition).toContain('not evidence of wrongdoing');
    for (const entity of gap.entities) {
      expect(entity.gapUsd).toBeCloseTo(entity.mirrorUsd - entity.reportedUsd, -1);
    }
    const buyer = card(body.stats, 'largest_net_buyer');
    expect(buyer.detail.noNetBuyer).toBe(buyer.entities.length === 0);
    // The headline is the named country's own change, not a coarser rounding of it.
    for (const entity of buyer.entities) expect(entity.changeTonnes).toBe(buyer.value);
  });
});

describe('GET /api/gold/export', () => {
  it('downloads the table as CSV with the required attributions and notes', async () => {
    const response = await call(goldExport, '/api/gold/export?format=csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toMatch(/dhahabu-countries-.*\.csv/);
    const text = await response.text();
    const lines = text.trimEnd().split('\r\n');
    const meta = lines.filter((line) => line.startsWith('# '));
    expect(
      meta.some((l) =>
        l.includes('Source: International Monetary Fund, International Liquidity (IL)'),
      ),
    ).toBe(true);
    expect(meta.some((l) => l.includes('Transformed by Bara La Afrika'))).toBe(true);
    expect(meta.some((l) => l.includes('nominal US dollars'))).toBe(true);
    expect(meta.some((l) => l.includes('computed'))).toBe(true);
    const rows = lines.filter((line) => !line.startsWith('# '));
    expect(rows[0]).toContain('production_value_usd_computed');
    expect(rows).toHaveLength(55);
  });

  it('respects the filters', async () => {
    const response = await call(goldExport, '/api/gold/export?region=east&year=2020');
    const text = await response.text();
    expect(text).toContain('# Filters: region=east, year=2020');
    expect(text).toContain('# Reference year: 2020');
    expect(
      text
        .trimEnd()
        .split('\r\n')
        .filter((l) => !l.startsWith('# ')),
    ).toHaveLength(17);
  });
});

describe('GET /api/gold/price', () => {
  it('returns the monthly average and annual means within the years', async () => {
    const monthly = GoldPriceResponseSchema.parse(
      await (await call(goldPrice, '/api/gold/price?from=2024&to=2024')).json(),
    );
    expect(monthly.points).toHaveLength(12);
    expect(monthly.points[0]?.period).toBe('2024-01');
    expect(monthly.source).toContain('World Bank');
    const yearly = GoldPriceResponseSchema.parse(
      await (await call(goldPrice, '/api/gold/price?granularity=year&from=2020&to=2021')).json(),
    );
    expect(yearly.points.map((p) => [p.period, p.months])).toEqual([
      ['2020', 12],
      ['2021', 12],
    ]);
  });

  it('rejects a reversed range', async () => {
    const response = await call(goldPrice, '/api/gold/price?from=2024&to=2020');
    expect(response.status).toBe(400);
  });
});

describe('routing', () => {
  it('routes each gold path to its function', () => {
    const names = (path: string) => matchingFunctions(path).map((m) => m.name);
    expect(names('/api/gold/countries')).toEqual(['gold-countries']);
    expect(names('/api/gold/stats')).toEqual(['gold-stats']);
    expect(names('/api/gold/export')).toEqual(['gold-export']);
    expect(names('/api/gold/price')).toEqual(['gold-price']);
  });
});
