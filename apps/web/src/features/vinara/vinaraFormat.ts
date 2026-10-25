import type { VinaraMetric } from '@bla/shared';

import { formatPopulation } from '../countries/factsFormat';
import { strings } from '../../lib/strings';

/*
 * How Vinara's values read: each metric's unit and precision (the API rounds values to the
 * metric's precision, and equal values at it are ties, so the page shows that precision too).
 */

const NBSP = ' ';
const MINUS = '−';

type Formattable = Pick<VinaraMetric, 'key' | 'unit' | 'decimals'>;

function fixed(value: number, digits: number): string {
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
}

function signed(value: number, text: string, sign: boolean): string {
  if (value < 0) return `${MINUS}${text}`;
  return sign && value > 0 ? `+${text}` : text;
}

/** US$427 bn, US$1.23 tn, US$812 m: three significant figures at most. */
export function formatMoney(value: number, prefix: string): string {
  const size = Math.abs(value);
  const scaled = (divisor: number, suffix: string) => {
    const n = size / divisor;
    return `${fixed(n, n >= 100 ? 0 : n >= 10 ? 1 : 2)}${NBSP}${suffix}`;
  };
  let text: string;
  if (size >= 1e12) text = scaled(1e12, 'tn');
  else if (size >= 1e9) text = scaled(1e9, 'bn');
  else if (size >= 1e6) text = scaled(1e6, 'm');
  else text = fixed(size, 0);
  return signed(value, `${prefix}${text}`, false);
}

/** A metric's value as the page shows it, with its unit. */
export function formatVinaraValue(metric: Formattable, value: number): string {
  const units = strings.vinara.units;
  switch (metric.unit) {
    case 'people':
      return formatPopulation(value);
    case 'km2':
      return `${fixed(value, 0)}${NBSP}km²`;
    case 'current_usd':
      return formatMoney(value, 'US$');
    case 'current_intl_usd':
      // Per person in full (Int$35,854); totals abbreviated (Int$2.39 tn).
      return Math.abs(value) < 1e6
        ? signed(value, `Int$${fixed(value, 0)}`, false)
        : formatMoney(value, 'Int$');
    case 'percent_of_gdp':
      return `${fixed(value, metric.decimals)}%${NBSP}${units.ofGdp}`;
    case 'index':
      return fixed(value, metric.decimals);
    case 'percent': {
      const text = `${fixed(value, metric.decimals)}%`;
      // A currency's change carries its sign; growth and inflation are means per year.
      if (metric.key === 'currency_performance') return signed(value, text, true);
      if (metric.key === 'gdp_growth' || metric.key === 'inflation') {
        return `${signed(value, text, false)}${NBSP}${units.perYear}`;
      }
      return signed(value, text, false);
    }
    default:
      return signed(value, fixed(value, metric.decimals), false);
  }
}

/** "2016–2025", or one year. */
export function formatWindow(window: { from: number; to: number }): string {
  return window.from === window.to
    ? String(window.from)
    : `${String(window.from)}–${String(window.to)}`;
}

/** A share 0–1 as a whole percentage: 0.873 → "87%". */
export function formatShare(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}
