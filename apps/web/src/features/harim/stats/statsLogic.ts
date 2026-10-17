import type { Confidence, HarimStat, HarimStatKey, StatAlternative } from '@bla/shared';

import type { HarimView } from '../harimQuery';

/*
 * The statistics band's rules that are not presentation: card order and size, what a click on a
 * card does, and when a height gets a "sources disagree" marker. Values themselves come from the
 * API (v_harim_stats); nothing here recomputes them.
 */

/** Hero cards first (the carousel shows them first too), then the compact cards. */
export const HERO_KEYS = [
  'mountains_catalogued',
  'volcanic_mountains',
  'tallest_mountain',
  'lowest_national_high_point',
] as const satisfies readonly HarimStatKey[];

export const COMPACT_KEYS = [
  'peaks_above_4000',
  'most_mountainous_country',
  'busiest_range',
  'lowest_point',
  'greatest_relief',
  'most_prominent_peak',
] as const satisfies readonly HarimStatKey[];

/** The cards to show, in order. The most prominent peak only when the data supports it. */
export function visibleStats(stats: readonly HarimStat[]): HarimStat[] {
  const byKey = new Map(stats.map((stat) => [stat.key, stat]));
  return [...HERO_KEYS, ...COMPACT_KEYS].flatMap((key) => {
    const stat = byKey.get(key);
    if (!stat) return [];
    if (stat.key === 'most_prominent_peak' && !stat.detail.available) return [];
    return [stat];
  });
}

export function isHero(key: HarimStatKey): boolean {
  return (HERO_KEYS as readonly string[]).includes(key);
}

export type StatAction =
  | { kind: 'peak'; slug: string }
  | { kind: 'view'; change: Partial<HarimView>; target: 'country' | 'peaks' };

/** All peaks with only the given filters (region and search are kept). */
function peaks(change: Partial<HarimView>): StatAction {
  return {
    kind: 'view',
    target: 'peaks',
    change: {
      view: 'peaks',
      sort: 'height',
      country: null,
      range: null,
      minHeight: null,
      volcanic: null,
      ...change,
    },
  };
}

function countryRow(iso3: string): StatAction {
  return {
    kind: 'view',
    target: 'country',
    change: { view: 'country', country: iso3, minHeight: null, volcanic: null, range: null },
  };
}

/**
 * What a click on a card (or on one of its tied entities) does. Peaks above 4,000 m filter from
 * 4,001 m: the bands are strict, so a peak of exactly 4,000 m is not in the card's count.
 * The busiest range filters All peaks until the range pages exist (milestone 12).
 */
export function statAction(stat: HarimStat, index = 0): StatAction | null {
  switch (stat.key) {
    case 'mountains_catalogued':
      return peaks({});
    case 'volcanic_mountains':
      return peaks({ volcanic: '1' });
    case 'peaks_above_4000':
      return peaks({ minHeight: 4001 });
    case 'tallest_mountain':
    case 'most_prominent_peak': {
      const entity = stat.entities[index];
      return entity ? { kind: 'peak', slug: entity.slug } : null;
    }
    case 'lowest_national_high_point': {
      const entity = stat.entities[index];
      return entity ? { kind: 'peak', slug: entity.mountain } : null;
    }
    case 'most_mountainous_country': {
      const entity = stat.entities[index];
      return entity ? peaks({ country: entity.iso3, minHeight: 3000 }) : null;
    }
    case 'busiest_range': {
      const entity = stat.entities[index];
      return entity ? peaks({ range: entity.slug, minHeight: 3000 }) : null;
    }
    case 'lowest_point':
    case 'greatest_relief': {
      const entity = stat.entities[index];
      return entity ? countryRow(entity.iso3) : null;
    }
  }
}

/** The review threshold: sourced heights further apart than this disagree. */
export const DISAGREE_M = 10;

/**
 * A height's caveat: shown when its confidence is low or another source differs by more than
 * 10 m. Returns the disagreeing heights (possibly none, for low confidence alone), or null.
 */
export function heightCaveat(entity: {
  elevationM: number;
  confidence: Confidence;
  alternatives: readonly StatAlternative[];
}): { lowConfidence: boolean; alternatives: StatAlternative[] } | null {
  const alternatives = entity.alternatives.filter(
    (alternative) => Math.abs(alternative.elevationM - entity.elevationM) > DISAGREE_M,
  );
  const lowConfidence = entity.confidence === 'low';
  return lowConfidence || alternatives.length > 0 ? { lowConfidence, alternatives } : null;
}

/** Shares for a stacked bar (0–1, summing to 1; all zero when the total is zero). */
export function shares<K extends string>(
  counts: Readonly<Record<K, number>>,
  order: readonly K[],
): { key: K; count: number; share: number }[] {
  const total = order.reduce((sum, key) => sum + counts[key], 0);
  return order.map((key) => ({
    key,
    count: counts[key],
    share: total > 0 ? counts[key] / total : 0,
  }));
}
