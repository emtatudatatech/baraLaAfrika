import { useEffect, useRef, useState } from 'react';

/* Small chart helpers for the Dhahabu charts (hand-written SVG; no chart library). */

/** A step of 1, 2, 2.5 or 5 × 10^k giving about `count` intervals up to `max`. */
export function niceStep(max: number, count = 4): number {
  if (!(max > 0)) return 1;
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10;
  return step * magnitude;
}

/** Axis ticks from 0 to a round value at or above `max`. */
export function niceTicks(max: number, count = 4): number[] {
  const step = niceStep(max, count);
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step)
    ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** A linear map from a domain to a range. */
export function linear(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): (value: number) => number {
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** An SVG path through the points; a null y breaks the line (no data is never bridged). */
export function linePath(points: readonly { x: number; y: number | null }[]): string {
  let path = '';
  let pen = false;
  for (const { x, y } of points) {
    if (y === null) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  }
  return path;
}

/** Year ticks for an axis: every 1, 2, 5, 10 or 20 years so that at most `max` show. */
export function yearTicks(from: number, to: number, max = 8): number[] {
  const span = Math.max(1, to - from);
  const step = [1, 2, 5, 10, 20, 50].find((s) => span / s <= max) ?? 50;
  const first = Math.ceil(from / step) * step;
  const ticks: number[] = [];
  for (let year = first; year <= to; year += step) ticks.push(year);
  return ticks;
}

/** A period (`2021` or `2021-09`) as a fractional year, at the middle of the period. */
export function periodToYear(period: string): number {
  const [year, month] = period.split('-').map(Number);
  if (month === undefined || Number.isNaN(month)) return (year ?? 0) + 0.5;
  return (year ?? 0) + (month - 0.5) / 12;
}

/** The width of an element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width] as const;
}
