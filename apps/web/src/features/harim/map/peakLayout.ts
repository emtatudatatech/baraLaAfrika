/*
 * The Harim map's layout rules, kept free of React and the DOM so they can be tested:
 * glyph sizes, which peaks show at a zoom level, grouping of tight clusters, and a greedy
 * label placer. Positions are screen pixels (after the map's zoom is applied).
 */

/** Glyph half-width bounds (px): a square-root scale of height, so area tracks height. */
export const GLYPH_MIN = 5;
export const GLYPH_MAX = 15;
const HEIGHT_DOMAIN_MAX = 6000;

export function glyphHalfWidth(elevationM: number, scale = 1): number {
  const share = Math.sqrt(Math.max(0, Math.min(elevationM, HEIGHT_DOMAIN_MAX)) / HEIGHT_DOMAIN_MAX);
  return (GLYPH_MIN + (GLYPH_MAX - GLYPH_MIN) * share) * scale;
}

/** Smaller maps (phones) get smaller glyphs and fewer peaks: 1 from 900px wide, 0.6 at most. */
export function mapScale(width: number): number {
  return Math.max(0.6, Math.min(1, width / 900));
}

/** An upward triangle centred on its point; returns the path and its bounding box. */
export function glyphPath(x: number, y: number, r: number): string {
  const top = y - r * 1.1;
  const base = y + r * 0.7;
  return `M${fmt(x)},${fmt(top)}L${fmt(x + r)},${fmt(base)}L${fmt(x - r)},${fmt(base)}Z`;
}

