import { type CountryRef, type RegionSlug, heightBand } from '@bla/shared';
import {
  type Ref,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { IconButton } from '../../../components/IconButton/IconButton';
import { Icon } from '../../../components/Icon/Icon';
import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { type Unit } from '../../../lib/units';
import { type MapContext, type MapController, MapBase } from '../../map/MapBase';
import { disputedFill } from '../../map/mapPatterns';
import styles from './HarimMap.module.css';
import { BAND_FILL, type MapPeak } from './mapModel';
import { PeaksLayer } from './PeaksLayer';

const text = strings.harim.map;
const MAP_ID = 'harim-map';
const BANDS = ['above5000', 'from4000to5000', 'from3000to4000', 'upTo3000'] as const;

/** Camera moves the page asks for (linked selection with the table). */
export interface HarimMapHandle {
  /** Zoom to a country's peaks (or its outline when it has fewer than two). */
  fitCountry: (iso3: string) => void;
  /** Zoom to these peaks, or back to all of Africa when there are none. */
  fitPeaks: (slugs: readonly string[], maxZoom?: number) => void;
  /** Centre on one peak, zooming in to at least 4×. */
  focusPeak: (slug: string) => void;
  reset: () => void;
}

export interface HarimMapProps {
  handleRef: Ref<HarimMapHandle | null>;
  peaks: readonly MapPeak[];
  total: number;
  countries: ReadonlyMap<string, CountryRef>;
  region: RegionSlug | null;
  /** The country filter: shows a "Fit to …" control. */
  country: string | null;
  unit: Unit;
  highlighted: string | null;
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onOpenPeak: (slug: string) => void;
  onShowInTable: (slug: string) => void;
  onReady: () => void;
  /** The id of the table the map is the visual of (its accessible equivalent). */
  tableId?: string;
}

/**
 * The Harim map (spec 7.5 item 4): the shared Equal Earth base with countries in a muted tint of
 * their region colour, and the peaks layer on top. The table is its accessible equivalent.
 */
export function HarimMap({
  handleRef,
  peaks,
  total,
  countries,
  region,
  country,
  unit,
  highlighted,
  selected,
  onSelect,
  onOpenPeak,
  onShowInTable,
  onReady,
  tableId = 'harim-results',
}: HarimMapProps) {
  const controllerRef = useRef<MapController | null>(null);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [halo, setHalo] = useState(false);
  const [shown, setShown] = useState(0);
  const hintId = useId();
  const titleId = useId();
  const bySlug = useMemo(() => new Map(peaks.map((peak) => [peak.slug, peak])), [peaks]);

  const boxOf = useCallback(
    (
      points: readonly { lon: number; lat: number }[],
    ): [[number, number], [number, number]] | null => {
      const projected = points.flatMap((p) => {
        const point = controllerRef.current?.project(p.lon, p.lat);
        return point ? [point] : [];
      });
      if (projected.length === 0) return null;
      const xs = projected.map((p) => p[0]);
      const ys = projected.map((p) => p[1]);
      return [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ];
    },
    [],
  );

  const fitCountry = useCallback(
    (iso3: string) => {
      const own = peaks.filter((p) => p.countries.includes(iso3));
      const box = own.length >= 2 ? boxOf(own) : (controllerRef.current?.shapeBounds(iso3) ?? null);
      if (box) controllerRef.current?.fitBox(box, 6);
    },
    [peaks, boxOf],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      fitCountry,
      fitPeaks: (slugs, maxZoom = 3) => {
        const box = boxOf(slugs.flatMap((slug) => bySlug.get(slug) ?? []));
        if (box) controllerRef.current?.fitBox(box, maxZoom);
        else controllerRef.current?.reset();
      },
      focusPeak: (slug) => {
        const peak = bySlug.get(slug);
        const point = peak ? controllerRef.current?.project(peak.lon, peak.lat) : null;
        if (point) controllerRef.current?.fitBox([point, point], 4);
      },
      reset: () => {
        controllerRef.current?.reset();
      },
    }),
    [fitCountry, bySlug, boxOf],
  );

  const bandCounts = useMemo(() => {
    const counts = { above5000: 0, from4000to5000: 0, from3000to4000: 0, upTo3000: 0 };
    for (const peak of peaks) if (peak.territory === null) counts[heightBand(peak.elevationM)] += 1;
    return counts;
  }, [peaks]);
  const hasShared = peaks.some((p) => p.isShared);
  const hasTerritory = peaks.some((p) => p.territory !== null);
  const countryName = country === null ? null : (countries.get(country)?.name ?? null);

  const renderCountries = ({ shapes }: MapContext) => {
    return (
      <g aria-hidden="true">
        {shapes.map((shape) => {
          if (shape.disputed) {
            return <path key={shape.iso3} d={shape.d} style={{ fill: disputedFill(MAP_ID) }} />;
          }
          const ref = countries.get(shape.iso3);
          const dimmed = region !== null && ref?.region.slug !== region;
          return (
            <path
              key={shape.iso3}
              d={shape.d}
              className={cx(
                styles.country,
                dimmed && styles.dimmed,
                country === shape.iso3 && styles.focusCountry,
              )}
              style={ref ? { '--region': `var(--region-${ref.region.slug})` } : undefined}
              data-iso3={shape.iso3}
            />
          );
        })}
      </g>
    );
  };

  return (
    <section className={styles.section} aria-labelledby={titleId} data-testid="harim-map-section">
      <h2 id={titleId} className={styles.title}>
        <Icon name="map" size={24} />
        {text.title}
      </h2>
      <div className={styles.stage}>
        <MapBase
          label={text.label}
          describedBy={hintId}
          testId={MAP_ID}
          className={styles.frame}
          controllerRef={controllerRef}
          onReady={onReady}
          renderCountries={renderCountries}
          renderScreen={(context) => (
            <PeaksLayer
              context={context}
              peaks={peaks}
              countries={countries}
              unit={unit}
              halo={halo}
              highlighted={highlighted}
              selected={selected}
              onSelect={onSelect}
              onOpenPeak={onOpenPeak}
              onShowInTable={onShowInTable}
              overlay={overlay}
              onCounts={setShown}
            />
          )}
          controls={
            country !== null &&
            countryName !== null && (
              <IconButton
                icon="zoom_in_map"
                label={text.fitCountry(countryName)}
                variant="glass"
                data-testid="harim-map-fit"
                onClick={() => {
                  fitCountry(country);
                }}
              />
            )
          }
        >
          <div ref={setOverlay} className={styles.overlay} />
        </MapBase>

        <div className={cx('glass glass--strong', styles.legend)} data-testid="harim-map-legend">
          <p className={styles.legendTitle}>{text.legendTitle}</p>
          <ul>
            {BANDS.map((band) => (
              <li key={band}>
                <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                  <path
                    d="M7,0.5L13.5,11.5L0.5,11.5Z"
                    className={styles.legendGlyph}
                    style={{ '--band': BAND_FILL[band] }}
                  />
                </svg>
                <span>{strings.harim.stats.bands[band]}</span>
                <span className={styles.legendCount}>{bandCounts[band]}</span>
              </li>
            ))}
            {hasShared && (
              <li>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" className={styles.legendRing} />
                </svg>
                <span>{text.legendShared}</span>
              </li>
            )}
            {hasTerritory && (
              <li>
                <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                  <path
                    d="M7,0.5L13.5,11.5L0.5,11.5Z"
                    className={styles.legendGlyph}
                    style={{ '--band': 'var(--color-ink-subtle)' }}
                  />
                </svg>
                <span>{text.legendTerritory}</span>
              </li>
            )}
            <li>
              <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
                <path
                  d="M7,3.5L13.5,14.5L0.5,14.5Z"
                  className={styles.legendGlyph}
                  style={{ '--band': BAND_FILL.upTo3000 }}
                />
                <circle cx="15" cy="6" r="6" className={styles.legendBubble} />
                <text x="15" y="6" className={styles.legendBubbleText}>
                  3
                </text>
              </svg>
              <span>{text.legendGroup}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.below}>
        <label className={styles.haloToggle}>
          <input
            type="checkbox"
            checked={halo}
            data-testid="harim-map-halo"
            onChange={(event) => {
              setHalo(event.currentTarget.checked);
            }}
          />
          <span>{text.halo}</span>
        </label>
        {halo && <p className={styles.haloNote}>{text.haloNote}</p>}
        <p className={styles.note} data-testid="harim-map-status">
          {text.showing(shown, total)}
        </p>
        <p id={hintId} className={styles.note}>
          {text.keyboardHint} {strings.map.zoomHint}
        </p>
        <p className={styles.note}>
          <a href={`#${tableId}`}>{text.tableLink}</a>
        </p>
      </div>
    </section>
  );
}
