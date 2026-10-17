import { type CountryRef, type Mountain, heightBand } from '@bla/shared';

import { strings } from '../../../lib/strings';
import { type Unit, formatElevation } from '../../../lib/units';

/** A mountain as the map needs it. */
export interface MapPeak {
  slug: string;
  name: string;
  elevationM: number;
  lon: number;
  lat: number;
  countries: readonly string[];
  isHighPoint: boolean;
  isShared: boolean;
  territory: string | null;
  rangeName: string | null;
  mountain: Mountain;
}

export function toMapPeak(mountain: Mountain): MapPeak {
  return {
    slug: mountain.slug,
    name: mountain.name,
    elevationM: mountain.elevationM,
    lon: mountain.lon,
    lat: mountain.lat,
    countries: mountain.countries,
    isHighPoint: mountain.highPointOf.length > 0,
    isShared: mountain.isShared,
    territory: mountain.territory,
    rangeName: mountain.range?.name ?? null,
    mountain,
  };
}

export const BAND_FILL = {
  above5000: 'var(--band-above-5000)',
  from4000to5000: 'var(--band-4000-5000)',
  from3000to4000: 'var(--band-3000-4000)',
  upTo3000: 'var(--band-up-to-3000)',
} as const;

export function bandFill(peak: Pick<MapPeak, 'elevationM' | 'territory'>): string {
  return peak.territory !== null
    ? 'var(--color-ink-subtle)'
    : BAND_FILL[heightBand(peak.elevationM)];
}

/** "Kenya", "Uganda and DR Congo", or the territory. */
export function whereLabel(peak: MapPeak, countries: ReadonlyMap<string, CountryRef>): string {
  if (peak.territory !== null) return strings.harim.map.territory(peak.territory);
  const names = peak.countries.map((iso3) => countries.get(iso3)?.name ?? iso3);
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** "Mount Kenya, 5,199 metres, Kenya" (spec 7.5). */
export function peakAriaLabel(
  peak: MapPeak,
  countries: ReadonlyMap<string, CountryRef>,
  unit: Unit,
): string {
  const value = formatElevation(peak.elevationM, unit).split(' ')[0] ?? '';
  return strings.harim.map.peakLabel(
    peak.name,
    strings.harim.map.heightWords(value, unit),
    whereLabel(peak, countries),
  );
}
