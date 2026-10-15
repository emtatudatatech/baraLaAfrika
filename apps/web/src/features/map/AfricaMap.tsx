import type { CountrySummary, RegionSlug } from '@bla/shared';
import { geoGraticule10, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from 'd3-zoom';
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { IconButton } from '../../components/IconButton/IconButton';
import { placeTooltip } from '../../components/Tooltip/placeTooltip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import styles from './AfricaMap.module.css';
import { CountryPopover } from './CountryPopover';
import { nextCountry } from './keyboard';
import { fitAfricaProjection } from './projection';
import { territoryNote, territoryNoteId } from './territoryNotes';
import {
  CONTEXT_TOPOLOGY_URL,
  COUNTRIES_TOPOLOGY_URL,
  type ContextTopology,
  type CountriesTopology,
  buildContextLand,
  buildMapGeometry,
  fetchJson,
} from './topology';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.6;
const MARKER_RADIUS = 6;
const MARKER_HIT_RADIUS = 16;

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
  const geometry = useResource('geo:countries', () =>
    fetchJson<CountriesTopology>(COUNTRIES_TOPOLOGY_URL).then(buildMapGeometry),
  );
  // The muted context land loads after the countries (spec §9: lazy-load the context layer).
  const context = useResource(geometry.status === 'success' ? 'geo:context' : null, () =>
    fetchJson<ContextTopology>(CONTEXT_TOPOLOGY_URL).then(buildContextLand),
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const focusTargets = useRef(new Map<string, SVGElement>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hovered, setHovered] = useState<{ iso3: string; anchor: Anchor } | null>(null);
  const [focused, setFocused] = useState<{ iso3: string; anchor: Anchor | null } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ iso3: string; anchor: Anchor } | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, []);

  const projection = useMemo(
    () => (size.width > 0 ? fitAfricaProjection(size.width, size.height) : null),
    [size.width, size.height],
  );
  const byIso3 = useMemo(() => new Map((countries ?? []).map((c) => [c.iso3, c])), [countries]);
  const order = useMemo(
    () => [...(countries ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.iso3),
    [countries],
  );
  const currentActive = active ?? order[0] ?? null;

  const drawn = useMemo(() => {
    if (!projection || geometry.status !== 'success') return null;
    const path = geoPath(projection);
    return {
      graticule: path(geoGraticule10()) ?? '',
      borders: path(geometry.data.borders) ?? '',
      coast: path(geometry.data.coast) ?? '',
      shapes: geometry.data.shapes.map((shape) => ({ ...shape, d: path(shape.geometry) ?? '' })),
    };
  }, [projection, geometry]);
  const contextPath = useMemo(
    () =>
      projection && context.status === 'success' ? (geoPath(projection)(context.data) ?? '') : '',
    [projection, context],
  );
  const markers = useMemo(() => {
    if (!projection) return [];
    return (countries ?? []).flatMap((c) => {
      if (!c.isMicrostateMarker || !c.centroid) return [];
      const point = projection([c.centroid.lon, c.centroid.lat]);
      return point ? [{ iso3: c.iso3, x: point[0], y: point[1] }] : [];
    });
  }, [projection, countries]);

  // d3-zoom: buttons, pinch and two-finger pan on touch, Ctrl/⌘ + wheel on desktop (so plain
  // scrolling still scrolls the page), drag to pan with the mouse.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || size.width === 0) return;
    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .extent([
        [0, 0],
        [size.width, size.height],
      ])
      .translateExtent([
        [0, 0],
        [size.width, size.height],
      ])
      .filter((event: Event) => {
        if (event.type === 'wheel') {
          const wheel = event as WheelEvent;
          return wheel.ctrlKey || wheel.metaKey;
        }
        if (event.type.startsWith('touch')) return (event as TouchEvent).touches.length >= 2;
        if (event.type === 'mousedown') return (event as globalThis.MouseEvent).button === 0;
        return true;
      })
      .on('zoom', (event: { transform: ZoomTransform }) => {
        setTransform(event.transform);
      });
    zoomRef.current = behaviour;
    const selection = select(svg);
    selection.call(behaviour);
    // Let the browser keep one-finger page scrolling; d3 handles pinch and two-finger pan.
    svg.style.touchAction = 'pan-x pan-y';
    return () => {
      selection.on('.zoom', null);
    };
  }, [size.width, size.height]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (svg && behaviour) {
      select(svg).call((selection) => {
        behaviour.scaleBy(selection, factor);
      });
    }
  };
  const resetZoom = () => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (svg && behaviour) {
      select(svg).call((selection) => {
        behaviour.transform(selection, zoomIdentity);
      });
    }
  };

  /** Viewport coordinates of a country's anchor (for keyboard tooltips and popovers). */
  const anchorOf = (iso3: string): Anchor | null => {
    const country = byIso3.get(iso3);
    const svg = svgRef.current;
    if (!country?.centroid || !projection || !svg) return null;
    const point = projection([country.centroid.lon, country.centroid.lat]);
    if (!point) return null;
    const [x, y] = transform.apply(point);
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + x, y: rect.top + y };
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
  const highlightShape = drawn?.shapes.find((s) => s.iso3 === highlighted);
  const k = transform.k;
  const selectedCountry = selected ? byIso3.get(selected.iso3) : undefined;

  return (
    <div className={styles.wrapper}>
      <div className={styles.stage}>
        <div ref={frameRef} className={cx('glass', styles.frame)}>
          {geometry.status === 'loading' && (
            <p className={styles.status} role="status">
              {strings.map.loading}
            </p>
          )}
          {geometry.status === 'error' && (
            <div className={styles.status} role="alert">
              <p>{strings.map.loadError}</p>
              <button type="button" className={styles.retry} onClick={geometry.retry}>
                {strings.map.retry}
              </button>
            </div>
          )}
          {size.width > 0 && (
            <svg
              ref={svgRef}
              className={styles.svg}
              width={size.width}
              height={size.height}
              viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
              role="group"
              aria-label={strings.map.label}
              aria-describedby="map-keyboard-hint"
              data-testid="africa-map"
            >
              <defs>
                <pattern
                  id="disputed-hatch"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" className={styles.disputedFill} />
                  <line x1="0" y1="0" x2="0" y2="6" className={styles.disputedHatch} />
                </pattern>
              </defs>
              <rect className={styles.ocean} width={size.width} height={size.height} />
              {drawn && (
                <g transform={transform.toString()}>
                  <path className={styles.graticule} d={drawn.graticule} />
                  {contextPath && <path className={styles.context} d={contextPath} />}
                  <g className={styles.countries}>
                    {drawn.shapes.map((shape) => {
                      if (shape.disputed) {
                        return (
                          <path
                            key={shape.iso3}
                            d={shape.d}
                            className={styles.disputed}
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
                      const dimmed =
                        isolatedRegion !== null && country.region.slug !== isolatedRegion;
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
                  <path className={styles.borders} d={drawn.borders} />
                  <path className={styles.coast} d={drawn.coast} />
                  <g className={styles.markers}>
                    {markers.map(({ iso3, x, y }) => {
                      const country = byIso3.get(iso3);
                      if (!country) return null;
                      const dimmed =
                        isolatedRegion !== null && country.region.slug !== isolatedRegion;
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
                          <circle
                            className={styles.markerHit}
                            cx={x}
                            cy={y}
                            r={MARKER_HIT_RADIUS / k}
                          />
                          <circle
                            className={styles.markerDot}
                            cx={x}
                            cy={y}
                            r={MARKER_RADIUS / k}
                          />
                          {highlighted === iso3 && (
                            <circle
                              className={styles.markerRing}
                              cx={x}
                              cy={y}
                              r={(MARKER_RADIUS + 4) / k}
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                  {highlightShape && !highlightShape.disputed && (
                    <path className={styles.highlight} d={highlightShape.d} />
                  )}
                </g>
              )}
            </svg>
          )}

          <div className={styles.zoomControls}>
            <IconButton
              icon="zoom_in"
              label={strings.map.zoomIn}
              variant="glass"
              onClick={() => {
                zoomBy(ZOOM_STEP);
              }}
              disabled={k >= MAX_ZOOM}
            />
            <IconButton
              icon="zoom_out"
              label={strings.map.zoomOut}
              variant="glass"
              onClick={() => {
                zoomBy(1 / ZOOM_STEP);
              }}
              disabled={k <= MIN_ZOOM}
            />
            <IconButton
              icon="fit_screen"
              label={strings.map.resetZoom}
              variant="glass"
              onClick={resetZoom}
            />
          </div>

          {countriesError !== undefined && (
            <div className={cx('glass glass--strong', styles.notice)} role="alert">
              <p>{strings.map.countriesError}</p>
              <button type="button" className={styles.retry} onClick={onRetryCountries}>
                {strings.map.retry}
              </button>
              <DevApiHint error={countriesError} className={styles.noticeHint} />
            </div>
          )}
        </div>

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
