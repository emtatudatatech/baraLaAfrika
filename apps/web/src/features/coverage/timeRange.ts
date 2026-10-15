import type { CoverageDataset } from '@bla/shared';

/*
 * The shared year range for time-series views (?from=&to=). Its bounds come from the coverage
 * of the route's datasets, so a range can never extend beyond the data ("never extrapolate").
 * With no params the range is the full coverage; the end year is the reference year for
 * tables, maps and cards.
 */

export interface YearRange {
  start: number;
  end: number;
}

export const PRESETS = ['last5', 'last10', 'since2000', 'all'] as const;
export type Preset = (typeof PRESETS)[number];

const year = (iso: string) => Number(iso.slice(0, 4));

/** The years covered by the datasets that are series; null when none has coverage. */
export function boundsOf(datasets: readonly CoverageDataset[]): YearRange | null {
  let start = Infinity;
  let end = -Infinity;
  for (const { coverageStart, coverageEnd } of datasets) {
    if (coverageStart !== null) start = Math.min(start, year(coverageStart));
    if (coverageEnd !== null) end = Math.max(end, year(coverageEnd));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

function parseYear(value: string | null): number | null {
  return value !== null && /^\d{4}$/.test(value) ? Number(value) : null;
}

const clamp = (value: number, { start, end }: YearRange) => Math.min(end, Math.max(start, value));

/**
 * Reads ?from=&to= against the bounds: missing values default to the bounds, values outside
 * are clamped to them, and a reversed range is put in order. Null without bounds (no data).
 */
export function resolveRange(params: URLSearchParams, bounds: YearRange | null): YearRange | null {
  if (bounds === null) return null;
  const from = clamp(parseYear(params.get('from')) ?? bounds.start, bounds);
  const to = clamp(parseYear(params.get('to')) ?? bounds.end, bounds);
  return { start: Math.min(from, to), end: Math.max(from, to) };
}

/** Writes a range to the params; the full coverage is the default and leaves no params. */
export function applyRange(
  current: URLSearchParams,
  range: YearRange,
  bounds: YearRange,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const start = clamp(Math.min(range.start, range.end), bounds);
  const end = clamp(Math.max(range.start, range.end), bounds);
  if (start === bounds.start) next.delete('from');
  else next.set('from', String(start));
  if (end === bounds.end) next.delete('to');
  else next.set('to', String(end));
  return next;
}

export function presetRange(preset: Preset, bounds: YearRange): YearRange {
  const { start, end } = bounds;
  switch (preset) {
    case 'last5':
      return { start: Math.max(start, end - 4), end };
    case 'last10':
      return { start: Math.max(start, end - 9), end };
    case 'since2000':
      return { start: Math.min(end, Math.max(start, 2000)), end };
    case 'all':
      return bounds;
  }
}

/** Whether a preset produces exactly this range (with short coverage, several can). */
export function matchesPreset(preset: Preset, range: YearRange, bounds: YearRange): boolean {
  const candidate = presetRange(preset, bounds);
  return candidate.start === range.start && candidate.end === range.end;
}

export function formatRange({ start, end }: YearRange): string {
  return start === end ? String(start) : `${String(start)}–${String(end)}`;
}
