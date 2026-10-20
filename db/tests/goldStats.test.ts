import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { migratedDb } from './seededDb.ts';

/*
 * v_gold_stats and gold_country_metrics (0008_dhahabu_api.sql) on a small fixture:
 * three West African countries (AAA, BBB, CCC) and one East African (DDD).
 */

interface StatRow {
  key: string;
  value: string | null;
  as_of: string | null;
  detail: Record<string, unknown>;
  entities: Record<string, unknown>[];
  definition: string;
}

async function fixture(): Promise<PGlite> {
  const db = await migratedDb();
  await db.exec(`
    INSERT INTO regions (slug, name, sort_order) VALUES ('west', 'West Africa', 1), ('east', 'East Africa', 2);
    INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
    SELECT v.iso2, v.iso3, v.num, v.name, r.id, 'https://flagcdn.com/w{width}/' || lower(v.iso2) || '.png'
    FROM (VALUES ('AA', 'AAA', 1, 'Aland', 'west'), ('BB', 'BBB', 2, 'Bland', 'west'),
                 ('CC', 'CCC', 3, 'Cland', 'west'), ('DD', 'DDD', 4, 'Dland', 'east'))
      AS v(iso2, iso3, num, name, region)
    JOIN regions r ON r.slug = v.region;
    INSERT INTO sources (source_key, title, url, source_type, reliability_tier) VALUES
      ('price', 'Price', 'https://p.test', 'statistics', 'primary'),
      ('usgs', 'USGS', 'https://u.test', 'statistics', 'primary'),
      ('imf', 'IMF', 'https://i.test', 'statistics', 'primary'),
      ('trade', 'Comtrade', 'https://c.test', 'statistics', 'primary');
    INSERT INTO gold_production_source_priority (source_id, priority)
      SELECT id, 1 FROM sources WHERE source_key = 'usgs';
    -- 2,000 US$/oz every month of 2019–2021.
    INSERT INTO gold_price_monthly (month, usd_per_troy_oz, source_id)
      SELECT m::date, 2000, (SELECT id FROM sources WHERE source_key = 'price')
      FROM generate_series('2019-01-01'::date, '2021-12-01', interval '1 month') m;
    INSERT INTO country_gold_profiles (country_id, presence_tier, presence_basis, presence_confidence,
      presence_source_id, summary)
    SELECT c.id, v.tier::gold_presence_tier, 'b', 'high', (SELECT id FROM sources WHERE source_key = 'usgs'), 's'
    FROM (VALUES ('AAA', 'major_producer'), ('BBB', 'producer'), ('CCC', 'none_identified'),
                 ('DDD', 'producer')) AS v(iso3, tier)
    JOIN countries c ON c.iso3 = v.iso3;
  `);
  // Production: AAA 100 t (2019–2021); BBB 10 t in 2019–2020, none in 2021 (so 2021 misses ~9%);
  // CCC lumped into "other countries" only; DDD 1 t in 2020.
  await db.exec(`
    INSERT INTO gold_production_annual (country_id, year, tonnes, basis, source_id)
    SELECT c.id, v.year, v.tonnes, v.basis::gold_production_basis, (SELECT id FROM sources WHERE source_key = 'usgs')
    FROM (VALUES ('AAA', 2019, 100, 'reported'), ('AAA', 2020, 100, 'reported'),
                 ('AAA', 2021, 100, 'reported'), ('BBB', 2019, 10, 'reported'),
                 ('BBB', 2020, 10, 'estimate'), ('CCC', 2021, NULL, 'included_in_other'),
                 ('DDD', 2020, 1, 'reported'))
      AS v(iso3, year, tonnes, basis)
    JOIN countries c ON c.iso3 = v.iso3;
    INSERT INTO gold_world_production (year, tonnes, basis, source_id)
      SELECT 2020, 3000, 'reported', id FROM sources WHERE source_key = 'usgs';
  `);
  // Holdings: AAA 10 t a year ago, 12 t now; BBB 5 t falling to 4 t; DDD stale (2019).
  await db.exec(`
    INSERT INTO gold_official_reserves (country_id, as_of, tonnes, value_usd, pct_of_total_reserves,
      valuation, source_id)
    SELECT c.id, v.as_of::date, v.tonnes, v.tonnes * 32150.7466 * 2000, 10, 'computed',
      (SELECT id FROM sources WHERE source_key = 'imf')
    FROM (VALUES ('AAA', '2020-12-31', 10), ('AAA', '2021-12-31', 12), ('BBB', '2020-12-31', 5),
                 ('BBB', '2021-12-31', 4), ('DDD', '2019-06-30', 50))
      AS v(iso3, as_of, tonnes)
    JOIN countries c ON c.iso3 = v.iso3;
  `);
  // Trade: AAA reports $1bn of $2bn exports, partners $3bn; BBB reports $5m but its total is
  // $4m (inconsistent); CCC only has partners' reports.
  await db.exec(`
    INSERT INTO gold_trade_annual (country_id, year, flow, hs_code, value_usd, basis, partner_count,
      source_id)
    SELECT c.id, v.year, 'export', '7108.1', v.value, v.basis::gold_trade_basis, v.partners,
      (SELECT id FROM sources WHERE source_key = 'trade')
    FROM (VALUES ('AAA', 2020, 1e9, 'reported', NULL), ('AAA', 2020, 3e9, 'mirror', 4),
                 ('AAA', 2021, 1.1e9, 'reported', NULL), ('BBB', 2020, 5e6, 'reported', NULL),
                 ('CCC', 2020, 7e8, 'mirror', 2))
      AS v(iso3, year, value, basis, partners)
    JOIN countries c ON c.iso3 = v.iso3;
    INSERT INTO country_total_exports_annual (country_id, year, value_usd, source_id)
    SELECT c.id, v.year, v.value, (SELECT id FROM sources WHERE source_key = 'trade')
    FROM (VALUES ('AAA', 2020, 2e9), ('BBB', 2020, 4e6)) AS v(iso3, year, value)
    JOIN countries c ON c.iso3 = v.iso3;
  `);
  return db;
}

