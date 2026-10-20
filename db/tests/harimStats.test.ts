import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, seededDb } from './seededDb.ts';

interface StatRow {
  key: string;
  label: string;
  value: string | null;
  unit: string;
  detail: Record<string, unknown>;
  entities: Record<string, unknown>[];
  definition: string;
}

async function stats(db: PGlite, region: string | null = null): Promise<Record<string, StatRow>> {
  const result = await db.query<StatRow>('SELECT * FROM v_harim_stats($1)', [region]);
  return Object.fromEntries(result.rows.map((row) => [row.key, row]));
}

/*
 * A small world: two regions; a massif with two summits; a peak shared by two countries; two
 * countries tied on the most 3,000 m peaks; a territory peak; low points below sea level.
 */
async function fixture(): Promise<PGlite> {
  const db = await migratedDb();
  await db.exec(`
    INSERT INTO sources (source_key, title, url, source_type, reliability_tier)
      VALUES ('s', 'S', 'https://s.test', 'test', 'reference');
    INSERT INTO regions (slug, name, sort_order) VALUES ('east', 'East Africa', 4),
      ('north', 'North Africa', 1);
    INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
      SELECT v.iso2, v.iso3, v.num, v.name, r.id, 'https://flagcdn.com/w{width}/x.png'
      FROM (VALUES ('AA', 'AAA', 1, 'Alpha', 'east'), ('BB', 'BBB', 2, 'Beta', 'east'),
                   ('CC', 'CCC', 3, 'Gamma', 'north')) AS v(iso2, iso3, num, name, region)
      JOIN regions r ON r.slug = v.region;
    INSERT INTO mountain_ranges (slug, name) VALUES ('big', 'Big Range'), ('small', 'Small Range');
  `);
  const mountain = async (
    slug: string,
    elevation: number,
    extra: {
      kind?: string;
      parent?: string;
      range?: string;
      type?: string;
      status?: string;
      territory?: string;
      prominence?: number;
    } = {},
  ) => {
    await db.query(
      `INSERT INTO mountains (slug, name, elevation_m, elevation_source_id, elevation_confidence,
         latitude, longitude, summit_kind, parent_id, range_id, peak_type, volcanic_status,
         territory_name, prominence_m)
       VALUES ($1, initcap(replace($1, '-', ' ')), $2, (SELECT id FROM sources), 'high', -3, 37,
         $3::summit_kind, (SELECT id FROM mountains WHERE slug = $4),
         (SELECT id FROM mountain_ranges WHERE slug = $5), $6::peak_type, $7::volcanic_status,
         $8, $9)`,
      [
        slug,
        elevation,
        extra.kind ?? 'standalone',
        extra.parent ?? null,
        extra.range ?? null,
        extra.type ?? 'peak',
        extra.status ?? null,
        extra.territory ?? null,
        extra.prominence ?? null,
      ],
    );
  };
  const link = async (slug: string, iso3: string, highPoint = false) => {
    await db.query(
      `INSERT INTO mountain_countries (mountain_id, country_id, is_country_high_point, is_shared)
       SELECT m.id, c.id, $3, (SELECT count(*) > 0 FROM mountain_countries x
         WHERE x.mountain_id = m.id) FROM mountains m, countries c
       WHERE m.slug = $1 AND c.iso3 = $2`,
      [slug, iso3, highPoint],
    );
  };
  await db.transaction(async (tx) => {
    // Kili: a massif (5,000 m) with two summits; volcanic and dormant.
    await tx.query(
      `INSERT INTO mountains (slug, name, elevation_m, elevation_source_id, elevation_confidence,
         latitude, longitude, summit_kind, peak_type, volcanic_status, range_id)
       VALUES ('kili', 'Kili', 5000, (SELECT id FROM sources), 'high', -3, 37, 'massif',
         'massif', 'dormant', (SELECT id FROM mountain_ranges WHERE slug = 'big'))`,
    );
    await tx.query(
      `INSERT INTO mountains (slug, name, elevation_m, elevation_source_id, elevation_confidence,
         latitude, longitude, summit_kind, parent_id, peak_type)
       SELECT v.slug, v.name, v.m, (SELECT id FROM sources), 'high', -3, 37, 'summit',
         (SELECT id FROM mountains WHERE slug = 'kili'), 'stratovolcano'
       FROM (VALUES ('kibo', 'Kibo', 5000), ('mawenzi', 'Mawenzi', 4800)) AS v(slug, name, m)`,
    );
  });
  await mountain('shared-peak', 4500, { range: 'big', type: 'stratovolcano', status: 'active' });
  await mountain('alpha-two', 3200, { range: 'big' });
  await mountain('beta-two', 3100, { range: 'small' });
  await mountain('beta-three', 3050, { range: 'small' });
  await mountain('gamma-hill', 900, { range: 'small' });
  await mountain('territory-peak', 5500, { territory: 'Somewhere' });
  await link('kili', 'AAA', true);
  await link('kibo', 'AAA');
  await link('mawenzi', 'AAA');
  await link('shared-peak', 'AAA');
  await link('shared-peak', 'BBB', true);
  await link('alpha-two', 'AAA');
  await link('beta-two', 'BBB');
  await link('beta-three', 'BBB');
  await link('gamma-hill', 'CCC', true);
  await db.exec(`
    INSERT INTO country_low_points (country_id, name, elevation_m, feature_type, source_id)
    SELECT c.id, v.name, v.m, v.kind::low_point_feature, (SELECT id FROM sources)
    FROM (VALUES ('AAA', 'Salt Lake', -150, 'lake'), ('BBB', 'Deep Hole', -150, 'depression'),
                 ('CCC', 'Sea', 0, 'coast')) AS v(iso3, name, m, kind)
    JOIN countries c ON c.iso3 = v.iso3;`);
  return db;
}

