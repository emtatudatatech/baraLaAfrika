import type { PGlite } from '@electric-sql/pglite';
import {
  ApiErrorSchema,
  GOLD_SERIES_MAX_POINTS,
  GOLD_STAT_KEYS,
  GoldCountriesResponseSchema,
  GoldCountryResponseSchema,
  GoldHoldingsChangeResponseSchema,
  GoldSeriesResponseSchema,
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
import goldCountry from '../functions/gold-country.ts';
import goldExport from '../functions/gold-export.ts';
import goldHoldingsChange from '../functions/gold-holdings-change.ts';
import goldPrice from '../functions/gold-price.ts';
import goldSeries from '../functions/gold-series.ts';
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

function call(
  handler: Handler,
  path: string,
  params: Record<string, string> = {},
): Promise<Response> {
  return handler(new Request(`https://bla.test${path}`), { params } as unknown as Context);
}

async function series(query: string) {
  const response = await call(goldSeries, `/api/gold/series?${query}`);
  expect(response.status).toBe(200);
  return GoldSeriesResponseSchema.parse(await response.json());
}

/** Exact sums, compared in cents (the API's values are decimal strings turned into numbers). */
const cents = (value: number) => Math.round(value * 100);

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
    expect(west.countries).toHaveLength(16);
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
    expect(card(body.stats, 'gold_producing_countries').detail.countries).toBe(16);
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
    ).toHaveLength(19);
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
    expect(names('/api/gold/series')).toEqual(['gold-series']);
    expect(names('/api/gold/holdings-change')).toEqual(['gold-holdings-change']);
    expect(names('/api/gold/countries/GHA')).toEqual(['gold-country']);
  });
});

describe('GET /api/gold/series', () => {
  it('returns production per country with Africa’s totals and their completeness', async () => {
    const body = await series('metric=production&from=2018&to=2023');
    expect(body.unit).toBe('t');
    expect(body.granularity).toBe('year');
    expect(body.capped).toBe(false);
    const totals = body.totals ?? [];
    expect(totals.map((t) => t.year)).toEqual([2018, 2019, 2020, 2021, 2022, 2023]);
    expect(totals.find((t) => t.year === 2021)?.complete).toBe(true);
    expect(totals.find((t) => t.year === 2023)?.complete).toBe(false);
    // Each total is the sum of the countries' figures for that year.
    const sum2021 = body.series
      .flatMap((s) => s.points)
      .filter((p) => p.period === '2021' && p.value !== null)
      .reduce((total, p) => total + (p.value ?? 0), 0);
    expect(relative(totals.find((t) => t.year === 2021)?.tonnes ?? 0, sum2021)).toBeLessThan(1e-9);
    for (const point of body.series.flatMap((s) => s.points)) {
      // "Included in other" is never a figure.
      if (point.basis === 'included_in_other') expect(point.value).toBeNull();
      else expect(point.value).not.toBeNull();
    }
    const ghana = body.series.find((s) => s.country.iso3 === 'GHA');
    expect(ghana?.points.find((p) => p.period === '2021')?.valueUsd).toBeGreaterThan(0);
  });

  it('returns holdings by month, or each year’s last report', async () => {
    const monthly = await series(
      'metric=holdings_tonnes&countries=DZA&from=2020&to=2021&granularity=month',
    );
    expect(monthly.series).toHaveLength(1);
    expect(monthly.series[0]?.points).toHaveLength(24);
    expect(monthly.totals).toBeNull();
    const yearly = await series('metric=holdings_usd&countries=dza,egy&from=2020&to=2021');
    expect(yearly.unit).toBe('USD');
    expect(yearly.series.map((s) => s.country.iso3)).toEqual(['DZA', 'EGY']);
    expect(yearly.series[0]?.points.map((p) => p.period)).toEqual(['2020-12', '2021-12']);
  });

  it('caps large requests, keeping the latest periods for every series', async () => {
    const body = await series('metric=holdings_tonnes&granularity=month');
    expect(body.capped).toBe(true);
    const points = body.series.flatMap((s) => s.points);
    expect(points.length).toBeLessThanOrEqual(GOLD_SERIES_MAX_POINTS);
    // Algeria's own series, uncapped, ends where the capped one does.
    const algeria = await series('metric=holdings_tonnes&countries=DZA&granularity=month');
    expect(body.series.find((s) => s.country.iso3 === 'DZA')?.points.at(-1)).toEqual(
      algeria.series[0]?.points.at(-1),
    );
  });

  it('rejects a missing metric, too many countries and a reversed range', async () => {
    for (const query of [
      '',
      'metric=production&countries=AAA,BBB,CCC,DDD,EEE,FFF,GGG,HHH,III,JJJ,KKK,LLL,MMM',
      'metric=production&from=2020&to=2010',
    ]) {
      const response = await call(goldSeries, `/api/gold/series?${query}`);
      expect(response.status).toBe(400);
      ApiErrorSchema.parse(await response.json());
    }
  });
});

