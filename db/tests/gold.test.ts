import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, readJson } from './seededDb.ts';

/* Dhahabu schema rules (0007_dhahabu.sql), checked on small fixtures. */
describe('gold schema', () => {
  let db: PGlite;

  async function scalar<T>(query: string, params: unknown[] = []): Promise<T> {
    const result = await db.query<{ v: T }>(query, params);
    return result.rows[0]?.v as T;
  }

  beforeAll(async () => {
    db = await migratedDb();
    await db.exec(`
      INSERT INTO regions (slug, name, sort_order) VALUES ('west', 'West Africa', 1);
      INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
        SELECT 'GH', 'GHA', 288, 'Ghana', id, 'https://flagcdn.com/w{width}/gh.png' FROM regions;
      INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
        SELECT 'ML', 'MLI', 466, 'Mali', id, 'https://flagcdn.com/w{width}/ml.png' FROM regions;
      INSERT INTO sources (source_key, title, url, source_type, reliability_tier) VALUES
        ('price', 'Price', 'https://p.test', 'statistics', 'primary'),
        ('mcs-new', 'MCS new', 'https://m.test', 'statistics', 'primary'),
        ('mcs-old', 'MCS old', 'https://o.test', 'statistics', 'primary'),
        ('myb', 'Yearbook', 'https://y.test', 'statistics', 'primary');
      INSERT INTO gold_production_source_priority (source_id, priority)
        SELECT id, CASE source_key WHEN 'mcs-new' THEN 1 WHEN 'mcs-old' THEN 2 ELSE 3 END
        FROM sources WHERE source_key <> 'price';
      -- 2023 complete with a mean of 2,000 US$/oz (December 2,110); 2024 has only three months.
      INSERT INTO gold_price_monthly (month, usd_per_troy_oz, source_id)
        SELECT make_date(2023, m, 1), CASE WHEN m = 12 THEN 2110 ELSE 1990 END,
               (SELECT id FROM sources WHERE source_key = 'price')
        FROM generate_series(1, 12) m;
      INSERT INTO gold_price_monthly (month, usd_per_troy_oz, source_id)
        SELECT make_date(2024, m, 1), 2300, (SELECT id FROM sources WHERE source_key = 'price')
        FROM generate_series(1, 3) m;
    `);
  });

  it('carries the tonne/troy-ounce constant from config/constants.json', async () => {
    const constants = readJson('config', 'constants.json') as { TROY_OZ_PER_TONNE: number };
    expect(Number(await scalar('SELECT troy_oz_per_tonne() AS v'))).toBe(
      constants.TROY_OZ_PER_TONNE,
    );
  });

  it('derives annual prices, valuing production only for complete years', async () => {
    const rows = await db.query<{ year: number; is_complete: boolean; year_end: string | null }>(
      `SELECT year, is_complete, year_end_usd_per_troy_oz AS year_end
       FROM v_gold_price_annual ORDER BY year`,
    );
    expect(rows.rows.map((r) => [r.year, r.is_complete, r.year_end && Number(r.year_end)])).toEqual(
      [
        [2023, true, 2110],
        [2024, false, null],
      ],
    );
    expect(
      Number(
        await scalar('SELECT mean_usd_per_troy_oz AS v FROM v_gold_price_annual WHERE year = 2023'),
      ),
    ).toBe(2000);
  });

  it('keeps null, zero and "included in other" apart', async () => {
    const insert = (tonnes: number | null, basis: string) =>
      db.query(
        `INSERT INTO gold_production_annual (country_id, year, tonnes, basis, source_id)
         SELECT c.id, 1999, $1, $2::gold_production_basis, s.id FROM countries c, sources s
         WHERE c.iso3 = 'MLI' AND s.source_key = 'myb'`,
        [tonnes, basis],
      );
    await expect(insert(0, 'included_in_other')).rejects.toThrow();
    await expect(insert(null, 'reported')).rejects.toThrow();
    await expect(insert(-1, 'reported')).rejects.toThrow();
    await insert(0, 'reported'); // a reported zero is a value
    await db.query('DELETE FROM gold_production_annual WHERE year = 1999');
  });

  it('picks a figure over "included in other", reported over estimated, then priority', async () => {
    await db.exec(`
      INSERT INTO gold_production_annual (country_id, year, tonnes, basis, source_id)
      SELECT c.id, v.year, v.tonnes, v.basis::gold_production_basis, s.id
      FROM (VALUES
        ('GHA', 2023, NULL, 'included_in_other', 'mcs-new'),
        ('GHA', 2023, 90, 'estimate', 'mcs-old'),
        ('GHA', 2023, 116, 'reported', 'myb'),
        ('GHA', 2024, 150, 'estimate', 'mcs-new'),
        ('MLI', 2023, NULL, 'included_in_other', 'myb'),
        ('MLI', 2023, 60, 'reported', 'mcs-old'),
        ('MLI', 2023, 67, 'reported', 'mcs-new')
      ) AS v(iso3, year, tonnes, basis, source)
      JOIN countries c ON c.iso3 = v.iso3 JOIN sources s ON s.source_key = v.source;
    `);
    const rows = await db.query<{
      iso3: string;
      year: number;
      tonnes: string;
      basis: string;
      value_usd: string | null;
      value_is_computed: boolean;
    }>(`SELECT c.iso3, p.year, p.tonnes, p.basis::text AS basis, p.value_usd, p.value_is_computed
        FROM v_gold_production p JOIN countries c ON c.id = p.country_id ORDER BY 1, 2`);
    const ghana2023 = rows.rows[0];
    expect([ghana2023?.tonnes, ghana2023?.basis]).toEqual(['116.000', 'reported']);
    // Valued at 2023's mean monthly price: 116 t × 32,150.7466 oz × 2,000 US$/oz.
    expect(Number(ghana2023?.value_usd)).toBeCloseTo(116 * 32150.7466 * 2000, -1);
    expect(ghana2023?.value_is_computed).toBe(true);
    // 2024's price year is incomplete: the value stays empty rather than being filled.
    expect(rows.rows[1]).toMatchObject({ year: 2024, tonnes: '150.000', value_usd: null });
    expect(rows.rows[2]?.tonnes).toBe('67.000'); // MCS new beats MCS old
  });

  it('enforces month-end holdings, shares within 0–100 and known trade codes', async () => {
    const holding = (asOf: string, pct: number) =>
      db.query(
        `INSERT INTO gold_official_reserves (country_id, as_of, tonnes, value_usd,
           pct_of_total_reserves, valuation, source_id)
         SELECT c.id, $1, 1, 1, $2, 'computed', s.id FROM countries c, sources s
         WHERE c.iso3 = 'GHA' AND s.source_key = 'price'`,
        [asOf, pct],
      );
    await expect(holding('2026-07-15', 10)).rejects.toThrow();
    await expect(holding('2026-07-31', 120)).rejects.toThrow();
    await holding('2024-02-29', 10);
    await expect(
      db.query(`INSERT INTO gold_trade_annual (country_id, year, flow, hs_code, value_usd, basis, source_id)
        SELECT c.id, 2023, 'export', '7109', 1, 'reported', s.id FROM countries c, sources s
        WHERE c.iso3 = 'GHA' AND s.source_key = 'price'`),
    ).rejects.toThrow();
  });

  it('requires a cited source for any presence tier other than unknown', async () => {
    const profile = (tier: string, needsReview: boolean) =>
      db.query(
        `INSERT INTO country_gold_profiles (country_id, presence_tier, presence_basis,
           presence_confidence, summary, needs_review)
         SELECT id, $1::gold_presence_tier, 'basis', 'low', 'summary', $2 FROM countries
         WHERE iso3 = 'MLI'`,
        [tier, needsReview],
      );
    await expect(profile('producer', false)).rejects.toThrow();
    await profile('unknown', false);
    await db.query("DELETE FROM country_gold_profiles WHERE presence_tier = 'unknown'");
    await profile('producer', true); // flagged for review instead
  });
});
