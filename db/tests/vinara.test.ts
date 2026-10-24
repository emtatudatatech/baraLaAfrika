import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, seededDb } from './seededDb.ts';

/*
 * Vinara's rules (0015_vinara.sql) on a small fixture: three West African states (AAA, BBB,
 * CCC) and one East African (DDD). AAA and BBB share a currency (XOF, fixed at 600 per dollar);
 * DDD's is fixed at 100; CCC's alternates between 100 and 102 each month.
 */

interface Entity {
  iso3: string;
  value: number;
  year: number;
  estimate: boolean;
}

interface RegionValue {
  slug: string;
  value: number | null;
  median: number | null;
  coverage: number;
  partial: boolean;
  rank: number | null;
}

interface SummaryRow {
  metric: string;
  from_year: number;
  to_year: number;
  is_default: boolean;
  cardinals: Entity[];
  contenders: Entity[];
  signal: string | null;
  contender_leads_latest: boolean;
  ranked: number;
  unranked: { iso3: string; reason: string }[];
  region_cardinals: { slug: string }[] | null;
  region_contenders: { slug: string }[] | null;
  regions: RegionValue[] | null;
}

async function fixture(): Promise<PGlite> {
  const db = await migratedDb();
  await db.exec(`
    INSERT INTO regions (slug, name, sort_order) VALUES ('west', 'Western Africa', 1), ('east', 'Eastern Africa', 2);
    INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
    SELECT v.iso2, v.iso3, v.num, v.name, r.id, 'https://flagcdn.com/w{width}/' || lower(v.iso2) || '.png'
    FROM (VALUES ('AA', 'AAA', 1, 'Aland', 'west'), ('BB', 'BBB', 2, 'Bland', 'west'),
                 ('CC', 'CCC', 3, 'Cland', 'west'), ('DD', 'DDD', 4, 'Dland', 'east'))
      AS v(iso2, iso3, num, name, region)
    JOIN regions r ON r.slug = v.region;
    INSERT INTO sources (source_key, title, url, source_type, reliability_tier) VALUES
      ('wb', 'World Bank', 'https://w.test', 'statistics', 'primary'),
      ('imf', 'IMF', 'https://i.test', 'statistics', 'primary');
    INSERT INTO datasets (key, name, provider, license, attribution, as_of, refresh_cadence)
      VALUES ('wdi', 'WDI', 'World Bank', 'CC BY 4.0', 'World Bank', '2026-10-01', 'weekly');
    INSERT INTO indicators (key, name, unit, decimals, definition, dataset_id, sort_order)
    SELECT v.key, v.key, v.unit, 2, 'd', (SELECT id FROM datasets), v.n
    FROM (VALUES ('population', 'people', 1), ('gdp_usd', 'current_usd', 2),
                 ('gdp_growth', 'percent', 3), ('inflation', 'percent', 4)) AS v(key, unit, n);

    CREATE TEMP TABLE obs (indicator text, iso3 text, y0 int, y1 int, f text);
    -- Population: BBB gains 20 a year on AAA; AAA alone has 2023.
    INSERT INTO obs VALUES ('population', 'AAA', 2010, 2023, '1000 + 10 * (y - 2010)'),
      ('population', 'BBB', 2010, 2022, '500 + 30 * (y - 2010)'),
      ('population', 'CCC', 2010, 2022, '300'), ('population', 'DDD', 2010, 2022, '200'),
    -- GDP: AAA and BBB tie at the metric's precision (0 decimals).
      ('gdp_usd', 'AAA', 2010, 2022, '50.4'), ('gdp_usd', 'BBB', 2010, 2022, '49.6'),
      ('gdp_usd', 'CCC', 2010, 2022, '10'), ('gdp_usd', 'DDD', 2010, 2022, '20'),
    -- Growth: BBB beats AAA in 2020 and 2021; CCC has 7 of the window's 10 years.
      ('gdp_growth', 'AAA', 2010, 2022, '5'),
      ('gdp_growth', 'BBB', 2010, 2022, 'CASE WHEN y IN (2020, 2021) THEN 6 WHEN y = 2022 THEN 3 ELSE 4 END'),
      ('gdp_growth', 'CCC', 2016, 2022, '1'), ('gdp_growth', 'DDD', 2010, 2022, '2'),
    -- Inflation: AAA has deflation of 3% a year; DDD has no figures.
      ('inflation', 'AAA', 2010, 2022, '-3'), ('inflation', 'BBB', 2010, 2022, '4'),
      ('inflation', 'CCC', 2010, 2022, '2.5');
  `);
  const rows = await db.query<{
    indicator: string;
    iso3: string;
    y0: number;
    y1: number;
    f: string;
  }>('SELECT * FROM obs');
  for (const r of rows.rows) {
    // The fixture's own formulas (constants above), not user input.
    await db.query(
      `INSERT INTO indicator_observations (indicator_id, country_id, year, value, source_id, edition)
       SELECT i.id, c.id, y, ${r.f}, (SELECT id FROM sources WHERE source_key = 'wb'), 'test'
       FROM generate_series($3::int, $4::int) y, indicators i, countries c
       WHERE i.key = $1 AND c.iso3 = $2`,
      [r.indicator, r.iso3, r.y0, r.y1],
    );
  }
  await db.exec(`
    INSERT INTO country_currencies (country_id, currency_code)
    SELECT c.id, v.code FROM (VALUES ('AAA', 'XOF'), ('BBB', 'XOF'), ('CCC', 'CCD'), ('DDD', 'DDX'))
      AS v(iso3, code) JOIN countries c ON c.iso3 = v.iso3;
    INSERT INTO fx_monthly (country_id, month, per_usd_avg, source_id)
    SELECT c.id, m::date,
           CASE c.iso3 WHEN 'CCC' THEN 100 + 2 * (extract(month FROM m)::int % 2 = 0)::int
                       WHEN 'DDD' THEN 100 ELSE 600 END,
           (SELECT id FROM sources WHERE source_key = 'imf')
    FROM countries c, generate_series('2019-12-01'::date, '2024-12-01', interval '1 month') m;
    -- CCC's January 2020 daily rates (mean 85) replace the IMF's monthly 100.
    INSERT INTO fx_daily (currency_code, day, per_usd, basis, source_id) VALUES
      ('CCD', '2020-01-02', 80, 'central_bank', (SELECT id FROM sources WHERE source_key = 'imf')),
      ('CCD', '2020-01-03', 90, 'central_bank', (SELECT id FROM sources WHERE source_key = 'imf'));
  `);
  return db;
}

