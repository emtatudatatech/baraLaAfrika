import { strings } from '../../lib/strings';

/**
 * Context shown with a country whose map shape includes territory with a distinct status.
 * Somaliland is merged into Somalia on the map (the 54 states follow the research document).
 */
const NOTES: Readonly<Partial<Record<string, string>>> = {
  SOM: strings.map.somalilandNote,
};

export function territoryNote(iso3: string): string | undefined {
  return NOTES[iso3];
}

/** Id of the hidden element that describes a country's note to assistive technology. */
export function territoryNoteId(iso3: string): string {
  return `map-territory-note-${iso3}`;
}
