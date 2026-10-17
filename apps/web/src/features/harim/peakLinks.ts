/** How the tables and the map stay linked (spec 7.5: linked selection). */
export interface PeakLinks {
  /** The peak selected on the map: its row is highlighted. */
  selected: string | null;
  /** Hovering a row highlights its peak on the map (null when the pointer leaves). */
  onHover: (slug: string | null) => void;
  /** Centre the map on a peak, select it and bring the map into view. */
  onShowOnMap: (slug: string) => void;
  /** Fit the map to a country's peaks and bring the map into view. */
  onShowCountryOnMap: (iso3: string) => void;
}