function fmt(value: number): string {
  return value.toFixed(1);
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function glyphBox(x: number, y: number, r: number): Box {
  return { x0: x - r, y0: y - r * 1.1, x1: x + r, y1: y + r * 0.7 };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export interface LayoutPeak {
  slug: string;
  name: string;
  elevationM: number;
  /** Screen position. */
  x: number;
  y: number;
  isHighPoint: boolean;
  rangeName: string | null;
}

/** Map order: national high points first, then by height (tallest first), then slug. */
export function byPriority<T extends Pick<LayoutPeak, 'slug' | 'elevationM' | 'isHighPoint'>>(
  a: T,
  b: T,
): number {
  if (a.isHighPoint !== b.isHighPoint) return a.isHighPoint ? -1 : 1;
  return b.elevationM - a.elevationM || a.slug.localeCompare(b.slug);
}

/**
 * How many peaks beyond the national high points show at zoom `k`: the top 25 at the start,
 * more as you zoom in, and every peak from 4× on.
 */
export function visibleLimit(k: number, scale = 1): number {
  if (k >= 4) return Number.POSITIVE_INFINITY;
  return Math.round(25 * Math.max(1, k) ** 2 * scale ** 2);
}

/** The peaks to draw at zoom `k`: every high point, plus the tallest others up to the limit. */
export function declutter<T extends LayoutPeak>(peaks: readonly T[], k: number, scale = 1): T[] {
  const ordered = [...peaks].sort(byPriority);
  const limit = visibleLimit(k, scale);
  let others = 0;
  return ordered.filter((peak) => {
    if (peak.isHighPoint) return true;
    others += 1;
    return others <= limit;
  });
}

export interface Cluster<T extends LayoutPeak> {
  /** The highest-priority member: where the group is drawn. */
  lead: T;
  members: T[];
  /** "Rwenzori ×6" when all members share a range, else "Mount Stanley +5". */
  label: string;
}

/** Peaks closer than this (px, between centres) are drawn as one group (glyphs would touch). */
export const CLUSTER_RADIUS = 20;

/**
 * Greedy grouping in priority order: each peak joins the first group whose lead is within
 * `radius` px (or close enough for their glyphs to touch, given `sizeOf`), or starts a new
 * group. Groups split as the map zooms in (distances grow).
 */
export function clusterPeaks<T extends LayoutPeak>(
  peaks: readonly T[],
  radius = CLUSTER_RADIUS,
  sizeOf?: (peak: T) => number,
): Cluster<T>[] {
  const groups: { lead: T; members: T[] }[] = [];
  for (const peak of [...peaks].sort(byPriority)) {
    const group = groups.find((candidate) => {
      const touching = sizeOf ? (sizeOf(candidate.lead) + sizeOf(peak)) * 0.9 : 0;
      return (
        Math.hypot(candidate.lead.x - peak.x, candidate.lead.y - peak.y) <
        Math.max(radius, touching)
      );
    });
    if (group) group.members.push(peak);
    else groups.push({ lead: peak, members: [peak] });
  }
  return groups.map(({ lead, members }) => {
    const ranges = new Set(members.map((member) => member.rangeName));
    const [range] = ranges;
    const label =
      members.length === 1
        ? lead.name
        : ranges.size === 1 && range
          ? `${shortRange(range)} ×${String(members.length)}`
          : `${lead.name} +${String(members.length - 1)}`;
    return { lead, members, label };
  });
}

/** "Rwenzori Mountains" → "Rwenzori" for a compact badge. */
export function shortRange(name: string): string {
  const short = name.replace(/\s+(Mountains|Range|Massif|Highlands|Mounts)$/i, '');
  return short === '' ? name : short;
}

export interface Label {
  slug: string;
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
  box: Box;
}

export interface LabelOptions {
  width: number;
  height: number;
  /** Text width in px at the label font size. */
  measure: (text: string) => number;
  fontSize: number;
  /** Space kept clear around the map's edges. */
  margin?: number;
  /** Areas labels must avoid (map controls, group badges). */
  obstacles?: readonly Box[];
}

/**
 * Greedy label placement in priority order (taller peaks first): try right, left, above and
 * below the glyph; keep the first spot that overlaps no placed label, no glyph and stays inside
 * the map. Labels that do not fit are left out, so more appear as the map zooms in.
 */
export function placeLabels(
  items: readonly { slug: string; text: string; x: number; y: number; r: number }[],
  { width, height, measure, fontSize, margin = 4, obstacles = [] }: LabelOptions,
): Label[] {
  const glyphs = items.map((item) => glyphBox(item.x, item.y, item.r));
  const placed: Label[] = [];
  const lineHeight = fontSize * 1.2;
  const inside = (box: Box) =>
    box.x0 >= margin && box.y0 >= margin && box.x1 <= width - margin && box.y1 <= height - margin;

  items.forEach((item, index) => {
    const textWidth = measure(item.text);
    const gap = 3;
    const candidates: Omit<Label, 'slug' | 'text'>[] = [
      {
        x: item.x + item.r + gap,
        y: item.y,
        anchor: 'start',
        box: box(item.x + item.r + gap, item.y - lineHeight / 2, textWidth, lineHeight),
      },
      {
        x: item.x - item.r - gap,
        y: item.y,
        anchor: 'end',
        box: box(item.x - item.r - gap - textWidth, item.y - lineHeight / 2, textWidth, lineHeight),
      },
      {
        x: item.x,
        y: item.y - item.r * 1.1 - gap - lineHeight / 2,
        anchor: 'middle',
        box: box(
          item.x - textWidth / 2,
          item.y - item.r * 1.1 - gap - lineHeight,
          textWidth,
          lineHeight,
        ),
      },
      {
        x: item.x,
        y: item.y + item.r * 0.7 + gap + lineHeight / 2,
        anchor: 'middle',
        box: box(item.x - textWidth / 2, item.y + item.r * 0.7 + gap, textWidth, lineHeight),
      },
    ];
    const spot = candidates.find(
      (candidate) =>
        inside(candidate.box) &&
        !obstacles.some((obstacle) => overlaps(obstacle, candidate.box)) &&
        !placed.some((label) => overlaps(label.box, candidate.box)) &&
        !glyphs.some((glyph, other) => other !== index && overlaps(glyph, candidate.box)),
    );
    if (spot) placed.push({ slug: item.slug, text: item.text, ...spot });
  });
  return placed;
}

function box(x: number, y: number, width: number, height: number): Box {
  return { x0: x, y0: y, x1: x + width, y1: y + height };
}

/** "Area of influence" halo radius (px): illustrative only, proportional to height. */
export function haloRadius(elevationM: number): number {
  return 6 + (34 * Math.max(0, Math.min(elevationM, HEIGHT_DOMAIN_MAX))) / HEIGHT_DOMAIN_MAX;
}