describe('Vinara rules on a fixture', () => {
  let db: PGlite;
  let all: Record<string, SummaryRow>;

  async function summary(region: string | null, from?: number, to?: number) {
    const result = await db.query<SummaryRow>('SELECT * FROM vinara_summary($1, $2, $3)', [
      region,
      from ?? null,
      to ?? null,
    ]);
    return Object.fromEntries(result.rows.map((r) => [r.metric, r]));
  }

  const isos = (list: { iso3: string }[]) => list.map((e) => e.iso3);
  const region = (row: SummaryRow | undefined, slug: string) =>
    row?.regions?.find((r) => r.slug === slug);

  beforeAll(async () => {
    db = await fixture();
    all = await summary(null);
  }, 30_000);

  it('leaves out the metrics with no data', () => {
    expect(Object.keys(all).sort()).toEqual(
      [
        'currency_performance',
        'currency_stability',
        'gdp_growth',
        'gdp_usd',
        'inflation',
        'population',
      ].sort(),
    );
  });

  it('defaults to the last ten complete years, and keeps a range asked for within the data', async () => {
    // 2023 has one state of four, so it is not complete.
    expect(all.population).toMatchObject({ from_year: 2013, to_year: 2022, is_default: true });
    const window = (from: number | null, to: number | null) =>
      db.query('SELECT * FROM vinara_window($1, $2, $3)', ['population', from, to]);
    expect((await window(2000, 2030)).rows[0]).toEqual({
      from_year: 2010,
      to_year: 2023,
      is_default: false,
    });
    expect((await window(2018, null)).rows[0]).toMatchObject({ from_year: 2018, to_year: 2022 });
    // Both currency metrics share the currency changes' window.
    expect(all.currency_performance).toMatchObject({ from_year: 2020, to_year: 2024 });
    expect(all.currency_stability).toMatchObject({ from_year: 2020, to_year: 2024 });
  });

  it('ends the currency window at the latest full year of rates, leaving out states without it', async () => {
    await db.exec('BEGIN');
    try {
      // DDD's rates stop after 2023: three states of four have 2024, below 90%.
      await db.exec(`DELETE FROM fx_monthly WHERE month >= '2024-01-01'
                     AND country_id = (SELECT id FROM countries WHERE iso3 = 'DDD')`);
      const later = await summary(null);
      expect(later.currency_performance).toMatchObject({ from_year: 2020, to_year: 2024 });
      expect(later.currency_stability).toMatchObject({ from_year: 2020, to_year: 2024 });
      expect(isos(later.currency_performance?.unranked ?? [])).toEqual(['DDD']);
      expect(isos(later.currency_stability?.unranked ?? [])).toEqual(['DDD']);
      // The other metrics keep the 90% rule.
      expect(later.population).toMatchObject({ to_year: 2022 });
    } finally {
      await db.exec('ROLLBACK');
    }
  });

  it('names the cardinal and the contender, and sees a narrowing gap in levels', () => {
    const row = all.population;
    expect(isos(row?.cardinals ?? [])).toEqual(['AAA']);
    expect(row?.cardinals[0]).toMatchObject({ value: 1120, year: 2022, estimate: false });
    expect(isos(row?.contenders ?? [])).toEqual(['BBB']);
    expect(row?.signal).toBe('gap_closing');
    expect(row?.contender_leads_latest).toBe(false);
    expect(row?.ranked).toBe(4);
    expect(row?.unranked).toEqual([]);
  });

  it('reads a steady gap as holding, and too few years as not enough data', async () => {
    const signal = async (to: number, cardinal: string, contender: string) =>
      (
        await db.query<{ signal: string }>(
          `SELECT s.signal FROM vinara_signal('population', $1,
             (SELECT id FROM countries WHERE iso3 = $2), (SELECT id FROM countries WHERE iso3 = $3)) s`,
          [to, cardinal, contender],
        )
      ).rows[0]?.signal;
    expect(await signal(2022, 'CCC', 'DDD')).toBe('lead_holding');
    expect(await signal(2011, 'AAA', 'BBB')).toBe('not_enough_data');
  });

  it('names every state in a tie at the metric’s precision, and gives no signal', () => {
    const row = all.gdp_usd;
    expect(isos(row?.cardinals ?? [])).toEqual(['AAA', 'BBB']);
    expect(row?.cardinals.map((e) => e.value)).toEqual([50, 50]);
    expect(isos(row?.contenders ?? [])).toEqual(['DDD']);
    expect(row?.signal).toBeNull();
  });

  it('ranks rates by their mean over the window, for states with 80% of its years', () => {
    const row = all.gdp_growth;
    expect(row?.cardinals[0]).toMatchObject({ iso3: 'AAA', value: 5 });
    expect(row?.contenders[0]).toMatchObject({ iso3: 'BBB', value: 4.3 });
    expect(row?.ranked).toBe(3);
    expect(row?.unranked).toEqual([
      {
        iso3: 'CCC',
        name: 'Cland',
        reason: "Growth figures for fewer than 80% of the window's years",
      },
    ]);
    // BBB grew faster in two of the last three years; it did not lead in 2022.
    expect(row?.signal).toBe('gap_closing');
    expect(row?.contender_leads_latest).toBe(false);
  });

  it('says when the contender led in the window’s last year', async () => {
    const earlier = await summary(null, 2012, 2021);
    expect(earlier.gdp_growth).toMatchObject({
      signal: 'gap_closing',
      contender_leads_latest: true,
    });
  });

  it('ranks inflation by its absolute mean, so deflation is no better than inflation', () => {
    const row = all.inflation;
    expect(row?.cardinals[0]).toMatchObject({ iso3: 'CCC', value: 2.5 });
    expect(row?.contenders[0]).toMatchObject({ iso3: 'AAA', value: 3 });
    // The region's GDP-weighted mean uses absolute rates too: (3×50.4 + 4×49.6 + 2.5×10) / 110.
    expect(region(row, 'west')?.value).toBe(3.41);
  });

  it('shows a partial region without ranking it', () => {
    const row = all.inflation;
    expect(region(row, 'east')).toMatchObject({
      value: null,
      coverage: 0,
      partial: true,
      rank: null,
    });
    expect(region(row, 'west')).toMatchObject({ partial: false, rank: 1 });
    expect(row?.region_cardinals).toEqual([{ slug: 'west', name: 'Western Africa', value: 3.41 }]);
    expect(row?.region_contenders).toEqual([]);
  });

  it('sums levels and weights rates by GDP for regions, with the median over states', () => {
    expect(region(all.gdp_usd, 'west')).toMatchObject({ value: 110, coverage: 1, rank: 1 });
    expect(region(all.gdp_usd, 'west')?.median).toBe(50); // 49.6, rounded
    expect(region(all.gdp_usd, 'east')).toMatchObject({ value: 20, rank: 2 });
    expect(region(all.gdp_growth, 'east')).toMatchObject({ value: 2, partial: false });
    expect(all.gdp_usd?.region_cardinals?.map((r) => r.slug)).toEqual(['west']);
    expect(all.gdp_usd?.region_contenders?.map((r) => r.slug)).toEqual(['east']);
  });

  it('ranks currencies on monthly averages, daily means first, and ties fixed currencies', async () => {
    const month = await db.query<{ per_usd: string; basis: string }>(
      `SELECT per_usd, basis FROM v_fx_month f JOIN countries c ON c.id = f.country_id
       WHERE c.iso3 = 'CCC' AND month = '2020-01-01'`,
    );
    expect(month.rows[0]).toMatchObject({ basis: 'daily' });
    expect(Number(month.rows[0]?.per_usd)).toBe(85);

    const performance = all.currency_performance;
    expect(isos(performance?.cardinals ?? [])).toEqual(['AAA', 'BBB', 'DDD']);
    expect(performance?.cardinals.every((e) => e.value === 0)).toBe(true);
    // 85 per dollar in January 2020, 102 in December 2024.
    expect(performance?.contenders[0]).toMatchObject({ iso3: 'CCC', value: -16.67 });
    expect(performance?.signal).toBeNull();

    const stability = all.currency_stability;
    expect(isos(stability?.cardinals ?? [])).toEqual(['AAA', 'BBB', 'DDD']);
    expect(stability?.contenders[0]?.iso3).toBe('CCC');
    expect(stability?.contenders[0]?.value).toBeGreaterThan(0);
  });

  it('counts each currency once in a region’s median', () => {
    // XOF (0) and CCC's currency (−16.67): AAA and BBB share XOF, so the median is not 0.
    expect(region(all.currency_performance, 'west')?.value).toBe(-8.33);
  });

  it('ranks within one region, without comparing regions', async () => {
    const east = await summary('east');
    expect(isos(east.population?.cardinals ?? [])).toEqual(['DDD']);
    expect(east.population?.contenders).toEqual([]);
    expect(east.population?.signal).toBeNull();
    expect(east.population?.regions).toBeNull();
    expect(isos(east.inflation?.unranked ?? [])).toEqual(['DDD']);
  });
});

