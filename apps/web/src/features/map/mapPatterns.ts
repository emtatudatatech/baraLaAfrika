/** The disputed-territory fill for a map with this test id (its pattern is defined by MapBase). */
export function disputedFill(mapId: string): string {
  return `url(#${mapId}-disputed-hatch)`;
}
