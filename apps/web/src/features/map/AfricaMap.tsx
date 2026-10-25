import type { CountrySummary, RegionSlug } from '@bla/shared';
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { placeTooltip } from '../../components/Tooltip/placeTooltip';
import { prefersLightLine } from '../../lib/colour';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './AfricaMap.module.css';
import { CountryPopover } from './CountryPopover';
import { nextCountry } from './keyboard';
import { type MapContext, type MapController, MapBase } from './MapBase';
import { disputedFill } from './mapPatterns';
import { MapFacts } from './MapFacts';
import { territoryNote, territoryNoteId } from './territoryNotes';

const MARKER_RADIUS = 6;
const MARKER_HIT_RADIUS = 16;
const MAP_ID = 'africa-map';

interface Anchor {
  x: number;
  y: number;
}

export interface AfricaMapProps {
  countries: readonly CountrySummary[] | undefined;
  /** Set when the country list failed to load (the map then shows boundaries only). */
  countriesError: Error | undefined;
  onRetryCountries: () => void;
  isolatedRegion: RegionSlug | null;
  regionOrder: readonly RegionSlug[];
  /** Shown over the map's South Atlantic on larger screens, directly below the map on phones. */
  legend?: ReactNode;
}

/** Interactive Equal Earth map of Africa: countries filled by region colour (spec §7.1). */
export function AfricaMap({
  countries,
  countriesError,
  onRetryCountries,
  isolatedRegion,
  regionOrder,
  legend,
}: AfricaMapProps) {
  const controllerRef = useRef<MapController | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const focusTargets = useRef(new Map<string, SVGElement>());

  const [hovered, setHovered] = useState<{ iso3: string; anchor: Anchor } | null>(null);
  const [focused, setFocused] = useState<{ iso3: string; anchor: Anchor | null } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ iso3: string; anchor: Anchor } | null>(null);

  const byIso3 = useMemo(() => new Map((countries ?? []).map((c) => [c.iso3, c])), [countries]);
  // Countries whose region colour is dark: the borders between two of them are drawn light.
  const lightBorder = useMemo(() => {
    const dark = new Set(
      (countries ?? [])
        .filter((c) => c.region.colorHex !== null && prefersLightLine(c.region.colorHex))
        .map((c) => c.iso3),
    );
    return (a: string, b: string) => dark.has(a) && dark.has(b);
  }, [countries]);
  const order = useMemo(
    () => [...(countries ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.iso3),
    [countries],
  );
  const currentActive = active ?? order[0] ?? null;

  /** Viewport coordinates of a country's anchor (for keyboard tooltips and popovers). */
  const anchorOf = (iso3: string): Anchor | null => {
    const centroid = byIso3.get(iso3)?.centroid;
    return centroid
      ? (controllerRef.current?.toViewport(centroid.lon, centroid.lat) ?? null)
      : null;
  };

  const open = (iso3: string, anchor: Anchor | null) => {
    if (!byIso3.has(iso3)) return;
    setHovered(null);
    setSelected({ iso3, anchor: anchor ?? anchorOf(iso3) ?? { x: 0, y: 0 } });
  };

  const onKeyDown = (event: KeyboardEvent<SVGElement>, iso3: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(iso3, anchorOf(iso3));
      return;
    }
    if (event.key === 'Escape' && selected) {
      setSelected(null);
      return;
    }
    const next = nextCountry(order, iso3, event.key);
    if (next) {
      event.preventDefault();
      setActive(next);
      focusTargets.current.get(next)?.focus();
    }
  };

  const pointerHandlers = (iso3: string) => ({
    onPointerMove: (event: PointerEvent<SVGElement>) => {
      if (event.pointerType === 'touch') return;
      setHovered({ iso3, anchor: { x: event.clientX, y: event.clientY } });
    },
    onPointerLeave: () => {
      setHovered((current) => (current?.iso3 === iso3 ? null : current));
    },
  });

  const interactiveProps = (iso3: string, label: string) => ({
    role: 'button' as const,
    tabIndex: iso3 === currentActive ? 0 : -1,
    'aria-label': label,
    'aria-describedby': territoryNote(iso3) === undefined ? undefined : territoryNoteId(iso3),
    'data-iso3': iso3,
    ref: (element: SVGElement | null) => {
      if (element) focusTargets.current.set(iso3, element);
      else focusTargets.current.delete(iso3);
    },
    onClick: (event: MouseEvent<SVGElement>) => {
      setActive(iso3);
      open(iso3, { x: event.clientX, y: event.clientY });
    },
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      onKeyDown(event, iso3);
    },
    onFocus: () => {
      setActive(iso3);
      setFocused({ iso3, anchor: anchorOf(iso3) });
    },
    onBlur: () => {
      setFocused((current) => (current?.iso3 === iso3 ? null : current));
    },
    ...pointerHandlers(iso3),
  });

  // Tooltip: the hovered country (pointer) or the focused one (keyboard), never over a popover.
  const tooltipIso3 = hovered?.iso3 ?? focused?.iso3 ?? null;
  const tooltipAnchor = hovered?.anchor ?? focused?.anchor ?? null;
  const showTooltip = tooltipIso3 !== null && tooltipAnchor !== null && !selected;
  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node || !showTooltip) return;
    const { left, top } = placeTooltip(
      { left: tooltipAnchor.x, top: tooltipAnchor.y - 6, width: 0, height: 12 },
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      'top',
    );
    node.style.left = `${String(left)}px`;
    node.style.top = `${String(top)}px`;
  });

  const highlighted = selected?.iso3 ?? focused?.iso3 ?? hovered?.iso3 ?? null;
  const selectedCountry = selected ? byIso3.get(selected.iso3) : undefined;

  const renderCountries = ({ shapes }: MapContext) => (
    <g className={styles.countries}>
      {shapes.map((shape) => {
        if (shape.disputed) {
          return (
            <path
              key={shape.iso3}
              d={shape.d}
              className={styles.disputed}
              style={{ fill: disputedFill(MAP_ID) }}
              role="img"
              aria-label={`${strings.map.disputed}: ${strings.map.disputedNote}`}
              data-iso3={shape.iso3}
              {...pointerHandlers(shape.iso3)}
            />
          );
        }
        const country = byIso3.get(shape.iso3);
        if (!country) {
          return <path key={shape.iso3} d={shape.d} className={styles.unknown} />;
        }
        const regionIndex = Math.max(0, regionOrder.indexOf(country.region.slug));
        const dimmed = isolatedRegion !== null && country.region.slug !== isolatedRegion;
        const style = {
          '--fill': `var(--region-${country.region.slug})`,
          '--delay': `${String(regionIndex * 90)}ms`,
        };
        // Small states are focused and clicked through their circle marker.
        if (country.isMicrostateMarker) {
          return (
            <path
              key={shape.iso3}
              d={shape.d}
              className={cx(styles.country, dimmed && styles.dimmed)}
              style={style}
              data-iso3={shape.iso3}
              aria-hidden="true"
            />
          );
        }
        return (
          <path
            key={shape.iso3}
            d={shape.d}
            className={cx(styles.country, dimmed && styles.dimmed)}
            style={style}
            data-region={country.region.slug}
            {...interactiveProps(
              shape.iso3,
              strings.map.countryLabel(country.name, country.region.name),
            )}
          />
        );
      })}
    </g>
  );

  const renderOverlay = ({ projection, transform, shapes }: MapContext) => {
    const k = transform.k;
    const highlightShape = shapes.find((s) => s.iso3 === highlighted);
    const markers = (countries ?? []).flatMap((c) => {
      if (!c.isMicrostateMarker || !c.centroid) return [];
      const point = projection([c.centroid.lon, c.centroid.lat]);
      return point ? [{ iso3: c.iso3, x: point[0], y: point[1] }] : [];
    });
    return (
      <>
        <g className={styles.markers}>
          {markers.map(({ iso3, x, y }) => {
            const country = byIso3.get(iso3);
            if (!country) return null;
            const dimmed = isolatedRegion !== null && country.region.slug !== isolatedRegion;
            return (
              <g
                key={iso3}
                className={cx(styles.marker, dimmed && styles.dimmed)}
                style={{ '--fill': `var(--region-${country.region.slug})` }}
                data-region={country.region.slug}
                {...interactiveProps(
                  iso3,
                  strings.map.countryLabel(country.name, country.region.name),
                )}
              >
                <circle className={styles.markerHit} cx={x} cy={y} r={MARKER_HIT_RADIUS / k} />
                <circle className={styles.markerDot} cx={x} cy={y} r={MARKER_RADIUS / k} />
                {highlighted === iso3 && (
                  <circle className={styles.markerRing} cx={x} cy={y} r={(MARKER_RADIUS + 4) / k} />
                )}
              </g>
            );
          })}
        </g>
        {highlightShape && !highlightShape.disputed && (
          <path className={styles.highlight} d={highlightShape.d} />
        )}
      </>
    );
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.stage}>
        <MapBase
          label={strings.map.label}
          describedBy="map-keyboard-hint"
          testId={MAP_ID}
          className={styles.frame}
          controllerRef={controllerRef}
          renderCountries={renderCountries}
          renderOverlay={renderOverlay}
          lightBorder={lightBorder}
        >
          {countriesError !== undefined && (
            <div className={cx('glass glass--strong', styles.notice)} role="alert">
              <p>{strings.map.countriesError}</p>
              <button type="button" className={styles.retry} onClick={onRetryCountries}>
                {strings.map.retry}
              </button>
              <DevApiHint error={countriesError} className={styles.noticeHint} />
            </div>
          )}
        </MapBase>

        {legend !== undefined && <div className={styles.legendSlot}>{legend}</div>}
      </div>

      {showTooltip && (
        <div ref={tooltipRef} className={cx('glass glass--strong', styles.tooltip)} role="tooltip">
          {tooltipIso3 === 'ESH' ? (
            <>
              <strong>{strings.map.disputed}</strong>
              <span>{strings.map.disputedNote}</span>
            </>
          ) : (
            (() => {
              const country = byIso3.get(tooltipIso3);
              if (!country) return null;
              const note = territoryNote(country.iso3);
              return (
                <>
                  <span className={styles.tooltipTitle}>
                    <FlagImage
                      flag={country.flag}
                      countryName={country.name}
                      width={24}
                      loading="eager"
                    />
                    <strong>{country.name}</strong>
                  </span>
                  <span>{country.region.name}</span>
                  <MapFacts country={country} variant="tooltip" />
                  {note !== undefined && <span className={styles.tooltipNote}>{note}</span>}
                </>
              );
            })()
          )}
        </div>
      )}

      {selected && selectedCountry && (
        <CountryPopover
          country={selectedCountry}
          anchor={selected.anchor}
          onClose={() => {
            const iso3 = selected.iso3;
            setSelected(null);
            focusTargets.current.get(iso3)?.focus();
          }}
        />
      )}

      {[...byIso3.keys()].flatMap((iso3) => {
        const note = territoryNote(iso3);
        return note === undefined
          ? []
          : [
              <span key={iso3} id={territoryNoteId(iso3)} className="visually-hidden">
                {note}
              </span>,
            ];
      })}

      <div className={styles.notes}>
        <p id="map-keyboard-hint">
          {strings.map.keyboardHint} {strings.map.zoomHint}
        </p>
        <p>{strings.map.boundariesNote}</p>
        <p>
          <Link to="/countries">{strings.map.tableLink}</Link>
        </p>
      </div>
    </div>
  );
}
