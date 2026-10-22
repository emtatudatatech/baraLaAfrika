import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, readJson, seedCountries, seededDb } from './seededDb.ts';

describe('schema', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migratedDb();
  });

  it('documents every table and column with a comment', async () => {
    const missing = await db.query<{ item: string }>(`
      SELECT c.relname AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND obj_description(c.oid, 'pg_class') IS NULL
      UNION ALL
      SELECT c.relname || '.' || a.attname FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND a.attnum > 0 AND NOT a.attisdropped
        AND col_description(c.oid, a.attnum) IS NULL`);
    expect(missing.rows.map((r) => r.item)).toEqual([]);
  });

  it('enforces closed value sets and formats', async () => {
    await db.query("INSERT INTO regions (slug, name, sort_order) VALUES ('test', 'Test', 99)");
    await expect(
      db.query("UPDATE regions SET color_hex = 'red' WHERE slug = 'test'"),
    ).rejects.toThrow();
    await expect(
      db.query("UPDATE regions SET color_hex = '#ABCDEF' WHERE slug = 'test'"),
    ).rejects.toThrow(); // lowercase hex only
    await expect(
      db.query(`INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
        SELECT 'k', 'KEN', 404, 'Kenya', id, 'https://flagcdn.com/w{width}/ke.png'
        FROM regions WHERE slug = 'test'`),
    ).rejects.toThrow();
    await expect(
      db.query(`INSERT INTO sources (source_key, title, url, source_type, reliability_tier)
        VALUES ('x', 'X', 'https://x.test', 'forum', 'dubious')`),
    ).rejects.toThrow();
    await db.query("DELETE FROM regions WHERE slug = 'test'");
  });

  it('keeps ingestion run status and finish time consistent', async () => {
    const dataset = await db.query<{ id: number }>(`
      INSERT INTO datasets (key, name, provider, license, attribution, as_of, refresh_cadence)
      VALUES ('t', 'T', 'P', 'L', 'A', '2026-01-01', 'manual') RETURNING id`);
    const id = dataset.rows[0]?.id;
    await expect(
      db.query("INSERT INTO ingestion_runs (dataset_id, status) VALUES ($1, 'succeeded')", [id]),
    ).rejects.toThrow();
    await db.query(
      "INSERT INTO ingestion_runs (dataset_id, status, finished_at) VALUES ($1, 'succeeded', now())",
      [id],
    );
    await expect(
      db.query(`INSERT INTO datasets (key, name, provider, license, attribution, as_of,
        refresh_cadence, coverage_start, coverage_end)
        VALUES ('bad', 'B', 'P', 'L', 'A', '2026-01-01', 'annual', '2020-01-01', '2019-01-01')`),
    ).rejects.toThrow();
    await db.query("DELETE FROM datasets WHERE key = 't'");
  });

  it('maintains updated_at on change', async () => {
    await db.query("INSERT INTO regions (slug, name, sort_order) VALUES ('tmp', 'Tmp', 98)");
    const before = await db.query<{ updated_at: Date }>(
      "SELECT updated_at FROM regions WHERE slug = 'tmp'",
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await db.query("UPDATE regions SET description = 'x' WHERE slug = 'tmp'");
    const after = await db.query<{ updated_at: Date }>(
      "SELECT updated_at FROM regions WHERE slug = 'tmp'",
    );
    expect(after.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]?.updated_at.getTime() ?? Infinity,
    );
    await db.query("DELETE FROM regions WHERE slug = 'tmp'");
  });
});

describe('election_status()', () => {
  it('counts 12 months from today; a missing or passed date is "no date set"', async () => {
    const db = await migratedDb();
    const result = await db.query<{ s: string[] }>(`
      SELECT array[
        election_status('2027-10-22', '2026-10-22'),
        election_status('2027-10-23', '2026-10-22'),
        election_status(NULL, '2026-10-22'),
        election_status('2026-10-01', '2026-10-22')
      ] AS s`);
    expect(result.rows[0]?.s).toEqual([
      'within_12_months',
      'beyond_12_months',
      'no_date_set',
      'no_date_set',
    ]);
  });
});

describe('committed seeds', () => {
  it('load into the schema: 54 countries with profiles and citations', async () => {
    const db = await seededDb();
    const counts = await db.query<{ region: string; n: number }>(`
      SELECT r.slug AS region, count(*)::int AS n FROM countries c
      JOIN regions r ON r.id = c.region_id GROUP BY r.slug`);
    expect(Object.fromEntries(counts.rows.map((r) => [r.region, r.n]))).toEqual({
      north: 6,
      west: 16,
      central: 9,
      east: 18,
      southern: 5,
    });
    const profiles = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM country_profiles',
    );
    expect(profiles.rows[0]?.n).toBe(54);
    const orphans = await db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM countries c
      LEFT JOIN country_sources cs ON cs.country_id = c.id WHERE cs.country_id IS NULL`);
    // Every country profile cites at least one source somewhere in its prose.
    expect(orphans.rows[0]?.n).toBe(0);
    // Every citation in the seed resolved to a loaded source.
    const expected = seedCountries().reduce((total, c) => total + c.sources.length, 0);
    const links = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM country_sources');
    expect(links.rows[0]?.n).toBe(expected);
    expect(expected).toBeGreaterThan(54);
  });

  it('load every indicator observation and creditor, each with its edition', async () => {
    const db = await seededDb();
    const seed = readJson('db', 'seeds', 'indicators.json') as {
      observations: { rows: unknown[] };
    };
    const creditors = readJson('db', 'seeds', 'external_debt_creditors.json') as {
      creditors: { rows: unknown[] };
    };
    const counts = await db.query<{ observations: number; creditors: number; editions: number }>(`
      SELECT (SELECT count(*)::int FROM indicator_observations) AS observations,
             (SELECT count(*)::int FROM external_debt_creditors) AS creditors,
             (SELECT count(*)::int FROM indicator_observations WHERE edition IS NULL)
               + (SELECT count(*)::int FROM external_debt_creditors WHERE creditor_name IS NULL)
               AS editions`);
    expect(counts.rows[0]).toEqual({
      observations: seed.observations.rows.length,
      creditors: creditors.creditors.rows.length,
      editions: 0,
    });
    const population = await db.query<{ n: number }>(`
      SELECT count(DISTINCT o.country_id)::int AS n FROM indicator_observations o
      JOIN indicators i ON i.id = o.indicator_id WHERE i.key = 'population'`);
    expect(population.rows[0]?.n).toBe(54);
  });

  it('load one executive leader and one election record per country', async () => {
    const db = await seededDb();
    const counts = await db.query<{ executives: number; elections: number }>(`
      SELECT (SELECT count(*)::int FROM country_leaders WHERE is_executive) AS executives,
             (SELECT count(*)::int FROM country_elections) AS elections`);
    expect(counts.rows[0]).toEqual({ executives: 54, elections: 54 });
  });

  it('fold accents for search', async () => {
    const db = await seededDb();
    const result = await db.query<{ name: string }>(
      'SELECT name FROM v_country_summary WHERE strpos(search_text, search_fold($1)) > 0',
      ['sao tome'],
    );
    expect(result.rows.map((r) => r.name)).toEqual(['São Tomé and Príncipe']);
  });
});
