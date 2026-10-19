import type { GoldSort, GoldStat, GoldStatKey, GoldUnit, PresenceTier } from '@bla/shared';

import { formatMass, formatMonth, formatPct, formatPrice, formatUsd } from '../../lib/goldUnits';
import { strings } from '../../lib/strings';

/*
 * The statistics band's rules that are not presentation: what a click on a card does, which
 * period it shows, and how its value is written. Values themselves come from the API
 * (v_gold_stats); nothing here recomputes them.
 */

const text = strings.dhahabu.stats;
const count = new Intl.NumberFormat('en');

/** The colour token of a presence tier. */
export function tierColour(tier: PresenceTier): string {
  return `var(--presence-${tier.replaceAll('_', '-')})`;
}

const MONTHLY: readonly GoldStatKey[] = [
  'central_bank_gold',
  'largest_holder',
  'gold_price',
  'largest_net_buyer',
];

export type GoldStatAction = { kind: 'sort'; sort: GoldSort } | { kind: 'country'; iso3: string };

/** What a click on a card (or one of its tied countries) does; null when it does nothing. */
export function goldStatAction(stat: GoldStat, index = 0): GoldStatAction | null {
  switch (stat.key) {
    case 'gold_producing_countries':
    case 'africa_production':
    case 'production_value':
      return { kind: 'sort', sort: 'production' };
    case 'central_bank_gold':
      return { kind: 'sort', sort: 'holdings' };
    case 'gold_price':
      return null;
    case 'largest_producer':
    case 'largest_holder':
    case 'most_gold_dependent':
    case 'biggest_reporting_gap':
    case 'largest_net_buyer': {
      const entity = stat.entities[index];
      return entity ? { kind: 'country', iso3: entity.iso3 } : null;
    }
  }
}

/** The period a card describes: a year, a month, or the latest evidence. */
export function statPeriod(stat: GoldStat): string | null {
  if (stat.asOf === null) return stat.key === 'gold_producing_countries' ? text.latest : null;
  return MONTHLY.includes(stat.key) ? formatMonth(stat.asOf) : stat.asOf.slice(0, 4);
}

/** A card's value as text, in the viewer's unit. */
export function formatStatValue(stat: GoldStat, value: number, unit: GoldUnit): string {
  switch (stat.unit) {
    case 't':
      return formatMass(value, unit, { sign: stat.key === 'largest_net_buyer' });
    case 'USD':
      return formatUsd(value);
    case 'USD/oz':
      return formatPrice(value);
    case '%':
      return formatPct(value);
    default:
      return count.format(Math.round(value));
  }
}