async function stats(db: PGlite, region: string | null = null, year: number | null = null) {
  const result = await db.query<StatRow>(
    `SELECT key, value::text, as_of::text, detail, entities, definition
     FROM v_gold_stats($1::text, $2::int)`,
    [region, year],
  );
  return Object.fromEntries(result.rows.map((row) => [row.key, row]));
}

describe('v_gold_stats', () => {
  let db: PGlite;
  let all: Record<string, StatRow>;

  beforeAll(async () => {
    db = await fixture();
    all = await stats(db);
  });

  it('uses the latest complete production year, never a partial total', async () => {
    const years = await db.query<{ year: number; is_complete: boolean; missing_tonnes: string }>(
      'SELECT year, is_complete, missing_tonnes::text FROM gold_production_years() ORDER BY year',
    );
    expect(years.rows.map((r) => [r.year, r.is_complete])).toEqual([
      [2019, true],
      [2020, true],
      [2021, false], // BBB's ~10 t is missing: 9% of the total
    ]);
    const production = all.africa_production;
    expect(Number(production?.value)).toBe(111); // 2020: 100 + 10 + 1
    expect(production?.as_of).toBe('2020-12-31');
    expect(production?.detail).toMatchObject({
      year: 2020,
      worldSharePct: 3.7,
      previousYear: 2019,
      changeTonnes: 1,
      newestYear: 2021,
    });
    // Valued at that year's price, and only with all twelve months.
    expect(Number(all.production_value?.value)).toBe(Math.round(111 * 32150.7466 * 2000));
  });

  it('follows the reference year and the region', async () => {
    const west2019 = await stats(db, 'west', 2019);
    expect(Number(west2019.africa_production?.value)).toBe(110);
    expect(west2019.africa_production?.detail.previousYear).toBeNull();
    expect(Number(west2019.gold_producing_countries?.value)).toBe(2);
    const east = await stats(db, 'east');
    expect(Number(east.africa_production?.value)).toBe(1);
    expect(east.largest_producer?.entities).toEqual([
      { kind: 'country', iso3: 'DDD', name: 'Dland', tonnes: 1, estimate: false },
    ]);
  });

  it('counts current central bank holdings and leaves stale reporters out', () => {
    expect(Number(all.central_bank_gold?.value)).toBe(16); // AAA 12 + BBB 4; DDD (2019) is stale
    expect(all.central_bank_gold?.detail).toMatchObject({ reporting: 2, notCurrent: 2 });
    expect(all.largest_holder?.entities.map((e) => e.iso3)).toEqual(['AAA']);
    expect(Number(all.largest_net_buyer?.value)).toBe(2);
  });

  it('says so when no central bank bought gold', async () => {
    const west = await stats(db, 'west', 2021);
    expect(west.largest_net_buyer?.detail).toMatchObject({ noNetBuyer: false });
    await db.query(
      `UPDATE gold_official_reserves SET tonnes = 9
       WHERE as_of = '2021-12-31' AND country_id = (SELECT id FROM countries WHERE iso3 = 'AAA')`,
    );
    const after = await stats(db);
    expect(after.largest_net_buyer?.value).toBeNull();
    expect(after.largest_net_buyer?.detail).toMatchObject({ noNetBuyer: true });
    await db.query(
      `UPDATE gold_official_reserves SET tonnes = 12
       WHERE as_of = '2021-12-31' AND country_id = (SELECT id FROM countries WHERE iso3 = 'AAA')`,
    );
  });

  it('measures the reporting gap only where both reports exist', () => {
    const gap = all.biggest_reporting_gap;
    expect(Number(gap?.value)).toBe(2e9); // AAA 2020: partners $3bn, reported $1bn
    expect(gap?.entities.map((e) => e.iso3)).toEqual(['AAA']); // CCC reports nothing: no gap
    expect(gap?.definition).toContain('not evidence of wrongdoing');
  });

  it('takes gold dependence from one year for both parts and skips inconsistent data', () => {
    const dependent = all.most_gold_dependent;
    expect(Number(dependent?.value)).toBe(50);
    expect(dependent?.entities.map((e) => e.iso3)).toEqual(['AAA']); // BBB's gold > its total
  });

  it('documents every statistic, word for word, in docs/dhahabu-stats.md', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'dhahabu-stats.md'),
      'utf8',
    );
    for (const row of Object.values(all)) {
      expect(docs).toContain(`\`${row.key}\``);
      expect(docs).toContain(row.definition);
    }
  });
});