describe('v_harim_stats', () => {
  let db: PGlite;
  let all: Record<string, StatRow>;

  beforeAll(async () => {
    db = await fixture();
    all = await stats(db);
  });

  it('counts a massif once, a shared peak once, and leaves out territories', () => {
    // kili + shared-peak + alpha-two + beta-two + beta-three + gamma-hill (summits and the
    // territory peak are not counted).
    expect(Number(all.mountains_catalogued?.value)).toBe(6);
    expect(all.mountains_catalogued?.detail).toEqual({ countries: 3, territoryPeaks: 1 });
  });

  it('counts volcanoes by type or status, with the status breakdown', () => {
    expect(Number(all.volcanic_mountains?.value)).toBe(2);
    expect(all.volcanic_mountains?.detail).toEqual({
      active: 1,
      dormant: 1,
      extinct: 0,
      unknown: 0,
    });
  });

  it('names the tallest mountain with its highest summit, never a territory peak', () => {
    expect(Number(all.tallest_mountain?.value)).toBe(5000);
    expect(all.tallest_mountain?.entities).toEqual([
      expect.objectContaining({ slug: 'kili', summitName: 'Kibo', countries: ['AAA'] }),
    ]);
  });

  it('finds the lowest national high point', () => {
    expect(Number(all.lowest_national_high_point?.value)).toBe(900);
    expect(all.lowest_national_high_point?.entities).toEqual([
      expect.objectContaining({ iso3: 'CCC', mountain: 'gamma-hill' }),
    ]);
  });

  it('bands heights and counts peaks above 4,000 m', () => {
    expect(Number(all.peaks_above_4000?.value)).toBe(2);
    expect(all.peaks_above_4000?.detail).toEqual({
      above5000: 0,
      from4000to5000: 2,
      from3000to4000: 3,
      upTo3000: 1,
    });
  });

  it('lists ties instead of picking one', () => {
    // Alpha: kili, shared-peak, alpha-two; Beta: shared-peak, beta-two, beta-three.
    expect(Number(all.most_mountainous_country?.value)).toBe(3);
    expect(all.most_mountainous_country?.entities.map((e) => e.iso3)).toEqual(['AAA', 'BBB']);
    // Both low points are at -150 m.
    expect(Number(all.lowest_point?.value)).toBe(-150);
    expect(all.lowest_point?.entities.map((e) => e.iso3)).toEqual(['AAA', 'BBB']);
  });

  it('finds the busiest range and the greatest relief with negative elevations', () => {
    expect(Number(all.busiest_range?.value)).toBe(3);
    expect(all.busiest_range?.entities).toEqual([expect.objectContaining({ slug: 'big' })]);
    expect(all.busiest_range?.entities[0]?.tallest).toMatchObject({
      slug: 'kili',
      elevationM: 5000,
    });
    expect(Number(all.greatest_relief?.value)).toBe(5150); // 5,000 − (−150)
    expect(all.greatest_relief?.entities.map((e) => e.iso3)).toEqual(['AAA']);
  });

  it('carries confidence, review flags and other sourced heights for the band', async () => {
    expect(all.tallest_mountain?.entities[0]).toMatchObject({
      confidence: 'high',
      needsReview: false,
      alternatives: [],
    });
    await db.exec(`
      UPDATE mountains SET elevation_alternatives = '[{"m": 4990, "source": "s"}, {"m": 5003, "source": "unknown-key"}]'
      WHERE slug = 'kili';
      UPDATE mountains SET elevation_confidence = 'low', needs_review = true
      WHERE slug = 'gamma-hill';`);
    const updated = await stats(db);
    // Titles from the sources table; an unknown key falls back to the key itself.
    expect(updated.tallest_mountain?.entities[0]?.alternatives).toEqual([
      { elevationM: 4990, source: 'S' },
      { elevationM: 5003, source: 'unknown-key' },
    ]);
    expect(updated.lowest_national_high_point?.entities[0]).toMatchObject({
      confidence: 'low',
      needsReview: true,
      alternatives: [],
    });
    expect(updated.lowest_point?.entities.map((e) => e.needsReview)).toEqual([false, false]);
    // Values are unchanged by the extra fields.
    expect(Number(updated.tallest_mountain?.value)).toBe(5000);
  });

  it('hides the most-prominent card when prominence is mostly unknown', () => {
    expect(all.most_prominent_peak?.value).toBeNull();
    expect(all.most_prominent_peak?.detail).toEqual({ available: false, coverage: 0 });
  });

  it('recomputes for a region, and shows 0 (not an error) when a region has no volcanoes', async () => {
    const north = await stats(db, 'north');
    expect(all.lowest_point?.label).toBe('Lowest point in Africa');
    expect(north.lowest_point?.label).toBe('Lowest point in North Africa');
    expect(Number(north.mountains_catalogued?.value)).toBe(1);
    expect(north.mountains_catalogued?.detail).toEqual({ countries: 1, territoryPeaks: 0 });
    expect(Number(north.volcanic_mountains?.value)).toBe(0);
    expect(north.tallest_mountain?.entities).toEqual([
      expect.objectContaining({ slug: 'gamma-hill' }),
    ]);
    expect(north.most_mountainous_country?.value).toBeNull();
    expect(north.most_mountainous_country?.entities).toEqual([]);
    const east = await stats(db, 'east');
    expect(Number(east.mountains_catalogued?.value)).toBe(5);
  });

  it('documents every statistic, word for word, in docs/harim-stats.md', () => {
    const docs = readFileSync(
      join(import.meta.dirname, '..', '..', 'docs', 'harim-stats.md'),
      'utf8',
    );
    for (const row of Object.values(all)) {
      expect(docs).toContain(`\`${row.key}\``);
      expect(docs).toContain(row.definition);
    }
  });
});

