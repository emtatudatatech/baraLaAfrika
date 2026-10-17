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
