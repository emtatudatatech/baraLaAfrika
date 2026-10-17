import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { migratedDb, readJson, seededDb } from './seededDb.ts';

/** Inserts a mountain; returns its id. Defaults describe a valid standalone peak. */
async function mountain(
  db: Pick<PGlite, 'query'>,
  slug: string,
  values: Partial<Record<string, string | number | null>> = {},
): Promise<number> {
  const v = {
    elevation_m: 1000,
    latitude: -3,
    longitude: 37,
    summit_kind: 'standalone',
    parent: null,
    name_origin: null,
    territory_name: null,
    ...values,
  };
  const result = await db.query<{ id: number }>(
    `INSERT INTO mountains (slug, name, elevation_m, elevation_source_id, elevation_confidence,
       latitude, longitude, summit_kind, parent_id, name_origin, territory_name)
     VALUES ($1, $1, $2, (SELECT id FROM sources WHERE source_key = 'test'), 'high', $3, $4,
       $5::summit_kind, (SELECT id FROM mountains WHERE slug = $6), $7, $8)
     RETURNING id`,
    [
      slug,
      v.elevation_m,
      v.latitude,
      v.longitude,
      v.summit_kind,
      v.parent,
      v.name_origin,
      v.territory_name,
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('no id');
  return id;
}

describe('Harim schema rules', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migratedDb();
    await db.exec(`
      INSERT INTO sources (source_key, title, url, source_type, reliability_tier)
      VALUES ('test', 'Test', 'https://example.test', 'test', 'reference');
      INSERT INTO regions (slug, name, sort_order) VALUES ('east', 'East Africa', 4);
      INSERT INTO countries (iso2, iso3, iso_numeric, name, region_id, flag_url_template)
      SELECT 'TZ', 'TZA', 834, 'Tanzania', id, 'https://flagcdn.com/w{width}/tz.png'
      FROM regions WHERE slug = 'east';`);
  });

  it('bounds elevations and coordinates', async () => {
    await expect(mountain(db, 'too-high', { elevation_m: 6500 })).rejects.toThrow();
    await expect(mountain(db, 'negative', { elevation_m: -1 })).rejects.toThrow();
    await expect(mountain(db, 'arctic', { latitude: 70 })).rejects.toThrow();
    await expect(mountain(db, 'pacific', { longitude: 120 })).rejects.toThrow();
  });

  it('keeps the hierarchy to massif → summit', async () => {
    await mountain(db, 'standalone');
    // A summit needs a parent, the parent must be a massif, and only summits have parents.
    await expect(mountain(db, 'orphan', { summit_kind: 'summit' })).rejects.toThrow();
    await expect(
      mountain(db, 'bad-summit', { summit_kind: 'summit', parent: 'standalone' }),
    ).rejects.toThrow('must have a massif as its parent');
    await expect(mountain(db, 'child', { parent: 'standalone' })).rejects.toThrow();
  });

  it('checks at commit that a massif has summits and equals the highest', async () => {
    await expect(
      db.transaction(async (tx) => {
        await mountain(tx, 'lonely-massif', { summit_kind: 'massif', elevation_m: 3000 });
      }),
    ).rejects.toThrow('has no summits');
    await expect(
      db.transaction(async (tx) => {
        await mountain(tx, 'tall-massif', { summit_kind: 'massif', elevation_m: 3000 });
        await mountain(tx, 'short-summit', {
          summit_kind: 'summit',
          parent: 'tall-massif',
          elevation_m: 2990,
        });
      }),
    ).rejects.toThrow('its highest summit is 2990 m');
    await db.transaction(async (tx) => {
      await mountain(tx, 'massif', { summit_kind: 'massif', elevation_m: 3000 });
      await mountain(tx, 'top', { summit_kind: 'summit', parent: 'massif', elevation_m: 3000 });
      await mountain(tx, 'lower', { summit_kind: 'summit', parent: 'massif', elevation_m: 2900 });
    });
    // A massif with summits cannot become standalone.
    await expect(
      db.query("UPDATE mountains SET summit_kind = 'standalone' WHERE slug = 'massif'"),
    ).rejects.toThrow('still has summits');
  });

  it('allows one high point per country, never a summit or a territory peak', async () => {
    const link = (slug: string, highPoint: boolean) =>
      db.query(
        `INSERT INTO mountain_countries (mountain_id, country_id, is_country_high_point)
         SELECT m.id, c.id, $2 FROM mountains m, countries c WHERE m.slug = $1 AND c.iso3 = 'TZA'`,
        [slug, highPoint],
      );
    await link('massif', true);
    await mountain(db, 'second');
    await expect(link('second', true)).rejects.toThrow();
    await link('second', false);
    await expect(link('top', true)).rejects.toThrow('not one of its summits');
    await mountain(db, 'piton', { territory_name: 'Réunion' });
    await expect(link('piton', false)).rejects.toThrow('Territory peaks');
  });

  it('requires a source (or review) for name origins', async () => {
    await expect(mountain(db, 'named', { name_origin: 'Means something' })).rejects.toThrow();
  });

  it('keeps coastal low points at exactly sea level', async () => {
    const insert = (metres: number, kind: string) =>
      db.query(
        `INSERT INTO country_low_points (country_id, name, elevation_m, feature_type, source_id)
         SELECT c.id, 'Indian Ocean (sea level)', $1, $2::low_point_feature, s.id
         FROM countries c, sources s WHERE c.iso3 = 'TZA' AND s.source_key = 'test'`,
        [metres, kind],
      );
    await expect(insert(5, 'coast')).rejects.toThrow();
    await insert(0, 'coast');
  });
});

describe('committed Harim seeds', () => {
  it('load into the schema with one high point and one low point per country', async () => {
    const db = await seededDb();
    const { mountains } = readJson('db', 'seeds', 'mountains.json') as { mountains: unknown[] };
    const counts = await db.query<{ mountains: number; high: number; low: number }>(`
      SELECT (SELECT count(*)::int FROM mountains) AS mountains,
             (SELECT count(DISTINCT country_id)::int FROM mountain_countries
              WHERE is_country_high_point) AS high,
             (SELECT count(*)::int FROM country_low_points) AS low`);
    expect(counts.rows[0]).toEqual({ mountains: mountains.length, high: 54, low: 54 });
  });
});