describe('v_range_summary', () => {
  it('counts each range once per mountain and tints it by the country with most peaks', async () => {
    const db = await fixture();
    const { rows } = await db.query<{
      slug: string;
      peak_count: number;
      tallest_slug: string;
      heights: number[];
      country_iso3s: string[];
      region_slugs: string[];
      tint_region: string | null;
    }>(
      `SELECT slug, peak_count, tallest_slug, heights, country_iso3s, region_slugs, tint_region
       FROM v_range_summary ORDER BY slug`,
    );
    const big = rows.find((r) => r.slug === 'big');
    // The massif counts once (not its summits); the border peak once.
    expect(big).toMatchObject({
      peak_count: 3,
      tallest_slug: 'kili',
      heights: [5000, 4500, 3200],
      country_iso3s: ['AAA', 'BBB'],
      tint_region: 'east',
    });
    const small = rows.find((r) => r.slug === 'small');
    expect(small?.country_iso3s).toEqual(['BBB', 'CCC']);
    expect([...(small?.region_slugs ?? [])].sort()).toEqual(['east', 'north']);
    expect(small?.tint_region).toBe('east');
    // A tie between countries in different regions is "split": no tint.
    await db.exec(`
      INSERT INTO mountains (slug, name, elevation_m, elevation_source_id, elevation_confidence,
        latitude, longitude, summit_kind, range_id)
      VALUES ('gamma-two', 'Gamma Two', 950, (SELECT id FROM sources), 'high', 30, 5,
        'standalone', (SELECT id FROM mountain_ranges WHERE slug = 'small'));
      INSERT INTO mountain_countries (mountain_id, country_id, is_country_high_point, is_shared)
      SELECT m.id, c.id, false, false FROM mountains m, countries c
      WHERE m.slug = 'gamma-two' AND c.iso3 = 'CCC';`);
    const split = await db.query<{ tint_region: string | null }>(
      "SELECT tint_region FROM v_range_summary WHERE slug = 'small'",
    );
    expect(split.rows[0]?.tint_region).toBeNull();
  });
});