describe('Vinara on the committed data', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await seededDb();
  }, 60_000);

  it('answers for every metric with read-only access, as the API connects', async () => {
    await db.exec('BEGIN TRANSACTION READ ONLY');
    try {
      // The guard is real: a read-only transaction cannot create a temporary table.
      await expect(db.exec('SAVEPOINT s; CREATE TEMP TABLE t (x int)')).rejects.toThrow(
        /read-only/,
      );
      await db.exec('ROLLBACK TO SAVEPOINT s');
      const rows = (await db.query<SummaryRow>('SELECT * FROM vinara_summary()')).rows;
      expect(rows.map((r) => r.metric)).toHaveLength(13);
      for (const row of rows) {
        expect(row.ranked + row.unranked.length).toBe(54);
        expect(row.cardinals.length).toBeGreaterThan(0);
        expect(row.regions).toHaveLength(5);
        expect(row.from_year).toBeLessThanOrEqual(row.to_year);
      }
      const population = rows.find((r) => r.metric === 'population');
      expect(population?.cardinals.map((e) => e.iso3)).toEqual(['NGA']);
    } finally {
      await db.exec('ROLLBACK');
    }
  }, 60_000);

  it('documents every metric, word for word, in docs/vinara-method.md', async () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'vinara-method.md'),
      'utf8',
    );
    const metrics = await db.query<{ key: string; definition: string }>(
      'SELECT key, definition FROM vinara_metrics',
    );
    expect(metrics.rows).toHaveLength(13);
    for (const row of metrics.rows) {
      expect(docs).toContain(`\`${row.key}\`): ${row.definition}`);
    }
  });
});
