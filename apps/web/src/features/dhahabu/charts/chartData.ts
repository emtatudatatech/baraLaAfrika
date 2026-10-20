import type { GoldCountry, GoldSeriesResponse } from '@bla/shared';

/* What the Dhahabu charts select from the data (kept apart from the components for tests). */

/** The production year the top-producers chart shows: the latest complete one, else the latest. */
export function producersYear(totals: GoldSeriesResponse['totals']): number | null {
  const years = totals ?? [];
  return (years.filter((t) => t.complete).at(-1) ?? years.at(-1))?.year ?? null;
}

const HOLDERS = 5;

/** The largest holders at the reference year (most tonnes first; ties by name). */
export function largestHolders(rows: readonly GoldCountry[], count = HOLDERS): GoldCountry[] {
  return rows
    .filter((row) => row.holdings !== null && row.holdings.tonnes > 0)
    .sort(
      (a, b) =>
        (b.holdings?.tonnes ?? 0) - (a.holdings?.tonnes ?? 0) ||
        a.country.name.localeCompare(b.country.name, 'en'),
    )
    .slice(0, count);
}

/** Direct labels at the lines' ends, pushed apart so none overlap (at least `gap` px). */
export function spreadLabels(ys: readonly number[], gap = 14): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k += 1) {
    const prev = order[k - 1];
    const item = order[k];
    if (prev && item && item.y - prev.y < gap) item.y = prev.y + gap;
  }
  const out = new Array<number>(ys.length);
  for (const { y, i } of order) out[i] = y;
  return out;
}
