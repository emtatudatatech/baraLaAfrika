import { type CountryRef, type Mountain, ULTRA_PROMINENCE_M } from '@bla/shared';

import { strings } from '../../lib/strings';

const text = strings.harim;

export function isUltra(prominenceM: number | null): boolean {
  return prominenceM !== null && prominenceM >= ULTRA_PROMINENCE_M;
}

/** "Stratovolcano · Active", "Peak", "Volcano · Status unknown". */
export function peakTypeLabel(
  mountain: Pick<Mountain, 'peakType' | 'isVolcanic' | 'volcanicStatus'>,
) {
  const parts: string[] = [];
  if (mountain.peakType !== null) parts.push(text.peakTypes[mountain.peakType]);
  if (mountain.isVolcanic) {
    parts.push(text.volcanicStatus[mountain.volcanicStatus ?? 'unknown']);
  }
  return parts.length > 0 ? parts.join(' · ') : text.unknown;
}

export function countryNames(
  iso3s: readonly string[],
  countries: ReadonlyMap<string, CountryRef>,
): string[] {
  return iso3s.map((iso3) => countries.get(iso3)?.name ?? iso3);
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Peaks near a mountain for its page: those in the same range or sharing a country, nearest
 * first (the mountain, its massif and its summits are left out).
 */
export function nearbyPeaks<
  T extends {
    slug: string;
    lat: number;
    lon: number;
    countries: readonly string[];
    range: { slug: string } | null;
  },
>(
  of: T & { parent: { slug: string } | null; summits: readonly { slug: string }[] },
  all: readonly T[],
  limit = 6,
): (T & { km: number })[] {
  const skip = new Set([of.slug, of.parent?.slug, ...of.summits.map((s) => s.slug)]);
  return all
    .filter(
      (m) =>
        !skip.has(m.slug) &&
        ((of.range !== null && m.range?.slug === of.range.slug) ||
          m.countries.some((iso3) => of.countries.includes(iso3))),
    )
    .map((m) => ({ ...m, km: distanceKm(of, m) }))
    .sort((a, b) => a.km - b.km || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}
