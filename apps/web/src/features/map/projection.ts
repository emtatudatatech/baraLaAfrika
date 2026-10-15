import { type GeoProjection, geoEqualEarth } from 'd3-geo';
import type { MultiPoint } from 'geojson';

/*
 * The map's default view: mainland Africa, Madagascar and the island states (Cabo Verde to
 * Mauritius). Far-flung islands such as South Africa's Prince Edward Islands (46.9°S) stay
 * reachable by panning but do not shrink the default view.
 */
export const AFRICA_BOUNDS = { west: -26, south: -36, east: 64, north: 38 } as const;

/** Points along the bounds' edges: Equal Earth meridians curve, so corners alone are not enough. */
export function boundsOutline(steps = 8): MultiPoint {
  const { west, south, east, north } = AFRICA_BOUNDS;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const lon = west + ((east - west) * i) / steps;
    const lat = south + ((north - south) * i) / steps;
    points.push([lon, south], [lon, north], [west, lat], [east, lat]);
  }
  return { type: 'MultiPoint', coordinates: points };
}

/** Equal Earth projection fitted to Africa within the given pixel box. */
export function fitAfricaProjection(width: number, height: number, padding = 16): GeoProjection {
  const pad = Math.min(padding, width / 4, height / 4);
  return geoEqualEarth().fitExtent(
    [
      [pad, pad],
      [Math.max(pad + 1, width - pad), Math.max(pad + 1, height - pad)],
    ],
    boundsOutline(),
  );
}
