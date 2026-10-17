import { type GeoPath, type GeoProjection, geoGraticule10, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from 'd3-zoom';
import {
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { IconButton } from '../../components/IconButton/IconButton';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import styles from './MapBase.module.css';
import { fitAfricaProjection } from './projection';
import {
  CONTEXT_TOPOLOGY_URL,
  COUNTRIES_TOPOLOGY_URL,
  type ContextTopology,
  type CountriesTopology,
  type MapShape,
  buildContextLand,
  buildMapGeometry,
  fetchJson,
} from './topology';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
const ZOOM_STEP = 1.6;

export interface DrawnShape extends MapShape {
  /** SVG path in projected (unzoomed) pixels. */
  d: string;
}

/** What a layer needs to draw: the projection, current zoom and the drawn country shapes. */
export interface MapContext {
  projection: GeoProjection;
  path: GeoPath;
  transform: ZoomTransform;
  size: { width: number; height: number };
  shapes: readonly DrawnShape[];
}

/** Programmatic camera moves (animated unless the viewer prefers reduced motion). */
export interface MapController {
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** Fit a box of projected (unzoomed) pixels, capped at `maxZoom`. */
  fitBox: (box: [[number, number], [number, number]], maxZoom?: number) => void;
  /** Projected (unzoomed) pixel position of a point, or null. */
  project: (lon: number, lat: number) => [number, number] | null;
  /** Where a point is in the viewport now (for tooltips and popovers), or null. */
  toViewport: (lon: number, lat: number) => { x: number; y: number } | null;
  /** A country's outline bounds in projected (unzoomed) pixels, or null. */
  shapeBounds: (iso3: string) => [[number, number], [number, number]] | null;
}

export interface MapBaseProps {
  label: string;
  describedBy?: string;
  testId: string;
  className?: string | undefined;
  controllerRef?: Ref<MapController | null>;
  /** Country layer, drawn in the zoomed group (under the borders). */
  renderCountries: (context: MapContext) => ReactNode;
  /** Drawn in the zoomed group above the borders (e.g. a highlight). */
  renderOverlay?: (context: MapContext) => ReactNode;
  /** Drawn in screen pixels above everything (markers, labels): constant size at any zoom. */
  renderScreen?: (context: MapContext) => ReactNode;
  /** Extra controls under the zoom buttons. */
  controls?: ReactNode;
  /** Absolutely positioned content inside the frame (notices, legends). */
  children?: ReactNode;
  onTransform?: (transform: ZoomTransform) => void;
  /** Called once the map has its size and geometry (camera moves work from then on). */
  onReady?: () => void;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The shared Africa map: Equal Earth fitted to the continent, the muted context land, graticule,
 * borders and coastlines, and d3-zoom (buttons, pinch and two-finger pan on touch, Ctrl/⌘ + wheel
 * on desktop so plain scrolling still scrolls the page, drag to pan). Pages add their own layers.
 */
export function MapBase({
  label,
  describedBy,
  testId,
  className,
  controllerRef,
  renderCountries,
  renderOverlay,
  renderScreen,
  controls,
  children,
  onTransform,
  onReady,
}: MapBaseProps) {
  const geometry = useResource('geo:countries', () =>
    fetchJson<CountriesTopology>(COUNTRIES_TOPOLOGY_URL).then(buildMapGeometry),
  );
  // The muted context land loads after the countries (spec §9: lazy-load the context layer).
  const context = useResource(geometry.status === 'success' ? 'geo:context' : null, () =>
    fetchJson<ContextTopology>(CONTEXT_TOPOLOGY_URL).then(buildContextLand),
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const onTransformRef = useRef(onTransform);
  const onReadyRef = useRef(onReady);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);

  useEffect(() => {
    onTransformRef.current = onTransform;
    onReadyRef.current = onReady;
  });

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

  const drawn = useMemo(() => {
    if (!projection || geometry.status !== 'success') return null;
    const path = geoPath(projection);
    return {
      path,
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
        if (event.type === 'mousedown') return (event as MouseEvent).button === 0;
        return true;
      })
      .on('zoom', (event: { transform: ZoomTransform }) => {
        setTransform(event.transform);
        onTransformRef.current?.(event.transform);
      });
    zoomRef.current = behaviour;
    const selection = select(svg);
    selection.call(behaviour);
    if (geometry.status === 'success') onReadyRef.current?.();
    // Let the browser keep one-finger page scrolling; d3 handles pinch and two-finger pan.
    svg.style.touchAction = 'pan-x pan-y';
    return () => {
      selection.on('.zoom', null);
    };
  }, [size.width, size.height, geometry.status]);

  const apply = (
    to: ZoomTransform | ((behaviour: ZoomBehavior<SVGSVGElement, unknown>) => void),
  ) => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (!svg || !behaviour) return;
    const selection = select(svg);
    if (typeof to === 'function') {
      to(behaviour);
      return;
    }
    if (reducedMotion()) behaviour.transform(selection, to);
    else behaviour.transform(selection.transition().duration(450), to);
  };

  const controller: MapController = {
    zoomBy: (factor) => {
      const svg = svgRef.current;
      const behaviour = zoomRef.current;
      if (svg && behaviour) behaviour.scaleBy(select(svg), factor);
    },
    reset: () => {
      apply(zoomIdentity);
    },
    fitBox: ([[x0, y0], [x1, y1]], maxZoom = MAX_ZOOM) => {
      if (size.width === 0) return;
      const pad = 48;
      const width = Math.max(1, x1 - x0);
      const height = Math.max(1, y1 - y0);
      const k = Math.max(
        MIN_ZOOM,
        Math.min(maxZoom, (size.width - pad * 2) / width, (size.height - pad * 2) / height),
      );
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      apply(zoomIdentity.translate(size.width / 2 - k * cx, size.height / 2 - k * cy).scale(k));
    },
    project: (lon, lat) => {
      const point = projection?.([lon, lat]);
      return point ? [point[0], point[1]] : null;
    },
    toViewport: (lon, lat) => {
      const point = projection?.([lon, lat]);
      const svg = svgRef.current;
      if (!point || !svg) return null;
      const [x, y] = transform.apply(point);
      const rect = svg.getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    },
    shapeBounds: (iso3) => {
      const shape = drawn?.shapes.find((candidate) => candidate.iso3 === iso3);
      if (!shape || !drawn) return null;
      const [[x0, y0], [x1, y1]] = drawn.path.bounds(shape.geometry);
      return [
        [x0, y0],
        [x1, y1],
      ];
    },
  };
  useImperativeHandle(controllerRef, () => controller);

  const mapContext: MapContext | null =
    drawn && projection
      ? { projection, path: drawn.path, transform, size, shapes: drawn.shapes }
      : null;
  const k = transform.k;

  return (
    <div ref={frameRef} className={cx('glass', styles.frame, className)}>
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
          aria-label={label}
          aria-describedby={describedBy}
          data-testid={testId}
          data-zoom={k.toFixed(2)}
        >
          <defs>
            <pattern
              id={`${testId}-disputed-hatch`}
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
          {mapContext && drawn && (
            <>
              <g transform={transform.toString()}>
                <path className={styles.graticule} d={drawn.graticule} />
                {contextPath && <path className={styles.context} d={contextPath} />}
                {renderCountries(mapContext)}
                <path className={styles.borders} d={drawn.borders} />
                <path className={styles.coast} d={drawn.coast} />
                {renderOverlay?.(mapContext)}
              </g>
              {renderScreen?.(mapContext)}
            </>
          )}
        </svg>
      )}

      <div className={styles.controls}>
        <IconButton
          icon="zoom_in"
          label={strings.map.zoomIn}
          variant="glass"
          onClick={() => {
            controller.zoomBy(ZOOM_STEP);
          }}
          disabled={k >= MAX_ZOOM}
        />
        <IconButton
          icon="zoom_out"
          label={strings.map.zoomOut}
          variant="glass"
          onClick={() => {
            controller.zoomBy(1 / ZOOM_STEP);
          }}
          disabled={k <= MIN_ZOOM}
        />
        <IconButton
          icon="fit_screen"
          label={strings.map.resetZoom}
          variant="glass"
          onClick={controller.reset}
        />
        {controls}
      </div>

      {children}
    </div>
  );
}
