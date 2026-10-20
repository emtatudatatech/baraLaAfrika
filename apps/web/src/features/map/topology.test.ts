import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { nextCountry } from './keyboard';
import { boundsOutline, fitAfricaProjection } from './projection';
import { type CountriesTopology, buildMapGeometry } from './topology';

// Vitest runs from the repo root; this is the file the boundaries pipeline writes.
const topology = JSON.parse(
  readFileSync(resolve(process.cwd(), 'apps/web/public/geo/africa.topo.json'), 'utf8'),
) as CountriesTopology;

describe('buildMapGeometry', () => {
  const geometry = buildMapGeometry(topology);

  it('yields one shape per country plus Western Sahara', () => {
    expect(geometry.shapes).toHaveLength(55);
    expect(new Set(geometry.shapes.map((s) => s.iso3)).size).toBe(55);
    expect(geometry.shapes.filter((s) => s.disputed).map((s) => s.iso3)).toEqual(['ESH']);
  });

  it('merges Somaliland into Somalia (one shape, no internal border)', () => {
    const somaliaParts = topology.objects.countries.geometries.filter(
      (g) => (g.properties as { iso3?: string } | undefined)?.iso3 === 'SOM',
    );
    expect(somaliaParts).toHaveLength(2);
    const somalia = geometry.shapes.find((s) => s.iso3 === 'SOM');
    expect(somalia?.geometry.type).toBe('MultiPolygon');
    // Merged: the two touching parts become a single polygon outline.
    expect(somalia?.geometry.coordinates).toHaveLength(1);
  });

  it('draws borders and coastlines as separate meshes', () => {
    expect(geometry.borders.coordinates.length).toBeGreaterThan(50);
    expect(geometry.coast.coordinates.length).toBeGreaterThan(20);
  });
});

describe('fitAfricaProjection', () => {
  it.each([
    [1300, 640],
    [358, 340],
    [1000, 1000],
  ])('fits Africa inside a %ix%i box', (width, height) => {
    const projection = fitAfricaProjection(width, height, 16);
    for (const point of boundsOutline().coordinates) {
      const projected = projection(point as [number, number]);
      expect(projected).not.toBeNull();
      const [x, y] = projected ?? [NaN, NaN];
      expect(x).toBeGreaterThanOrEqual(15.5);
      expect(x).toBeLessThanOrEqual(width - 15.5);
      expect(y).toBeGreaterThanOrEqual(15.5);
      expect(y).toBeLessThanOrEqual(height - 15.5);
    }
  });
});

describe('nextCountry (roving keyboard focus)', () => {
  const order = ['AGO', 'BEN', 'KEN'];
  it('moves forward and back with wrapping, and jumps with Home/End', () => {
    expect(nextCountry(order, 'BEN', 'ArrowRight')).toBe('KEN');
    expect(nextCountry(order, 'KEN', 'ArrowDown')).toBe('AGO');
    expect(nextCountry(order, 'AGO', 'ArrowLeft')).toBe('KEN');
    expect(nextCountry(order, 'BEN', 'Home')).toBe('AGO');
    expect(nextCountry(order, 'BEN', 'End')).toBe('KEN');
    expect(nextCountry(order, 'BEN', 'a')).toBeNull();
  });
});