describe('the price effect (gold_price_effect, gold_holdings_change and card 11)', () => {
  let db: PGlite;
  const k = 32150.7466;

  beforeAll(async () => {
    db = await fixture();
    // The price rises from 2,000 to 2,500 US$/oz in December 2021; values follow (computed).
    await db.exec(`
      UPDATE gold_price_monthly SET usd_per_troy_oz = 2500 WHERE month = '2021-12-01';
      UPDATE gold_official_reserves SET value_usd = tonnes * 32150.7466 * 2500
      WHERE as_of = '2021-12-31';
    `);
  });

  it('splits a change into price and volume effects that sum exactly to it', async () => {
    const result = await db.query<{
      iso3: string;
      change_usd: string;
      price_effect_usd: string;
      volume_effect_usd: string;
    }>(
      `SELECT iso3, change_usd::text, price_effect_usd::text, volume_effect_usd::text
       FROM gold_holdings_change(NULL, '2020-01-01', '2021-12-31')`,
    );
    // DDD has a single report in the window: no change to split.
    expect(result.rows.map((r) => r.iso3)).toEqual(['AAA', 'BBB']);
    const [aaa, bbb] = result.rows;
    // AAA: 10 t at 2,000 → 12 t at 2,500.
    expect(Number(aaa?.change_usd)).toBeCloseTo(k * (12 * 2500 - 10 * 2000), 2);
    expect(Number(aaa?.price_effect_usd)).toBeCloseTo(500 * k * 11, 2);
    expect(Number(aaa?.volume_effect_usd)).toBeCloseTo(2 * k * 2250, 2);
    // BBB sold a tonne as the price rose: the value is unchanged, the effects cancel.
    expect(Number(bbb?.change_usd)).toBe(0);
    expect(Number(bbb?.price_effect_usd)).toBeCloseTo(500 * k * 4.5, 2);
    for (const row of result.rows) {
      // Exact in the database's decimal arithmetic (compared as cents).
      expect(
        Math.round(Number(row.price_effect_usd) * 100) +
          Math.round(Number(row.volume_effect_usd) * 100),
      ).toBe(Math.round(Number(row.change_usd) * 100));
    }
  });

  it('is independent of which effect is counted first', async () => {
    const forward = await db.query<{ v: string }>(
      'SELECT gold_price_effect(10, 12, 2000, 2500)::text AS v',
    );
    const backward = await db.query<{ v: string }>(
      'SELECT gold_price_effect(12, 10, 2500, 2000)::text AS v',
    );
    expect(Number(forward.rows[0]?.v)).toBeCloseTo(-Number(backward.rows[0]?.v), 2);
  });

  it('leaves the split empty when a month has no price', async () => {
    const result = await db.query<{ price: string | null; volume: string | null }>(
      `SELECT price_effect_usd::text AS price, volume_effect_usd::text AS volume
       FROM gold_holdings_change(ARRAY['AAA'], '2020-01-01', '2022-12-31')`,
    );
    expect(result.rows[0]?.price).not.toBeNull();
    await db.query(`DELETE FROM gold_price_monthly WHERE month = '2021-12-01'`);
    const missing = await db.query<{ price: string | null; volume: string | null }>(
      `SELECT price_effect_usd::text AS price, volume_effect_usd::text AS volume
       FROM gold_holdings_change(ARRAY['AAA'], '2020-01-01', '2022-12-31')`,
    );
    expect(missing.rows[0]).toEqual({ price: null, volume: null });
    await db.query(
      `INSERT INTO gold_price_monthly (month, usd_per_troy_oz, source_id)
       SELECT '2021-12-01', 2500, id FROM sources WHERE source_key = 'price'`,
    );
  });

  it('adds the price effect card for the countries counted in central bank gold', async () => {
    const card = (await stats(db)).price_effect;
    const detail = card?.detail as Record<
      'changeUsd' | 'priceEffectUsd' | 'volumeEffectUsd' | 'countries' | 'tonnesChange',
      number
    >;
    expect(card?.as_of).toBe('2021-12-31');
    expect(detail.countries).toBe(2); // AAA and BBB; DDD is stale
    expect(Number(card?.value)).toBe(Math.round(500 * k * 11 + 500 * k * 4.5));
    expect(detail.changeUsd).toBe(Math.round(k * (12 * 2500 - 10 * 2000)));
    expect(detail.priceEffectUsd + detail.volumeEffectUsd).toBe(detail.changeUsd);
    expect(detail.tonnesChange).toBe(1);
    // Nothing to measure in East Africa (DDD's report is its only one).
    const east = (await stats(db, 'east')).price_effect;
    expect(east?.value).toBeNull();
    expect(east?.as_of).toBeNull();
  });
});

