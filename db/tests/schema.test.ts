import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'db', 'migrations');

interface SeedCountry {
  iso3: string;
  iso2: string;
  iso_numeric: number;
  name: string;
  official_name: string | null;
  region: string;
  flag_url_template: string;
  is_microstate_marker: boolean;
  profile: Record<string, string | boolean | null>;
  sources: { field: string; source_key: string }[];
}

function readSeed(name: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, 'db', 'seeds', name), 'utf8'));
}

async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

/** Inserts the committed seeds the way `pipelines load` will (schema compatibility check). */
async function loadSeeds(db: PGlite): Promise<void> {
  const { regions, countries } = readSeed('countries.json') as {
    regions: { slug: string; name: string; description: string; sort_order: number }[];
    countries: SeedCountry[];
  };
  const { sources } = readSeed('sources.json') as {
    sources: {
      source_key: string;
      ref_no: number | null;
      title: string;
      url: string;
      source_type: string;
      reliability_tier: string;
    }[];
  };
  for (const r of regions) {
    await db.query(
      'INSERT INTO regions (slug, name, description, sort_order) VALUES ($1, $2, $3, $4)',
      [r.slug, r.name, r.description, r.sort_order],
    );
  }
  for (const s of sources) {
    await db.query(
      `INSERT INTO sources (source_key, ref_no, title, url, source_type, reliability_tier)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.source_key, s.ref_no, s.title, s.url, s.source_type, s.reliability_tier],
    );
  }
  for (const c of countries) {
    await db.query(
      `INSERT INTO countries (iso2, iso3, iso_numeric, name, official_name, region_id,
         flag_url_template, is_microstate_marker)
       SELECT $1, $2, $3, $4, $5, id, $7, $8 FROM regions WHERE slug = $6`,
      [
        c.iso2,
        c.iso3,
        c.iso_numeric,
        c.name,
        c.official_name,
        c.region,
        c.flag_url_template,
        c.is_microstate_marker,
      ],
    );
    const p = c.profile;
    await db.query(
      `INSERT INTO country_profiles (country_id, etymology_summary, etymology_detail,
         etymology_category, flag_design_summary, flag_design_detail, national_symbol_summary,
         national_symbol_detail, national_animal_name, national_animal_scientific,
         national_animal_detail, animal_status, needs_review, review_notes)
       SELECT id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       FROM countries WHERE iso3 = $1`,
      [
        c.iso3,
        p.etymology_summary,
        p.etymology_detail,
        p.etymology_category,
        p.flag_design_summary,
        p.flag_design_detail,
        p.national_symbol_summary,
        p.national_symbol_detail,
        p.national_animal_name,
        p.national_animal_scientific,
        p.national_animal_detail,
        p.animal_status,
        p.needs_review,
        p.review_notes,
      ],
    );
    for (const s of c.sources) {
      await db.query(
        `INSERT INTO country_sources (country_id, source_id, field)
         SELECT c.id, s.id, $3 FROM countries c, sources s
         WHERE c.iso3 = $1 AND s.source_key = $2`,
        [c.iso3, s.source_key, s.field],
      );
    }
  }
}

describe('0001_core schema', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migratedDb();
  });

  it('documents every table and column with a comment', async () => {
    const missing = await db.query<{ item: string }>(`
      SELECT c.relname AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND obj_description(c.oid, 'pg_class') IS NULL
      UNION ALL
      SELECT c.relname || '.' || a.attname FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
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

describe('committed seeds', () => {
  it('load into the schema: 54 countries with profiles and citations', async () => {
    const db = await migratedDb();
    await loadSeeds(db);
    const counts = await db.query<{ region: string; n: number }>(`
      SELECT r.slug AS region, count(*)::int AS n FROM countries c
      JOIN regions r ON r.id = c.region_id GROUP BY r.slug`);
    expect(Object.fromEntries(counts.rows.map((r) => [r.region, r.n]))).toEqual({
      north: 6,
      west: 15,
      central: 9,
      east: 16,
      southern: 8,
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
    const { countries } = readSeed('countries.json') as { countries: SeedCountry[] };
    const expected = countries.reduce((total, c) => total + c.sources.length, 0);
    const links = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM country_sources');
    expect(links.rows[0]?.n).toBe(expected);
    expect(expected).toBeGreaterThan(54);
  });
});
