import { describe, expect, it } from 'vitest';

import {
  GLYPH_MAX,
  GLYPH_MIN,
  type LayoutPeak,
  clusterPeaks,
  declutter,
  glyphBox,
  glyphHalfWidth,
  haloRadius,
  mapScale,
  overlaps,
  placeLabels,
  shortRange,
  visibleLimit,
} from './peakLayout';

function peak(
  slug: string,
  elevationM: number,
  x: number,
  y: number,
  extra: Partial<LayoutPeak> = {},
): LayoutPeak {
  return { slug, name: slug, elevationM, x, y, isHighPoint: false, rangeName: null, ...extra };
}

describe('glyph size', () => {
  it('grows with the square root of height, within its bounds', () => {
    expect(glyphHalfWidth(0)).toBe(GLYPH_MIN);
    expect(glyphHalfWidth(6000)).toBe(GLYPH_MAX);
    expect(glyphHalfWidth(9000)).toBe(GLYPH_MAX);
    expect(glyphHalfWidth(-155)).toBe(GLYPH_MIN);
    // A quarter of the height gives half the extra size (square root).
    expect(glyphHalfWidth(1500)).toBeCloseTo(GLYPH_MIN + (GLYPH_MAX - GLYPH_MIN) / 2);
    expect(glyphHalfWidth(5895)).toBeGreaterThan(glyphHalfWidth(4000));
  });

  it('shrinks glyphs and shows fewer peaks on small maps', () => {
    expect(mapScale(1200)).toBe(1);
    expect(mapScale(450)).toBe(0.6);
    expect(glyphHalfWidth(6000, 0.6)).toBeCloseTo(GLYPH_MAX * 0.6);
    expect(visibleLimit(1, 0.6)).toBe(9);
  });

  it('scales the illustrative halo with height', () => {
    expect(haloRadius(0)).toBe(6);
    expect(haloRadius(6000)).toBe(40);
    expect(haloRadius(3000)).toBe(23);
  });
});

describe('declutter', () => {
  it('keeps every national high point plus the tallest others up to the limit', () => {
    const others = Array.from({ length: 60 }, (_, i) => peak(`p${String(i)}`, 3000 - i, i, 0));
    const lowHighPoint = peak('hill', 51, 0, 0, { isHighPoint: true });
    const shown = declutter([...others, lowHighPoint], 1);
    expect(shown).toHaveLength(26);
    expect(shown[0]?.slug).toBe('hill'); // high points first
    expect(shown.slice(1).map((p) => p.slug)).toEqual(others.slice(0, 25).map((p) => p.slug));
  });

  it('shows more as the map zooms in, and everything from 4×', () => {
    expect(visibleLimit(1)).toBe(25);
    expect(visibleLimit(0.5)).toBe(25);
    expect(visibleLimit(2)).toBe(100);
    expect(visibleLimit(4)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('clusterPeaks', () => {
  const rwenzori = ['stanley', 'speke', 'baker', 'emin', 'gessi', 'luigi'].map((slug, i) =>
    peak(slug, 5109 - i * 100, 100 + i * 2, 100, { rangeName: 'Rwenzori Mountains' }),
  );

  it('groups tight peaks under the tallest, named by their shared range', () => {
    const groups = clusterPeaks([...rwenzori, peak('elsewhere', 4000, 300, 300)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.lead.slug).toBe('stanley');
    expect(groups[0]?.members).toHaveLength(6);
    expect(groups[0]?.label).toBe('Rwenzori ×6');
    expect(groups[1]?.label).toBe('elsewhere');
  });

  it('splits groups as the map zooms in (positions spread apart)', () => {
    const spread = rwenzori.map((p, i) => ({ ...p, x: 100 + i * 30 }));
    expect(clusterPeaks(spread)).toHaveLength(6);
  });

  it('groups peaks whose glyphs would touch, whatever the fixed radius', () => {
    const big = [peak('a', 5000, 100, 100), peak('b', 4900, 125, 100)];
    expect(clusterPeaks(big)).toHaveLength(2);
    expect(clusterPeaks(big, 20, (p) => glyphHalfWidth(p.elevationM))).toHaveLength(1);
  });

  it('names a mixed group by its tallest peak', () => {
    const groups = clusterPeaks([
      peak('a', 4000, 10, 10, { rangeName: 'One' }),
      peak('b', 3000, 12, 10, { rangeName: 'Two' }),
    ]);
    expect(groups[0]?.label).toBe('a +1');
  });

  it('shortens range names for badges', () => {
    expect(shortRange('Virunga Mountains')).toBe('Virunga');
    expect(shortRange('Kipengere Range')).toBe('Kipengere');
    expect(shortRange('Drakensberg')).toBe('Drakensberg');
  });
});

describe('placeLabels', () => {
  const measure = (text: string) => text.length * 6;
  const options = { width: 400, height: 300, measure, fontSize: 11 };

  it('places labels without overlapping each other or other glyphs, inside the map', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      slug: `p${String(i)}`,
      text: `Peak number ${String(i)}`,
      x: 20 + ((i * 37) % 360),
      y: 20 + ((i * 53) % 260),
      r: 8,
    }));
    const labels = placeLabels(items, options);
    expect(labels.length).toBeGreaterThan(5);
    for (const [i, a] of labels.entries()) {
      expect(a.box.x0).toBeGreaterThanOrEqual(4);
      expect(a.box.x1).toBeLessThanOrEqual(396);
      expect(a.box.y0).toBeGreaterThanOrEqual(4);
      expect(a.box.y1).toBeLessThanOrEqual(296);
      for (const b of labels.slice(i + 1)) expect(overlaps(a.box, b.box)).toBe(false);
      for (const item of items) {
        if (item.slug !== a.slug)
          expect(overlaps(a.box, glyphBox(item.x, item.y, item.r))).toBe(false);
      }
    }
  });

  it('gives the earlier (taller) peak the label when two compete', () => {
    const labels = placeLabels(
      [
        { slug: 'tall', text: 'Tall peak', x: 200, y: 150, r: 10 },
        { slug: 'short', text: 'Short peak', x: 214, y: 150, r: 6 },
      ],
      options,
    );
    expect(labels.map((l) => l.slug)).toContain('tall');
    const tall = labels.find((l) => l.slug === 'tall');
    const short = labels.find((l) => l.slug === 'short');
    if (tall && short) expect(overlaps(tall.box, short.box)).toBe(false);
  });

  it('keeps labels off obstacles such as the map controls', () => {
    const [label] = placeLabels([{ slug: 'p', text: 'Peak', x: 200, y: 150, r: 6 }], {
      ...options,
      obstacles: [{ x0: 205, y0: 100, x1: 260, y1: 200 }],
    });
    expect(label?.anchor).toBe('end');
  });

  it('moves a label to the left near the right edge', () => {
    const [label] = placeLabels([{ slug: 'edge', text: 'Edge', x: 390, y: 150, r: 6 }], options);
    expect(label?.anchor).toBe('end');
  });
});
