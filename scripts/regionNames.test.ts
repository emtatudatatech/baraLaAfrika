import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REGION_NAMES, REGION_SLUGS } from '../packages/shared/src/regions.ts';

describe('region names', () => {
  it('match the database seed (db/seeds/countries.json)', () => {
    const seed = JSON.parse(
      readFileSync(join(import.meta.dirname, '../db/seeds/countries.json'), 'utf8'),
    ) as { regions: { slug: string; name: string; sort_order: number }[] };
    const ordered = [...seed.regions].sort((a, b) => a.sort_order - b.sort_order);
    expect(ordered.map((r) => r.slug)).toEqual([...REGION_SLUGS]);
    expect(Object.fromEntries(ordered.map((r) => [r.slug, r.name]))).toEqual(REGION_NAMES);
  });
});