describe('gold_country_metrics', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await fixture();
  });

  async function metrics(year: number | null) {
    const result = await db.query<{
      iso3: string;
      production: Record<string, unknown> | null;
      holdings: Record<string, unknown> | null;
      exports_reported: Record<string, unknown> | null;
      exports_mirror: Record<string, unknown> | null;
      export_share: Record<string, unknown> | null;
    }>(
      `SELECT c.iso3, m.production, m.holdings, m.exports_reported, m.exports_mirror, m.export_share
       FROM gold_country_metrics($1::int) m JOIN countries c ON c.id = m.country_id ORDER BY c.iso3`,
      [year],
    );
    return Object.fromEntries(result.rows.map((row) => [row.iso3, row]));
  }

  it('gives each metric its latest value in or before the year, with its own date', async () => {
    const latest = await metrics(null);
    expect(latest.AAA?.production).toMatchObject({ year: 2021, tonnes: 100, basis: 'reported' });
    expect(latest.AAA?.holdings).toMatchObject({
      asOf: '2021-12-31',
      tonnes: 12,
      change12mTonnes: 2,
    });
    expect(latest.AAA?.exports_reported).toMatchObject({ year: 2021 });
    const in2020 = await metrics(2020);
    expect(in2020.AAA?.production).toMatchObject({ year: 2020 });
    expect(in2020.AAA?.holdings).toMatchObject({ asOf: '2020-12-31', change12mTonnes: null });
  });

  it('keeps no data, zero and "included in other" apart', async () => {
    const latest = await metrics(null);
    expect(latest.CCC?.production).toMatchObject({ basis: 'included_in_other', tonnes: null });
    expect(latest.CCC?.exports_reported).toBeNull();
    expect(latest.CCC?.exports_mirror).toMatchObject({ year: 2020, partnerCount: 2 });
    // BBB's latest figure (2020, an estimate) wins over "nothing" in 2021.
    expect(latest.BBB?.production).toMatchObject({ year: 2020, basis: 'estimate', tonnes: 10 });
    expect(latest.DDD?.export_share).toBeNull();
  });

  it('shows no share when the parts are inconsistent', async () => {
    const latest = await metrics(null);
    expect(latest.AAA?.export_share).toMatchObject({ year: 2020, pct: 50, exceedsTotal: false });
    expect(latest.BBB?.export_share).toMatchObject({ pct: null, exceedsTotal: true });
  });
});
