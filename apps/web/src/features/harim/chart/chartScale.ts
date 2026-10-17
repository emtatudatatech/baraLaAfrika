import type { Unit } from '../../../lib/units';
import { metresToFeet } from '@bla/shared';

/** Axis ticks (in the display unit) covering `maxM`: every 1,000 m or every 5,000 ft. */
export function heightTicks(maxM: number, unit: Unit): number[] {
  const step = unit === 'm' ? 1000 : 5000;
  const max = unit === 'm' ? maxM : metresToFeet(maxM);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** A horizontal bar with rounded data end (4px), anchored square at the baseline. */
export function barPath(x0: number, y: number, width: number, height: number, radius = 4): string {
  const w = Math.max(0, width);
  const r = Math.min(radius, w, height / 2);
  return [
    `M${String(x0)},${String(y)}`,
    `h${String(w - r)}`,
    `a${String(r)},${String(r)} 0 0 1 ${String(r)},${String(r)}`,
    `v${String(height - 2 * r)}`,
    `a${String(r)},${String(r)} 0 0 1 ${String(-r)},${String(r)}`,
    `h${String(-(w - r))}`,
    'Z',
  ].join(' ');
}

/** Shortens a label to about `maxWidth` px (estimated), with an ellipsis. */
export function truncate(label: string, maxWidth: number, charWidth = 6.4): string {
  const max = Math.floor(maxWidth / charWidth);
  return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