describe('GET /api/gold/holdings-change', () => {
  it('splits each change into price and volume effects that sum exactly to it', async () => {
    const response = await call(goldHoldingsChange, '/api/gold/holdings-change?from=2016');
    expect(response.status).toBe(200);
    const { changes } = GoldHoldingsChangeResponseSchema.parse(await response.json());
    expect(changes.length).toBeGreaterThan(10);
    for (const change of changes) {
      expect(change.fromMonth < change.toMonth).toBe(true);
      expect(cents(change.valueToUsd) - cents(change.valueFromUsd)).toBe(cents(change.changeUsd));
      if (change.priceEffectUsd === null || change.volumeEffectUsd === null) continue;
      expect(cents(change.priceEffectUsd) + cents(change.volumeEffectUsd)).toBe(
        cents(change.changeUsd),
      );
    }
    // Algeria's tonnes hardly moved, so nearly all of the change is the price.
    const algeria = changes.find((c) => c.country.iso3 === 'DZA');
    expect(algeria?.priceFrom).not.toBeNull();
    expect(Math.abs(algeria?.volumeEffectUsd ?? Infinity)).toBeLessThan(
      Math.abs(algeria?.priceEffectUsd ?? 0) / 10,
    );
  });

  it('agrees with the price effect card', async () => {
    const body = await stats();
    const effect = card(body.stats, 'price_effect');
    const d = effect.detail;
    expect(effect.value).toBe(d.priceEffectUsd);
    expect((d.priceEffectUsd ?? 0) + (d.volumeEffectUsd ?? 0)).toBe(d.changeUsd);
    expect(d.countries).toBeGreaterThan(0);
  });
});

describe('GET /api/gold/countries/:iso3', () => {
  it('returns the drawer: the row, histories, notes and sources', async () => {
    const response = await call(goldCountry, '/api/gold/countries/GHA', { iso3: 'GHA' });
    expect(response.status).toBe(200);
    const { country } = GoldCountryResponseSchema.parse(await response.json());
    const listed = (await countries()).countries.find((c) => c.country.iso3 === 'GHA');
    expect(country.row).toEqual(listed);
    const years = country.production.map((p) => p.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(country.trade.length).toBeGreaterThan(0);
    expect(country.holdings.length).toBeGreaterThan(10);
    expect(country.notes.length).toBeGreaterThan(0);
    expect(country.sources.map((s) => s.usedFor).flat()).toEqual(
      expect.arrayContaining(['presence', 'production', 'trade', 'holdings', 'notes']),
    );
    expect(country.latestPrice?.usdPerOz).toBeGreaterThan(0);
  });

  it('follows the reference year for the row', async () => {
    const response = await call(goldCountry, '/api/gold/countries/ZAF?year=2015', {
      iso3: 'ZAF',
    });
    const { year, country } = GoldCountryResponseSchema.parse(await response.json());
    expect(year).toBe(2015);
    expect(country.row.production?.year).toBe(2015);
  });

  it('is 404 for an unknown or malformed code', async () => {
    for (const iso3 of ['XYZ', 'gh', 'GHANA']) {
      const response = await call(goldCountry, `/api/gold/countries/${iso3}`, { iso3 });
      expect(response.status).toBe(404);
    }
  });
});