describe('v_country_mountain_summary', () => {
  it('gives one row per country with the counting rule applied', async () => {
    const db = await fixture();
    const rows = await db.query<{
      iso3: string;
      highest_peak_slug: string;
      highest_summit_name: string | null;
      high_point_shared_with: string[];
      peak_count: number;
      range_names: string[];
      relief_m: number;
    }>('SELECT * FROM v_country_mountain_summary ORDER BY iso3');
    expect(rows.rows.map((r) => [r.iso3, r.highest_peak_slug, r.peak_count])).toEqual([
      ['AAA', 'kili', 3],
      ['BBB', 'shared-peak', 3],
      ['CCC', 'gamma-hill', 1],
    ]);
    const [alpha, beta] = rows.rows;
    expect(alpha?.highest_summit_name).toBe('Kibo');
    expect(alpha?.range_names).toEqual(['Big Range']);
    expect(beta?.high_point_shared_with).toEqual(['AAA']);
    expect(beta?.range_names).toEqual(['Small Range', 'Big Range']);
    expect(alpha?.relief_m).toBe(5150);
  });
});

describe('with the committed catalogue', () => {
  it('computes every card for Africa and each region', async () => {
    const db = await seededDb();
    const africa = await stats(db);
    expect(Number(africa.tallest_mountain?.value)).toBe(5895);
    expect(africa.tallest_mountain?.entities).toEqual([
      expect.objectContaining({ slug: 'mount-kilimanjaro', countries: ['TZA'] }),
    ]);
    expect(africa.lowest_point?.entities).toEqual([expect.objectContaining({ iso3: 'DJI' })]);
    expect(Number(africa.lowest_point?.value)).toBe(-155);
    for (const region of ['north', 'west', 'central', 'east', 'southern']) {
      const scoped = await stats(db, region);
      expect(Object.keys(scoped)).toHaveLength(10);
      expect(Number(scoped.mountains_catalogued?.value)).toBeGreaterThan(0);
    }
    const summary = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM v_country_mountain_summary WHERE highest_peak_slug IS NOT NULL',
    );
    expect(summary.rows[0]?.n).toBe(54);
  });
});
