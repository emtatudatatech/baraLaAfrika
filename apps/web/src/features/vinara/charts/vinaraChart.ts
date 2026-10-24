import type { VinaraMetric } from '@bla/shared';

import { formatMoney } from '../vinaraFormat';

/* Helpers for Vinara's hand-written SVG charts: domains that may go below zero, signed bars. */

/** A step of 1, 2, 2.5 or 5 × 10^k giving about `count` intervals over `span`. */
function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10;
  return step * magnitude;
}

/**
 * Round ticks covering the values and zero (bars start at zero; lines of levels keep it as their
 * floor, so a gap is never exaggerated). Negative values extend the axis below zero.
 */
export function niceTicks(values: readonly number[], count = 4): number[] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const step = niceStep(max - min || Math.abs(max) || 1, count);
  const low = Math.floor(min / step + 1e-9) * step;
  const high = Math.max(low + step, Math.ceil(max / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

/**
 * A horizontal bar from `zero` to `end`, rounded only at its data end (4px), so a bar going left
 * (a loss) is rounded on the left.
 */
export function signedBarPath(zero: number, end: number, y: number, height: number, radius = 4) {
  const w = Math.abs(end - zero);
  const r = Math.min(radius, w, height / 2);
  const dir = end >= zero ? 1 : -1;
  const sweep = dir === 1 ? 1 : 0;
  const f = (n: number) => String(Number(n.toFixed(2)));
  return [
    `M${f(zero)},${f(y)}`,
    `h${f(dir * (w - r))}`,
    `a${f(r)},${f(r)} 0 0 ${String(sweep)} ${f(dir * r)},${f(r)}`,
    `v${f(height - 2 * r)}`,
    `a${f(r)},${f(r)} 0 0 ${String(sweep)} ${f(-dir * r)},${f(r)}`,
    `h${f(-dir * (w - r))}`,
    'Z',
  ].join('');
}

/** A short axis label for a metric's values: "200m", "US$400 bn", "5%", "0.6". */
export function tickLabel(metric: Pick<VinaraMetric, 'unit'>, value: number): string {
  switch (metric.unit) {
    case 'people': {
      // 200,000,000 → "200m"; 1,500,000,000 → "1.5bn".
      const compact = (n: number) => String(Number(n.toFixed(1)));
      if (Math.abs(value) >= 1e9) return `${compact(value / 1e9)}bn`;
      return value === 0 ? '0' : `${compact(value / 1e6)}m`;
    }
    case 'km2':
      return value >= 1e6
        ? `${String(Number((value / 1e6).toFixed(1)))}m`
        : `${String(Math.round(value / 1000))}k`;
    case 'current_usd':
      return value === 0 ? '0' : formatMoney(value, 'US$');
    case 'current_intl_usd':
      return value === 0
        ? '0'
        : Math.abs(value) < 1e6
          ? `Int$${String(Math.round(value / 1000))}k`
          : formatMoney(value, 'Int$');
    case 'percent':
    case 'percent_of_gdp':
      return `${String(Number(value.toFixed(1)))}%`;
    default:
      return String(Number(value.toFixed(2)));
  }
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${String(n)}${suffix}`;
}
