import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

/*
 * Test fixture: an in-process Postgres (PGlite) with every migration applied and the committed
 * seeds loaded. It mirrors `python -m pipelines load` (which is itself tested against PGlite in
 * pipelines/tests/test_load.py) closely enough for schema and API tests.
 */

const ROOT = join(import.meta.dirname, '..', '..');

export interface SeedCountry {
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

interface SeedRegion {
  slug: string;
  name: string;
  description: string;
  sort_order: number;
}

interface SeedSource {
  source_key: string;
  ref_no: number | null;
  title: string;
  url: string;
  source_type: string;
  reliability_tier: string;
}

interface SeedDataset {
  key: string;
  name: string;
  provider: string;
  license: string;
  attribution: string;
  coverage_start: string | null;
  coverage_end: string | null;
  as_of: string;
  refresh_cadence: string;
}

export function readJson(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(ROOT, ...path), 'utf8'));
}

export async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  const directory = join(ROOT, 'db', 'migrations');
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(directory, file), 'utf8'));
  }
  return db;
}

export function seedCountries(): SeedCountry[] {
  return (readJson('db', 'seeds', 'countries.json') as { countries: SeedCountry[] }).countries;
}

export async function loadSeeds(db: PGlite): Promise<void> {
  const { regions } = readJson('db', 'seeds', 'countries.json') as { regions: SeedRegion[] };
  const { sources } = readJson('db', 'seeds', 'sources.json') as { sources: SeedSource[] };
  const { datasets } = readJson('db', 'seeds', 'datasets.json') as { datasets: SeedDataset[] };
  const flags = readJson('db', 'seeds', 'flags.json') as {
    dataset: SeedDataset;
    flags: { iso3: string; palette: { hex: string; area_share: number }[] }[];
  };
  const boundaries = readJson('db', 'seeds', 'boundaries.json') as {
    dataset: SeedDataset;
    countries: {
      iso3: string;
      centroid_lon: number;
      centroid_lat: number;
      is_microstate_marker: boolean;
    }[];
  };
  const approval = readJson(
    'pipelines',
    'africa_pipelines',
    'reference',
    'region_colors_approval.json',
  ) as { colors: Record<string, string> };

  for (const d of [...datasets, flags.dataset, boundaries.dataset]) {
    await db.query(
      `INSERT INTO datasets (key, name, provider, license, attribution, coverage_start,
         coverage_end, as_of, refresh_cadence, last_refreshed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2026-10-15T08:00:00Z')`,
      [
        d.key,
        d.name,
        d.provider,
        d.license,
        d.attribution,
        d.coverage_start,
        d.coverage_end,
        d.as_of,
        d.refresh_cadence,
      ],
    );
  }
  for (const r of regions) {
    await db.query(
      `INSERT INTO regions (slug, name, description, sort_order, color_hex)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.slug, r.name, r.description, r.sort_order, approval.colors[r.slug] ?? null],
    );
  }
  for (const s of sources) {
    await db.query(
      `INSERT INTO sources (source_key, ref_no, title, url, source_type, reliability_tier)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.source_key, s.ref_no, s.title, s.url, s.source_type, s.reliability_tier],
    );
  }
  for (const c of seedCountries()) {
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
  for (const b of boundaries.countries) {
    await db.query(
      `UPDATE countries SET centroid_lon = $2, centroid_lat = $3, is_microstate_marker = $4
       WHERE iso3 = $1`,
      [b.iso3, b.centroid_lon, b.centroid_lat, b.is_microstate_marker],
    );
  }
  for (const flag of flags.flags) {
    for (const entry of flag.palette) {
      await db.query(
        `INSERT INTO flag_palette (country_id, hex, area_share)
         SELECT id, $2, $3 FROM countries WHERE iso3 = $1`,
        [flag.iso3, entry.hex, entry.area_share],
      );
    }
  }
}

export async function seededDb(): Promise<PGlite> {
  const db = await migratedDb();
  await loadSeeds(db);
  return db;
}
