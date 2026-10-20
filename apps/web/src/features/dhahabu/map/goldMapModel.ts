import type { GoldCountry, GoldMapMetric, GoldUnit } from '@bla/shared';

import { formatMass, formatMonth, formatPct, formatUsd } from '../../../lib/goldUnits';

/*
 * What the Dhahabu map draws for each country: a value with its own year or month, "no data",
 * or (production only) "included in other countries". Metric maps use five classes of the
 * sequential gold ramp; the presence map uses the tiers. No data is never drawn as a value.
 */

export type MetricMark =
  | { kind: 'value'; value: number; period: string }
  | { kind: 'none' }
  | { kind: 'included'; period: string };

/** The mark a country gets for a value metric (not presence). */
export function metricMark(
  row: GoldCountry,
  metric: Exclude<GoldMapMetric, 'presence'>,
): MetricMark {
  switch (metric) {
    case 'production': {
      const p = row.production;
      if (p === null) return { kind: 'none' };
      if (p.tonnes === null) return { kind: 'included', period: String(p.year) };
      return { kind: 'value', value: p.tonnes, period: String(p.year) };
    }
    case 'holdings': {
      const h = row.holdings;
      return h === null
        ? { kind: 'none' }
        : { kind: 'value', value: h.tonnes, period: formatMonth(h.asOf) };
    }
    case 'exports': {
      const e = row.exports.reported;
      return e === null
        ? { kind: 'none' }
        : { kind: 'value', value: e.valueUsd, period: String(e.year) };
    }
    case 'share': {
      const s = row.exportShare;
      // A share above 100% (inconsistent reports) is not drawn.
      return s?.pct == null
        ? { kind: 'none' }
        : { kind: 'value', value: s.pct, period: String(s.year) };
    }
  }
}

/** Rounds to two significant figures (for readable class breaks). */
export function roundBreak(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

/**
 * Up to four breaks splitting the values into five classes of about equal counts (quantiles),
 * rounded to two significant figures; duplicates are dropped, so small sets get fewer classes.
 * Class i holds values below breaks[i] (the last class: the rest).
 */
export function classBreaks(values: readonly number[], classes = 5): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const breaks: number[] = [];
  for (let i = 1; i < classes; i += 1) {
    const at = sorted[Math.min(sorted.length - 1, Math.floor((i * sorted.length) / classes))] ?? 0;
    const rounded = roundBreak(at);
    const last = breaks.at(-1);
    if (rounded > 0 && rounded > (sorted[0] ?? 0) && (last === undefined || rounded > last)) {
      breaks.push(rounded);
    }
  }
  return breaks;
}

/** The class (0 = lowest) of a value. */
export function classOf(value: number, breaks: readonly number[]): number {
  const index = breaks.findIndex((limit) => value < limit);
  return index === -1 ? breaks.length : index;
}

/** The ramp step (1–5) for a class, spread over the ramp when there are fewer classes. */
export function rampStep(classIndex: number, classCount: number): number {
  if (classCount <= 1) return 3;
  return 1 + Math.round((classIndex * 4) / (classCount - 1));
}

/** A value in the metric's unit, as text. */
export function formatMetric(
  metric: Exclude<GoldMapMetric, 'presence'>,
  value: number,
  unit: GoldUnit,
): string {
  switch (metric) {
    case 'production':
    case 'holdings':
      return formatMass(value, unit);
    case 'exports':
      return formatUsd(value);
    case 'share':
      return formatPct(value);
  }
}

/** The legend's label for each class: "Under 1.2 t", "1.2–5.5 t", …, "40 t or more". */
export function classLabels(
  metric: Exclude<GoldMapMetric, 'presence'>,
  breaks: readonly number[],
  unit: GoldUnit,
  words: {
    under: (v: string) => string;
    between: (a: string, b: string) => string;
    over: (v: string) => string;
  },
): string[] {
  if (breaks.length === 0) return [words.over(formatMetric(metric, 0, unit))];
  return [
    words.under(formatMetric(metric, breaks[0] ?? 0, unit)),
    ...breaks
      .slice(1)
      .map((limit, i) =>
        words.between(
          formatMetric(metric, breaks[i] ?? 0, unit),
          formatMetric(metric, limit, unit),
        ),
      ),
    words.over(formatMetric(metric, breaks.at(-1) ?? 0, unit)),
  ];
}
