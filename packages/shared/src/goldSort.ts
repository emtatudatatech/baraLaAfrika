import type { GoldSort, GoldSortKey } from './goldConstants.ts';

/*
 * The country table's sort, shared by /api/gold/countries and the page (which sorts the rows it
 * has already loaded). Zod-free: it describes only the fields it reads.
 */

export interface GoldSortable {
  country: { name: string };
  production: { tonnes: number | null } | null;
  exports: { reported: { valueUsd: number } | null };
  holdings: { tonnes: number } | null;
  exportShare: { pct: number | null } | null;
}

/** The number a sort key compares; null for no data (which sorts last in both directions). */
export function goldSortValue(row: GoldSortable, key: GoldSortKey): number | null {
  switch (key) {
    case 'production':
      return row.production?.tonnes ?? null;
    case 'exports':
      return row.exports.reported?.valueUsd ?? null;
    case 'holdings':
      return row.holdings?.tonnes ?? null;
    case 'share':
      return row.exportShare?.pct ?? null;
    case 'name':
      return null;
  }
}

/**
 * Names A–Z; figures largest first; a leading `-` reverses. Missing figures always go last,
 * whatever the direction, and ties fall back to the name.
 */
export function sortGoldCountries<T extends GoldSortable>(rows: readonly T[], sort: GoldSort): T[] {
  const reverse = sort.startsWith('-');
  const key = (reverse ? sort.slice(1) : sort) as GoldSortKey;
  const byName = (a: T, b: T) => a.country.name.localeCompare(b.country.name, 'en');
  return [...rows].sort((a, b) => {
    if (key === 'name') return reverse ? byName(b, a) : byName(a, b);
    const x = goldSortValue(a, key);
    const y = goldSortValue(b, key);
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    const order = reverse ? x - y : y - x;
    return order === 0 ? byName(a, b) : order;
  });
}
